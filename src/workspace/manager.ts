import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ZodError } from 'zod';

import { classifyTerminal, pickCwd } from '../adopt/filter';
import type { AgentAdapter, RunningSession, RunningStatus } from '../agent/types';
import { khiKetThucLenh, nenBatLenh, type LenhDangCho } from '../capture/rules';
import { chonSessionChoTerminal, gomSessionTheoTerminal } from '../claude/ancestry';
import { matchClaudeSessions, normalizeCwd, type MatchCandidate } from '../claude/match';
import { docBangTienTrinh } from '../proc/real';
import { emptyStore, type StoreFile, type TerminalEntry, type Workspace } from '../model/schema';
import {
  createWorkspace,
  findWorkspace,
  loadStore,
  mergeForSave,
  realStoreFs,
  removeTerminal as removeTerminalEntry,
  saveStore,
  upsertTerminal,
} from '../model/store';
import { TerminalManager } from '../terminal/manager';
import { TrustStore } from '../trust/store';
import { activateWorkspace, type ActivatePorts, type ActivateReport } from './activate';
import { gopGoiYDuongDan } from './paths';

export type TerminalState = 'busy' | 'idle' | 'blocked' | 'loading' | 'open' | 'closed' | 'error';

export interface WorkspaceView {
  id: string;
  name: string;
  terminalCount: number;
  isActive: boolean;
  lastActiveAt: string | null;
}

export interface TerminalView {
  id: string;
  workspaceId: string;
  name: string;
  kind: 'claude' | 'plain';
  state: TerminalState;
  hasStartCommand: boolean;
  cwd: string;
}

const SAVE_DEBOUNCE_MS = 500;
const STORE_FILE = 'workspaces.json';
/** Đường dẫn đã dùng gần đây, để lần sau gõ vài ký tự là ra (globalState). */
const KHOA_LICH_SU_CWD = 'aiWorkspace.duongDanGanDay';
const LICH_SU_CWD_TOI_DA = 20;
/** Cùng nhịp với poll của tree; hai timer chạy song song vô hại nhờ guard refreshPromise. */
const ACTIVE_POLL_MS = 3000;
/** Trần trạng thái "đang tải" — session không hiện trong registry sau chừng này thì thôi xoay. */
const LOADING_TIMEOUT_MS = 90_000;
/** Đọc bảng tiến trình hỏng thì nghỉ chừng này rồi mới thử lại (mỗi lần thử tốn tới 5 giây). */
const LUI_SAU_DOC_HONG_MS = 60_000;
const LUI_TOI_DA_MS = 600_000;
/** Hỏng liên tiếp chừng này lần thì coi như máy không tra được: cảnh báo và thôi ưu tiên. */
const HONG_LIEN_TIEP_BO_CUOC = 3;

/**
 * `pickCwd` cố tình chỉ bỏ qua `undefined` (chuỗi rỗng là lỗi của caller — đã ghim bằng test).
 * Caller là chỗ này, nên chuỗi rỗng/toàn khoảng trắng phải được quy về "không có" TẠI ĐÂY;
 * nếu không, entry sẽ có `cwd: ''` — sai schema `min(1)` và làm hỏng file store.
 */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/** cwd của terminal lúc tạo — `creationOptions.cwd` là `string | Uri | undefined`. */
function creationCwd(terminal: vscode.Terminal): string | undefined {
  const cwd = (terminal.creationOptions as vscode.TerminalOptions).cwd;
  if (cwd === undefined) return undefined;
  return nonEmpty(typeof cwd === 'string' ? cwd : cwd.fsPath);
}

function folderCwd(): string | undefined {
  return nonEmpty(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
}

export class WorkspaceManager implements vscode.Disposable {
  private readonly filePath: string;
  private readonly boNhoChung: vscode.Memento;
  private store: StoreFile;
  private activeId: string | null = null;

  private readonly trust: TrustStore;

  /** Trạng thái Claude gần nhất lấy từ registry, theo terminalId. */
  private readonly statuses = new Map<string, RunningStatus>();
  /** Entry đang chờ session hiện trong registry — hiện spinner "đang tải" trong cây. */
  private readonly loadingIds = new Set<string>();
  private loadingTimer: NodeJS.Timeout | null = null;
  /** Terminal không mở được ở lần activate gần nhất (cwd mất, lỗi tạo…). */
  private readonly errorIds = new Set<string>();
  /** Nhóm cwd đã hỏi QuickPick trong phiên này — không hỏi lại dù người dùng bỏ qua. */
  private readonly askedCwds = new Set<string>();
  /** PID shell của từng terminal đang track (terminalId → pid) — để tra phả hệ tiến trình. */
  private readonly shellPids = new Map<string, number>();
  /** Pid session đã tra phả hệ và KHÔNG thuộc terminal nào của cửa sổ này — cache âm. */
  private readonly pidNgoaiCuaSo = new Set<number>();
  /** Terminal đã tra phả hệ và bên trong không có claude nào — thôi ép đọc bảng tiến trình. */
  private readonly daTraKhongThayClaude = new Set<string>();
  /** Cặp terminalId → sessionId đã được phả hệ tiến trình xác nhận (cwd lệch là bình thường). */
  private readonly phaHeDaXacNhan = new Map<string, string>();
  /** Buộc lần tra phả hệ tới đọc bảng tươi, bỏ qua cache (dùng cho quét bắt lần cuối). */
  private epDocBangTuoi = false;
  /** Lúc đọc bảng tiến trình hỏng gần nhất — lùi một nhịp dài thay vì thử lại mỗi 3 giây. */
  private docBangHongLuc: number | null = null;
  private docBangHongLienTiep = 0;
  private daCanhBaoDocBang = false;
  /** Cache bảng tiến trình — đọc lại tốn cỡ giây, không được phép chạy mỗi nhịp poll 3s. */
  private bangTienTrinhCache: {
    luc: number;
    bang: Map<number, number>;
    /** Pid đã tra mà vẫn vắng mặt ngay sau lần đọc mới — cache âm, khỏi ép đọc lại mỗi nhịp. */
    vangMat: Set<number>;
  } | null = null;
  /** Lệnh đang chạy dở trong từng terminal (terminalId → lệnh) — luật bắt startCommand. */
  private readonly pendingCommands = new Map<string, LenhDangCho>();
  /** Bia mộ: workspace cửa sổ này đã xóa, không được merge sống lại từ đĩa. */
  private readonly deletedIds = new Set<string>();
  /**
   * Workspace mà CHÍNH cửa sổ này đã sửa. Chỉ những id ở đây mới được ghi đè lên bản trên
   * đĩa; workspace ta chỉ hút vào từ file (cửa sổ khác làm chủ) phải đi theo bản đĩa, nếu
   * không mỗi lần ta lưu sẽ xóa mất sessionId vừa mint và khóa V5 của cửa sổ kia.
   */
  private readonly touchedIds = new Set<string>();

  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  /** Lượt refresh đang chạy — gọi chồng sẽ nhận lại promise của lượt đang chạy. */
  private refreshPromise: Promise<void> | null = null;
  /**
   * Poll riêng của manager khi có workspace active: việc bắt session không được phụ thuộc
   * vào chuyện tree view có đang hiển thị hay không (poll của tree chỉ phục vụ hiển thị).
   */
  private pollTimer: NodeJS.Timeout | null = null;
  private activating = false;
  private disposed = false;
  private warnedRecovered = false;

  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly onChanged = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChanged.event;

  constructor(
    context: vscode.ExtensionContext,
    private readonly terminals: TerminalManager,
    private readonly agent: AgentAdapter,
  ) {
    this.boNhoChung = context.globalState;
    this.trust = new TrustStore({
      get: (key) => context.globalState.get<string>(key),
      set: (key, value) => Promise.resolve(context.globalState.update(key, value)),
    });

    const dir = context.globalStorageUri.fsPath;
    this.filePath = path.join(dir, STORE_FILE);
    try {
      nodeFs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Không tạo được thư mục lưu trữ ${dir}: ${String(error)}`,
      );
    }
    // loadStore chỉ nuốt ENOENT; EBUSY/EACCES (antivirus, OneDrive đang khóa file) vẫn ném ra
    // và sẽ giết cả extension nếu không chặn ở đây.
    try {
      const loaded = loadStore(realStoreFs, this.filePath, Date.now);
      this.store = loaded.store;
      if (loaded.recoveredFrom !== null) {
        void vscode.window.showWarningMessage(
          `File workspaces.json bị hỏng nên đã được sao lưu sang ${loaded.recoveredFrom}; danh sách workspace bắt đầu lại từ đầu.`,
        );
      }
    } catch (error) {
      this.store = emptyStore();
      void vscode.window.showWarningMessage(
        `Không đọc được ${this.filePath}: ${String(error)}. Phiên này bắt đầu với danh sách rỗng; hãy kiểm tra quyền truy cập file trước khi tạo workspace mới.`,
      );
    }

    this.subscriptions.push(
      this.terminals.onClosed((key) => {
        // V7: đóng terminal bằng tay KHÔNG gỡ entry khỏi workspace, chỉ đổi trạng thái hiển thị.
        this.shellPids.delete(key);
        this.daTraKhongThayClaude.delete(key);
        this.phaHeDaXacNhan.delete(key);
        this.pendingCommands.delete(key);
        this.onChanged.fire();
      }),
      vscode.window.onDidOpenTerminal((terminal) => {
        void this.onTerminalOpened(terminal);
      }),
      vscode.window.onDidChangeTerminalShellIntegration((event) => {
        this.onShellIntegrationChanged(event);
      }),
      // Bắt "app đang chạy" để lần sau tự mở lại — không cần người dùng khai báo gì.
      vscode.window.onDidStartTerminalShellExecution((event) => {
        this.onShellExecutionStart(event);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        this.onShellExecutionEnd(event);
      }),
    );
  }

  // ---------------------------------------------------------------- views

  workspaceViews(): WorkspaceView[] {
    return [...this.store.workspaces]
      .sort((a, b) => {
        if (a.lastActiveAt === b.lastActiveAt) return a.name.localeCompare(b.name);
        if (a.lastActiveAt === null) return 1;
        if (b.lastActiveAt === null) return -1;
        return b.lastActiveAt.localeCompare(a.lastActiveAt);
      })
      .map((ws) => ({
        id: ws.id,
        name: ws.name,
        terminalCount: ws.terminals.length,
        isActive: ws.id === this.activeId,
        lastActiveAt: ws.lastActiveAt,
      }));
  }

  terminalViews(workspaceId: string): TerminalView[] {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return [];
    return ws.terminals.map((entry) => ({
      id: entry.id,
      workspaceId: ws.id,
      name: entry.name,
      kind: entry.kind,
      state: this.terminalState(entry),
      hasStartCommand: entry.startCommand !== undefined,
      cwd: entry.cwd,
    }));
  }

  getActiveWorkspaceId(): string | null {
    return this.activeId;
  }

  private terminalState(entry: TerminalEntry): TerminalState {
    if (this.errorIds.has(entry.id)) return 'error';
    if (!this.terminals.has(entry.id)) return 'closed';
    const trangThai = this.statuses.get(entry.id);
    if (trangThai !== undefined) return trangThai;
    // Registry chưa thấy session (claude còn đang boot/resume) — báo "đang tải" thay vì
    // "đang mở" để người dùng biết extension vẫn đang làm việc, không phải đơ.
    if (this.loadingIds.has(entry.id)) return 'loading';
    return 'open';
  }

  /**
   * Đánh dấu các entry "đang tải" — trạng thái thật từ registry tự thay khi poll bắt được
   * (statuses có ưu tiên cao hơn), trần LOADING_TIMEOUT_MS để không xoay vĩnh viễn khi
   * session không bao giờ hiện (claude thoát ngay, resume id hỏng…).
   */
  private batDauLoading(ids: string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) this.loadingIds.add(id);
    if (this.loadingTimer !== null) clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      this.loadingTimer = null;
      this.loadingIds.clear();
      this.onChanged.fire();
    }, LOADING_TIMEOUT_MS);
  }

  private ketThucLoading(): void {
    if (this.loadingTimer !== null) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.loadingIds.clear();
  }

  // ------------------------------------------------------------- lưu trữ

  /** Đánh dấu workspace này do cửa sổ hiện tại làm chủ ở lần lưu tới. */
  private touch(workspaceId: string): void {
    this.touchedIds.add(workspaceId);
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Ghi ngay xuống đĩa (dùng khi deactivate và trước khi gửi lệnh launch có sessionId mới). */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.saveNow();
  }

  private saveNow(): void {
    try {
      // Cửa sổ VS Code khác có thể đã ghi file này từ lúc ta nạp: đọc lại rồi gộp theo id,
      // nếu không lần lưu của ta sẽ xóa sạch workspace mà cửa sổ kia vừa tạo.
      // Đĩa hỏng ở đúng thời điểm này thì loadStore đã tự backup + trả store rỗng — chấp nhận.
      const reread = loadStore(realStoreFs, this.filePath, Date.now);
      if (reread.recoveredFrom !== null && !this.warnedRecovered) {
        // Đĩa hỏng ngay giữa lúc lưu: người dùng phải biết vì sao workspace của cửa sổ khác
        // vừa biến mất khỏi cây. Chỉ báo một lần cho cả phiên.
        this.warnedRecovered = true;
        void vscode.window.showWarningMessage(
          `File workspaces.json bị hỏng nên đã được sao lưu sang ${reread.recoveredFrom}; chỉ còn giữ lại workspace của cửa sổ này.`,
        );
      }
      const merged = mergeForSave(reread.store, this.store, this.deletedIds, this.touchedIds);
      saveStore(realStoreFs, this.filePath, merged);
      this.store = merged;
      this.dirty = false;
      // Tree thấy luôn workspace của cửa sổ khác sau mỗi lần lưu.
      this.onChanged.fire();
    } catch (error) {
      if (error instanceof ZodError) {
        // Lỗi schema là lỗi lập trình, KHÔNG tự hết: nói thẳng thay vì hứa "thử lại".
        const detail = error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        void vscode.window.showWarningMessage(
          `Trạng thái workspace không hợp lệ nên không được ghi xuống ${this.filePath}. Lỗi này sẽ không tự hết: ${detail}`,
        );
      } else {
        // Lỗi đĩa thường là tạm thời — giữ cờ dirty để lần save sau thử lại.
        void vscode.window.showWarningMessage(
          `Không ghi được ${this.filePath}: ${String(error)}. Sẽ thử lại ở lần lưu sau.`,
        );
      }
    }
  }

  // ---------------------------------------------------- vòng đời workspace

  async createAndActivate(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Tên workspace mới',
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (name === undefined) return;

    let ws: Workspace;
    try {
      ws = createWorkspace(this.store, name.trim(), randomUUID());
      this.touch(ws.id);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    this.scheduleSave();
    this.flush();
    this.onChanged.fire();
    await this.activate(ws.id);
  }

  async activate(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;

    if (this.activeId === workspaceId) {
      const opened = ws.terminals.find((entry) => this.terminals.has(entry.id));
      if (opened) this.terminals.focus(opened.id);
      return;
    }

    // Không có active ws thì không có modal nào chặn, cây vẫn bấm được trong lúc withProgress
    // chạy. Hai lượt activate song song đều ghi activeWindowId = sessionId nhưng chỉ một lượt
    // thắng activeId — lượt thua để lại khóa V5 không bao giờ được gỡ.
    if (this.activating) {
      void vscode.window.showInformationMessage('Đang mở một workspace khác, thử lại sau khi xong.');
      return;
    }
    this.activating = true;
    try {
      // Khóa V5 — best-effort, luôn có lối thoát "Vẫn mở". Hỏi TRƯỚC khi đóng workspace cũ:
      // người dùng hủy ở đây thì không được để mất terminal của workspace đang chạy.
      if (ws.activeWindowId !== null && ws.activeWindowId !== vscode.env.sessionId) {
        const answer = await vscode.window.showWarningMessage(
          `Workspace "${ws.name}" đang mở ở cửa sổ khác.`,
          { modal: true },
          'Vẫn mở',
        );
        if (answer !== 'Vẫn mở') return;
      }

      if (this.activeId !== null) {
        const current = findWorkspace(this.store, this.activeId);
        const answer = await vscode.window.showWarningMessage(
          `Lưu và đóng workspace "${current?.name ?? this.activeId}" trước khi mở "${ws.name}"?`,
          { modal: true },
          'Lưu và đóng',
        );
        if (answer !== 'Lưu và đóng') return;
        await this.closeActive();
      }

      // Modal ở trên có thể mở vô hạn; một lượt saveNow trong lúc đó có thể đã thay object
      // workspace trong store bằng bản đĩa (merge rule b cho ws CHƯA touch). Lấy lại object
      // hiện hành rồi mới touch — hai lệnh đồng bộ liền nhau nên không timer nào chen giữa
      // được. KHÔNG touch trước modal: người dùng bấm Hủy mà ta đã nhận chủ quyền thì suốt
      // phiên này ta lại ghi đè bản của cửa sổ khác.
      const wsNow = findWorkspace(this.store, workspaceId);
      if (!wsNow) {
        void vscode.window.showWarningMessage('Workspace không còn tồn tại.');
        return;
      }
      this.touch(wsNow.id);

      for (const entry of wsNow.terminals) this.errorIds.delete(entry.id);

      // Terminal đang mở (đã adopt vào ws này từ trước) phải được để yên: TerminalManager.create
      // dùng chung key sẽ dispose terminal cũ — giết một shell đang chạy dở. Và gửi lệnh
      // `--resume` vào một terminal đang chạy claude thì lệnh đó bị gõ thẳng vào hội thoại
      // đang sống. Chỉ mở những entry thực sự chưa có terminal.
      const toOpen: Workspace = {
        ...wsNow,
        terminals: wsNow.terminals.filter((entry) => !this.terminals.has(entry.id)),
      };
      // Claude cần nhiều giây boot + resume trước khi registry thấy session — đánh dấu
      // "đang tải" ngay để cây có phản hồi tức thì, không trông như đơ.
      this.batDauLoading(
        toOpen.terminals.filter((t) => t.kind === 'claude').map((t) => t.id),
      );
      this.onChanged.fire();
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Đang mở workspace "${wsNow.name}"…` },
        () => activateWorkspace(toOpen, this.buildPorts(wsNow)),
      );
      this.applyReport(report);

      this.activeId = wsNow.id;
      wsNow.lastActiveAt = new Date().toISOString();
      wsNow.activeWindowId = vscode.env.sessionId;
      this.startActivePoll();
      this.scheduleSave();
      this.flush();
      this.onChanged.fire();
    } finally {
      this.activating = false;
    }
  }

  private applyReport(report: ActivateReport): void {
    for (const failed of report.failed) this.errorIds.add(failed.id);
    if (report.failed.length > 0) {
      const detail = report.failed.map((f) => f.reason).join('; ');
      void vscode.window.showWarningMessage(
        `Không mở được ${report.failed.length} terminal: ${detail}`,
      );
    }
  }

  private buildPorts(ws: Workspace): ActivatePorts {
    const trustKey = `ws:${ws.id}`;
    return {
      createTerminal: (entry) => {
        const handle = this.terminals.create(entry.id, {
          name: entry.name,
          cwd: entry.cwd,
          location: ws.terminalLocation,
        });
        this.ghiNhanShellPid(entry.id);
        return handle;
      },
      agent: this.agent,
      fsExists: (p) => nodeFs.existsSync(p),
      isTrusted: (commands) => this.trust.isTrusted(trustKey, commands),
      confirmTrust: async (commands) => {
        const lines = commands.map((c) => `• ${c}`).join('\n');
        const answer = await vscode.window.showWarningMessage(
          `Workspace "${ws.name}" sẽ chạy các lệnh sau trên máy bạn:\n\n${lines}`,
          { modal: true },
          'Tin và chạy',
        );
        if (answer !== 'Tin và chạy') return false;
        await this.trust.trust(trustKey, commands);
        return true;
      },
      onMinted: async (terminalId, sessionId) => {
        // sessionId phải nằm trên đĩa TRƯỚC khi lệnh launch chạy, nếu không cuộc hội thoại
        // vừa tạo sẽ mồ côi khi VS Code tắt đột ngột.
        const entry = ws.terminals.find((t) => t.id === terminalId);
        if (entry) {
          entry.claudeSessionId = sessionId;
          entry.claudeName = entry.claudeName ?? entry.name;
        }
        this.touch(ws.id);
        this.scheduleSave();
        this.flush();
        await Promise.resolve();
      },
      warn: (message) => {
        void vscode.window.showWarningMessage(message);
      },
    };
  }

  /**
   * Đường đi của LỆNH đóng workspace — hỏi confirm trước. Luồng chuyển workspace trong
   * activate() gọi thẳng closeActive() vì đã có modal "Lưu và đóng X trước khi mở Y?" riêng.
   * Check activeId TRƯỚC modal: Extension Host headless (smoke test) không có ai bấm.
   */
  async closeActiveConfirmed(): Promise<void> {
    const id = this.activeId;
    if (id === null) return;
    const ten = findWorkspace(this.store, id)?.name ?? '';
    const answer = await vscode.window.showWarningMessage(
      `Đóng workspace "${ten}"? Terminal của nó sẽ đóng — trạng thái đã tự lưu, kích hoạt lại là mở tiếp.`,
      { modal: true },
      'Đóng',
    );
    if (answer !== 'Đóng') return;
    // Trong lúc chờ modal, workspace có thể đã bị đóng/chuyển bởi luồng khác.
    if (this.activeId !== id) return;
    await this.closeActive();
  }

  async closeActive(): Promise<void> {
    const id = this.activeId;
    if (id === null) return;
    // Quét bắt session lần cuối TRƯỚC khi dispose terminal — dispose xong là hết đường bắt.
    await this.finalClaimSweep();
    this.stopActivePoll();
    this.ketThucLoading();
    this.flush();

    const ws = findWorkspace(this.store, id);
    if (ws) {
      for (const entry of ws.terminals) {
        this.terminals.get(entry.id)?.dispose();
        this.statuses.delete(entry.id);
        // Không xóa thì nhãn "lỗi" của lần activate trước còn dính mãi ở lần mở sau.
        this.errorIds.delete(entry.id);
      }
      ws.activeWindowId = null;
      this.touch(ws.id);
    }
    this.activeId = null;
    this.scheduleSave();
    this.flush();
    this.onChanged.fire();
  }

  async rename(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;
    const name = await vscode.window.showInputBox({
      prompt: 'Tên workspace mới',
      value: ws.name,
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (name === undefined) return;
    const trimmed = name.trim();
    if (trimmed === '') return;

    // Lấy lại object sau await rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) return;
    if (trimmed === wsNow.name) return;

    const lower = trimmed.toLowerCase();
    if (this.store.workspaces.some((w) => w.id !== wsNow.id && w.name.toLowerCase() === lower)) {
      void vscode.window.showWarningMessage(`Tên workspace "${trimmed}" đã tồn tại.`);
      return;
    }
    wsNow.name = trimmed;
    this.touch(wsNow.id);
    this.scheduleSave();
    this.onChanged.fire();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;
    const answer = await vscode.window.showWarningMessage(
      `Xóa workspace "${ws.name}"? Terminal đang mở không bị đóng.`,
      { modal: true },
      'Xóa',
    );
    if (answer !== 'Xóa') return;

    // Lấy lại object sau modal: bản trong store có thể đã bị merge thay bằng bản đĩa, và
    // danh sách terminal của bản cũ có thể đã lỗi thời (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) return;

    // Xóa workspace KHÔNG bao giờ giết terminal thật — người dùng chỉ muốn quên danh sách,
    // không muốn mất việc đang chạy.
    if (this.activeId === wsNow.id) this.activeId = null;
    wsNow.activeWindowId = null;
    // Bia mộ: nếu không nhớ, lần save sau sẽ thấy nó còn trên đĩa và "cứu" nó sống lại.
    this.deletedIds.add(wsNow.id);
    for (const entry of wsNow.terminals) {
      this.terminals.release(entry.id);
      this.statuses.delete(entry.id);
      this.errorIds.delete(entry.id);
    }
    this.store.workspaces = this.store.workspaces.filter((w) => w.id !== wsNow.id);
    this.scheduleSave();
    this.flush();
    this.onChanged.fire();
  }

  // ------------------------------------------------------------- terminal

  /**
   * Flow tối giản: hỏi đúng MỘT đường dẫn → duyệt biến thể lệnh bằng phím mũi tên →
   * terminal mở ngay tại đó và chạy lệnh. Tên lấy theo thư mục, đổi sau bằng Rename.
   */
  async newClaudeTerminal(workspaceId: string): Promise<void> {
    if (!findWorkspace(this.store, workspaceId)) return;

    const duongDan = await this.hoiDuongDan();
    if (duongDan === undefined) return;
    const cwd = duongDan;
    const ten = path.basename(cwd) || 'claude';

    const luaChon = await vscode.window.showQuickPick(this.agent.buildLaunchOptions(ten), {
      placeHolder: 'Chạy Claude thế nào?',
    });
    if (!luaChon) return;

    // Lấy lại object sau chuỗi input/quickpick rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) {
      void vscode.window.showWarningMessage('Workspace không còn tồn tại.');
      return;
    }
    this.touch(wsNow.id);

    // Phiên mới có sessionId mint sẵn → entry claude, resume đảm bảo. Biến thể -c/-r nối vào
    // hội thoại có sẵn nên không biết trước id → entry plain, matcher phả hệ PID sẽ thăng cấp
    // nó trong vài giây khi claude hiện trong registry.
    const entry: TerminalEntry =
      luaChon.sessionId !== undefined
        ? {
            id: randomUUID(),
            name: ten,
            cwd,
            kind: 'claude',
            claudeSessionId: luaChon.sessionId,
            claudeName: ten,
          }
        : { id: randomUUID(), name: ten, cwd, kind: 'plain' };
    upsertTerminal(wsNow, entry);
    this.scheduleSave();
    // Id mint phải nằm trên đĩa TRƯỚC khi lệnh chạy (chống mồ côi hội thoại).
    this.flush();

    const handle = this.terminals.create(entry.id, {
      name: entry.name,
      cwd,
      location: wsNow.terminalLocation,
    });
    this.ghiNhanShellPid(entry.id);
    handle.sendText(luaChon.command);
    // Claude boot mất nhiều giây trước khi registry thấy — spinner cho tới khi có trạng thái.
    this.batDauLoading([entry.id]);
    this.onChanged.fire();
    // Ghi lịch sử SAU cùng, không await: không được chèn await vào giữa re-resolve và touch.
    void this.nhoCwd(cwd);
  }

  /**
   * Tạo terminal thường: hỏi MỘT đường dẫn → terminal mở ngay tại đó (vị trí theo setting
   * `aiWorkspace.terminalLocation`, mặc định editor area), entry `plain` vào workspace.
   * Lệnh chạy trong đó được auto-capture như mọi terminal thường khác.
   */
  async newPlainTerminal(workspaceId: string): Promise<void> {
    if (!findWorkspace(this.store, workspaceId)) return;

    const duongDan = await this.hoiDuongDan();
    if (duongDan === undefined) return;
    const cwd = duongDan;
    const ten = path.basename(cwd) || 'terminal';

    // Lấy lại object sau await rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) {
      void vscode.window.showWarningMessage('Workspace không còn tồn tại.');
      return;
    }
    this.touch(wsNow.id);

    const entry: TerminalEntry = { id: randomUUID(), name: ten, cwd, kind: 'plain' };
    upsertTerminal(wsNow, entry);
    this.scheduleSave();

    this.terminals.create(entry.id, {
      name: entry.name,
      cwd,
      location: wsNow.terminalLocation,
    });
    this.ghiNhanShellPid(entry.id);
    this.onChanged.fire();
    void this.nhoCwd(cwd);
  }

  /**
   * Cài đặt riêng của workspace — hiện có một mục: vị trí mở terminal (đè setting chung
   * `aiWorkspace.terminalLocation`). Áp cho terminal tạo mới lẫn khôi phục của workspace này.
   */
  async workspaceSettings(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;

    const setingChung = vscode.workspace
      .getConfiguration('aiWorkspace')
      .get<string>('terminalLocation', 'editor');
    const hienTai = ws.terminalLocation;
    const danhDau = (v: 'editor' | 'panel' | undefined) => (v === hienTai ? ' — hiện tại' : '');
    const luaChon = await vscode.window.showQuickPick(
      [
        {
          label: `Theo setting chung (${setingChung === 'panel' ? 'panel dưới' : 'editor area'})`,
          description: `aiWorkspace.terminalLocation${danhDau(undefined)}`,
          value: undefined as 'editor' | 'panel' | undefined,
        },
        {
          label: 'Editor area',
          description: `tab trong vùng chính${danhDau('editor')}`,
          value: 'editor' as const,
        },
        {
          label: 'Panel dưới',
          description: `panel terminal cổ điển${danhDau('panel')}`,
          value: 'panel' as const,
        },
      ],
      { placeHolder: `Vị trí mở terminal của workspace "${ws.name}"` },
    );
    if (!luaChon) return;

    // Lấy lại object sau QuickPick rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) return;
    this.touch(wsNow.id);
    if (luaChon.value === undefined) delete wsNow.terminalLocation;
    else wsNow.terminalLocation = luaChon.value;
    this.scheduleSave();
  }

  // --------------------------------------------------------- chọn đường dẫn

  private lichSuCwd(): string[] {
    return this.boNhoChung.get<string[]>(KHOA_LICH_SU_CWD) ?? [];
  }

  /** Đưa đường dẫn vừa dùng lên đầu lịch sử (không await ở đường tạo terminal). */
  private async nhoCwd(cwd: string): Promise<void> {
    const moi = gopGoiYDuongDan([[cwd], this.lichSuCwd()]).slice(0, LICH_SU_CWD_TOI_DA);
    await this.boNhoChung.update(KHOA_LICH_SU_CWD, moi);
  }

  /**
   * Hỏi thư mục làm việc bằng QuickPick thay vì ô nhập trắng: gõ vài ký tự là lọc trong các
   * đường dẫn đã dùng (lịch sử → cwd của terminal đã biết → thư mục đang mở). Không có trong
   * danh sách thì gõ/dán đường dẫn đầy đủ, mục đầu tiên luôn là chính chuỗi vừa gõ.
   *
   * Dùng createQuickPick (không phải showQuickPick) vì cần mục động theo từng ký tự và cần
   * GIỮ hộp thoại mở khi đường dẫn gõ vào không tồn tại — bắt người dùng mở lại từ đầu chỉ
   * vì gõ sai một ký tự là tệ hơn hẳn.
   */
  private async hoiDuongDan(): Promise<string | undefined> {
    type Muc = vscode.QuickPickItem & { duongDan: string };
    const goiY = gopGoiYDuongDan([
      this.lichSuCwd(),
      this.store.workspaces.flatMap((w) => w.terminals.map((t) => t.cwd)),
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    ]);
    const mucGoiY: Muc[] = goiY.map((p) => ({
      label: path.basename(p) || p,
      description: p,
      duongDan: p,
    }));

    return await new Promise<string | undefined>((resolve) => {
      let ketQua: string | undefined;
      const qp = vscode.window.createQuickPick<Muc>();
      qp.title = 'Thư mục làm việc cho terminal';
      qp.placeholder = 'Gõ vài ký tự để tìm trong đường dẫn đã dùng, hoặc dán đường dẫn đầy đủ';
      // Lọc cả theo description: người dùng gõ "qualipa" phải khớp được giữa đường dẫn.
      qp.matchOnDescription = true;
      qp.items = mucGoiY;
      qp.onDidChangeValue((v) => {
        const go = v.trim();
        if (go === '' || goiY.some((p) => p === go)) {
          qp.items = mucGoiY;
          return;
        }
        qp.items = [
          {
            label: go,
            description: nodeFs.existsSync(go) ? 'dùng đường dẫn này' : 'không tồn tại',
            duongDan: go,
            alwaysShow: true,
          },
          ...mucGoiY,
        ];
      });
      qp.onDidAccept(() => {
        const duongDan = (qp.selectedItems[0]?.duongDan ?? qp.value).trim();
        if (duongDan === '') return;
        if (!nodeFs.existsSync(duongDan)) {
          qp.title = `Đường dẫn không tồn tại: ${duongDan}`;
          return; // giữ hộp thoại mở để sửa tiếp
        }
        ketQua = duongDan;
        qp.hide();
      });
      qp.onDidHide(() => {
        qp.dispose();
        resolve(ketQua);
      });
      qp.show();
    });
  }

  /**
   * Xem thông tin (metadata) của một workspace: id, lần active gần nhất, cửa sổ đang giữ,
   * vị trí mở terminal, file lưu, và danh sách terminal kèm đường dẫn. Cho sao chép nguyên
   * khối (tiện dán vào issue/chat khi cần hỏi) hoặc mở thẳng file lưu.
   */
  async showWorkspaceInfo(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;

    const dangMo = ws.terminals.filter((t) => this.terminals.has(t.id)).length;
    const setingChung = vscode.workspace
      .getConfiguration('aiWorkspace')
      .get<string>('terminalLocation', 'editor');
    const viTri =
      ws.terminalLocation === undefined
        ? `theo setting chung (${setingChung === 'panel' ? 'panel dưới' : 'editor area'})`
        : ws.terminalLocation === 'panel'
          ? 'riêng: panel dưới'
          : 'riêng: editor area';
    const cuaSo =
      ws.activeWindowId === null
        ? 'không cửa sổ nào'
        : ws.activeWindowId === vscode.env.sessionId
          ? 'cửa sổ này'
          : 'một cửa sổ VS Code khác';
    const danhSach = ws.terminals
      .map((t) => {
        const loai = t.kind === 'claude' ? 'AI' : 'shell';
        const moChua = this.terminals.has(t.id) ? 'đang mở' : 'chưa mở';
        const lenh = t.startCommand !== undefined ? `\n    lệnh khởi động: ${t.startCommand}` : '';
        const phien = t.claudeSessionId !== undefined ? `\n    session: ${t.claudeSessionId}` : '';
        return `• ${t.name} (${loai}, ${moChua})\n    ${t.cwd}${lenh}${phien}`;
      })
      .join('\n');
    const khoi = [
      `Tên: ${ws.name}`,
      `Id: ${ws.id}`,
      `Lần active gần nhất: ${
        ws.lastActiveAt === null ? 'chưa từng' : new Date(ws.lastActiveAt).toLocaleString('vi-VN')
      }`,
      `Đang giữ bởi: ${cuaSo}`,
      `Terminal: ${ws.terminals.length} (${dangMo} đang mở)`,
      `Vị trí mở terminal: ${viTri}`,
      `File lưu: ${this.filePath}`,
      ws.terminals.length > 0 ? `\nDanh sách terminal:\n${danhSach}` : '\n(Chưa có terminal nào.)',
    ].join('\n');

    const answer = await vscode.window.showInformationMessage(
      `Thông tin workspace "${ws.name}"`,
      { modal: true, detail: khoi },
      'Sao chép thông tin',
      'Mở file lưu',
    );
    if (answer === 'Sao chép thông tin') {
      await vscode.env.clipboard.writeText(khoi);
      void vscode.window.showInformationMessage('Đã sao chép thông tin workspace.');
      return;
    }
    if (answer === 'Mở file lưu') {
      // File chỉ được ghi khi có thay đổi đầu tiên — workspace vừa tạo có thể chưa kịp có file.
      if (!nodeFs.existsSync(this.filePath)) {
        void vscode.window.showWarningMessage(`Chưa có file lưu tại ${this.filePath}.`);
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.filePath));
    }
  }

  /**
   * Xem đường dẫn gốc của terminal: hiện đầy đủ (kèm cảnh báo nếu đã mất) và cho sao chép
   * hoặc mở thẳng thư mục đó trong trình quản lý file của hệ điều hành.
   */
  async showTerminalPath(workspaceId: string, terminalId: string): Promise<void> {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return;
    const cwd = entry.cwd;
    const conTonTai = nodeFs.existsSync(cwd);
    const answer = await vscode.window.showInformationMessage(
      `Đường dẫn của terminal "${entry.name}"`,
      {
        modal: true,
        detail: conTonTai ? cwd : `${cwd}\n\n(Đường dẫn này không còn tồn tại trên máy.)`,
      },
      'Sao chép đường dẫn',
      ...(conTonTai ? ['Mở thư mục'] : []),
    );
    if (answer === 'Sao chép đường dẫn') {
      await vscode.env.clipboard.writeText(cwd);
      void vscode.window.showInformationMessage(`Đã sao chép: ${cwd}`);
      return;
    }
    if (answer === 'Mở thư mục') {
      // Đọc lại ngay trước khi mở: hộp thoại có thể mở rất lâu, thư mục có thể vừa bị xóa.
      if (!nodeFs.existsSync(cwd)) {
        void vscode.window.showWarningMessage(`Đường dẫn không còn tồn tại: ${cwd}`);
        return;
      }
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(cwd));
    }
  }

  /** Đổi tên hiển thị của terminal trong workspace (và widget đang mở, để name-sync không kéo tên cũ về). */
  async renameTerminal(workspaceId: string, terminalId: string): Promise<void> {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return;
    const ten = await vscode.window.showInputBox({
      prompt: 'Tên mới cho terminal',
      value: entry.name,
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (ten === undefined || ten.trim() === '') return;

    const entryNow = this.findEntry(workspaceId, terminalId);
    if (!entryNow) return;
    entryNow.name = ten.trim();
    this.touch(workspaceId);
    this.scheduleSave();

    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.show(false);
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', {
        name: ten.trim(),
      });
    }
    this.onChanged.fire();
  }

  /** Mở lại đúng MỘT entry, tái dùng nguyên nhánh launch của orchestrator. */
  private async launchOne(ws: Workspace, entry: TerminalEntry): Promise<void> {
    // Xem ghi chú ở activate(): ports cầm `ws`, nên nó phải là workspace do cửa sổ này làm chủ
    // trước khi có bất kỳ await nào.
    this.touch(ws.id);
    this.errorIds.delete(entry.id);
    const single: Workspace = { ...ws, terminals: [entry] };
    const report = await activateWorkspace(single, this.buildPorts(ws));
    this.applyReport(report);
    this.onChanged.fire();
  }

  async setStartCommand(workspaceId: string, terminalId: string): Promise<void> {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return;
    const value = await vscode.window.showInputBox({
      prompt: 'Lệnh chạy sau khi mở lại terminal (để trống để xóa)',
      value: entry.startCommand ?? '',
    });
    if (value === undefined) return;
    const trimmed = value.trim();
    // Lấy lại entry sau input box: merge có thể đã thay cả object workspace lẫn entry bên
    // trong nó, sửa bản cũ là sửa vào object mồ côi (xem ghi chú ở activate()).
    const entryNow = this.findEntry(workspaceId, terminalId);
    if (!entryNow) return;
    this.touch(workspaceId);
    // KHÔNG tự trust lại: fingerprint đổi nên lần activate sau sẽ hỏi lại — đúng thiết kế.
    if (trimmed === '') delete entryNow.startCommand;
    else entryNow.startCommand = trimmed;
    this.scheduleSave();
    this.onChanged.fire();
  }

  async removeTerminal(workspaceId: string, terminalId: string): Promise<void> {
    // Nhả trước mọi lối thoát sớm: workspace biến mất (đã bị xóa) mà key còn trong map thì
    // terminal đó vĩnh viễn không được nhận nuôi lại. Không dispose terminal thật —
    // gỡ khỏi workspace chỉ là quên nó đi.
    this.terminals.release(terminalId);
    this.statuses.delete(terminalId);
    this.errorIds.delete(terminalId);
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;
    removeTerminalEntry(ws, terminalId);
    this.touch(ws.id);
    this.scheduleSave();
    this.onChanged.fire();
    await Promise.resolve();
  }

  focusTerminal(workspaceId: string, terminalId: string): void {
    if (this.terminals.focus(terminalId)) return;
    const ws = findWorkspace(this.store, workspaceId);
    const entry = ws?.terminals.find((t) => t.id === terminalId);
    if (!ws || !entry) return;
    if (this.activeId !== ws.id) {
      void vscode.window.showInformationMessage(
        `Kích hoạt workspace "${ws.name}" trước, rồi mới mở lại được terminal "${entry.name}".`,
      );
      return;
    }
    void this.launchOne(ws, entry);
  }

  private findEntry(workspaceId: string, terminalId: string): TerminalEntry | undefined {
    return findWorkspace(this.store, workspaceId)?.terminals.find((t) => t.id === terminalId);
  }

  // ------------------------------------------------------------ adoption

  private async onTerminalOpened(terminal: vscode.Terminal): Promise<void> {
    if (this.activeId === null) return;
    if (this.terminals.ownsTerminal(terminal) !== null) return;
    const ws = findWorkspace(this.store, this.activeId);
    if (!ws) return;

    const decision = classifyTerminal({
      isPty: 'pty' in terminal.creationOptions,
      creationName: (terminal.creationOptions as vscode.TerminalOptions).name,
    });

    if (decision === 'suggest') {
      const answer = await vscode.window.showInformationMessage(
        `Thêm terminal "${terminal.name}" vào workspace "${ws.name}"?`,
        'Thêm',
      );
      if (answer !== 'Thêm') return;
      // Sau khi chờ người dùng bấm: workspace có thể đã bị xóa/đóng, và object của nó có thể
      // đã bị merge thay bằng bản đĩa — phải adopt vào object HIỆN HÀNH, không phải bản cũ
      // (xem ghi chú ở activate()).
      if (this.activeId !== ws.id) return;
      const wsNow = findWorkspace(this.store, ws.id);
      if (!wsNow) return;
      if (this.terminals.ownsTerminal(terminal) !== null) return;
      this.adoptInto(wsNow, terminal);
      return;
    }

    const entry = this.adoptInto(ws, terminal);
    if (!entry) return;
    const answer = await vscode.window.showInformationMessage(
      `Đã thêm "${terminal.name}" vào workspace "${ws.name}".`,
      'Bỏ ra',
    );
    if (answer === 'Bỏ ra') await this.removeTerminal(ws.id, entry.id);
  }

  /**
   * Bảng tiến trình có cache: dùng lại khi còn tươi (TTL) VÀ đã chứa mọi pid session cần
   * tra — session mới xuất hiện thì pid nó chưa có trong cache, buộc đọc lại ngay để không
   * bắt trượt rồi rơi xuống QuickPick oan.
   */
  private async layBangTienTrinh(pidCanTra: number[], epDocTuoi = false): Promise<Map<number, number>> {
    const TTL_MS = 30_000;
    const cache = this.bangTienTrinhCache;
    if (
      !epDocTuoi &&
      cache !== null &&
      Date.now() - cache.luc < TTL_MS &&
      pidCanTra.every((pid) => cache.bang.has(pid) || cache.vangMat.has(pid))
    ) {
      return cache.bang;
    }
    const bang = await docBangTienTrinh();
    // Máy nào cũng có tiến trình, nên bảng RỖNG chỉ có nghĩa là đọc hỏng (CIM timeout, lỗi
    // quyền). KHÔNG cache kết quả hỏng: cache nó thì suốt 30 giây sau mọi phép tra phả hệ
    // đều trả "không thuộc terminal nào" — đúng lúc finalClaimSweep chạy là mất cơ hội cuối.
    if (bang.size === 0) return bang;
    // Cache cả kết quả ÂM: pid vắng mặt ngay sau lần đọc MỚI nghĩa là hàng registry chết
    // hoặc ngoài tầm nhìn — nếu không ghi nhớ, một pid như vậy sẽ ép đọc lại bảng (cỡ giây)
    // ở MỌI nhịp poll 3s cho tới hết phiên.
    const vangMat = new Set(pidCanTra.filter((pid) => !bang.has(pid)));
    this.bangTienTrinhCache = { luc: Date.now(), bang, vangMat };
    return bang;
  }

  /** Ghi PID shell của terminal (bất đồng bộ) để tra phả hệ tiến trình khi match session. */
  private ghiNhanShellPid(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    void terminal.processId.then((pid) => {
      if (typeof pid === 'number' && this.terminals.has(terminalId)) {
        this.shellPids.set(terminalId, pid);
        // Có shell mới → kết luận "ngoài cửa sổ này" của các lần tra trước hết giá trị.
        this.pidNgoaiCuaSo.clear();
        this.daTraKhongThayClaude.delete(terminalId);
      }
    });
  }

  /** Workspace đang chứa terminal này (terminal có thể thuộc workspace không active). */
  private timWorkspaceChuaTerminal(terminalId: string): Workspace | undefined {
    return this.store.workspaces.find((ws) => ws.terminals.some((t) => t.id === terminalId));
  }

  // ------------------------------------------------- bắt app đang chạy

  private onShellExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const key = this.terminals.ownsTerminal(event.terminal);
    if (key === null) return;
    const ws = this.timWorkspaceChuaTerminal(key);
    if (!ws) return;
    const entry = ws.terminals.find((t) => t.id === key);
    if (!entry) return;
    const lenh = event.execution.commandLine.value;
    const laLenhAgent = this.agent.ownsCommand(lenh);
    if (laLenhAgent) {
      // Vừa chạy claude trong terminal này → kết luận "đã tra, không có claude" và cặp phả hệ
      // đã xác nhận của lần trước hết hiệu lực. CHỈ xóa cho lệnh claude: xóa cho mọi lệnh vặt
      // (`ls`, `git status`) mở lại cổng đọc bảng tiến trình mà chẳng thêm khả năng phát hiện
      // nào — claude mới khởi động luôn có pid mới, tự kích điều kiện "session chưa ai nhận".
      this.daTraKhongThayClaude.delete(key);
      this.phaHeDaXacNhan.delete(key);
    }
    if (!nenBatLenh(entry.kind, laLenhAgent, lenh)) return;

    this.pendingCommands.set(key, {
      lenh,
      luuTruoc: entry.startCommand,
      batDauLuc: Date.now(),
      token: event.execution,
    });
    // Ghi NGAY lúc lệnh bắt đầu: VS Code chết giữa chừng thì app đang chạy vẫn nằm trên đĩa
    // và lần mở lại workspace sẽ chạy lại nó. Lệnh hóa ra vặt thì trả lại ở onShellExecutionEnd.
    entry.startCommand = lenh;
    this.touch(ws.id);
    this.scheduleSave();
    this.onChanged.fire();
  }

  private onShellExecutionEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const key = this.terminals.ownsTerminal(event.terminal);
    if (key === null) return;
    const p = this.pendingCommands.get(key);
    // Ghép cặp bằng identity của execution — commandLine.value có thể bị VS Code tinh chỉnh
    // lại giữa start và end nên so chuỗi sẽ rớt cặp và để lệnh vặt chiếm chỗ vĩnh viễn.
    if (!p || p.token !== event.execution) return;
    this.pendingCommands.delete(key);

    const ws = this.timWorkspaceChuaTerminal(key);
    if (!ws) return;
    const entry = ws.terminals.find((t) => t.id === key);
    // Entry đã thăng cấp claude trong lúc lệnh chạy → startCommand không còn ý nghĩa, để yên.
    if (!entry || entry.kind !== 'plain') return;

    let gia = khiKetThucLenh(p, Date.now());
    // `gia === p.lenh` cũng đúng khi luuTruoc trùng lenh (chạy lại cùng một lệnh) — vô hại,
    // vì hai giá trị như nhau; điểm chính là: giữ lệnh thì ưu tiên bản tại thời điểm end
    // (API nói nó chính xác hơn bản lúc start).
    if (gia === p.lenh) {
      const tinhChinh = event.execution.commandLine.value.trim();
      if (tinhChinh !== '') gia = tinhChinh;
    }
    if (gia === undefined) delete entry.startCommand;
    else entry.startCommand = gia;
    this.touch(ws.id);
    this.scheduleSave();
    this.onChanged.fire();
  }

  private adoptInto(ws: Workspace, terminal: vscode.Terminal): TerminalEntry | null {
    const cwd = pickCwd(
      nonEmpty(terminal.shellIntegration?.cwd?.fsPath),
      creationCwd(terminal),
      folderCwd(),
    );
    // Không đoán cwd: entry không có cwd thì lần sau không mở lại đúng chỗ được.
    if (cwd === null) return null;

    // Schema bắt name >= 1 ký tự; terminal không tên sẽ làm hỏng file store khi ghi.
    const name = terminal.name.trim() === '' ? 'terminal' : terminal.name;
    const entry: TerminalEntry = { id: randomUUID(), name, cwd, kind: 'plain' };
    upsertTerminal(ws, entry);
    this.terminals.adopt(entry.id, terminal);
    this.ghiNhanShellPid(entry.id);
    this.touch(ws.id);
    this.scheduleSave();
    this.onChanged.fire();
    return entry;
  }

  private onShellIntegrationChanged(event: vscode.TerminalShellIntegrationChangeEvent): void {
    const key = this.terminals.ownsTerminal(event.terminal);
    if (key === null || this.activeId === null) return;
    const entry = this.findEntry(this.activeId, key);
    if (!entry) return;
    const cwd = nonEmpty(event.shellIntegration.cwd?.fsPath) ?? entry.cwd;
    if (cwd === entry.cwd) return;
    entry.cwd = cwd;
    this.touch(this.activeId);
    this.scheduleSave();
  }

  async addOpenTerminal(terminal: vscode.Terminal | undefined): Promise<void> {
    // Menu chuột phải tab terminal không đảm bảo truyền đúng một `vscode.Terminal`
    // (có bản VS Code truyền context object khác). Nhận tham số chỉ khi nó thực sự là
    // terminal đang sống — nếu không, entry sẽ có name/cwd undefined và làm hỏng store.
    const known = terminal !== undefined && vscode.window.terminals.includes(terminal);
    const target = known ? terminal : vscode.window.activeTerminal;
    if (!target) {
      void vscode.window.showWarningMessage('Không có terminal nào đang mở để thêm.');
      return;
    }
    if (this.terminals.ownsTerminal(target) !== null) {
      void vscode.window.showInformationMessage('Terminal đã thuộc một workspace.');
      return;
    }

    let wsId = this.activeId;
    if (wsId === null) {
      wsId = await this.pickOrCreateWorkspaceId();
      if (wsId === null) return;
    }
    const ws = findWorkspace(this.store, wsId);
    if (!ws) return;

    const entry = this.adoptInto(ws, target);
    if (!entry) {
      void vscode.window.showWarningMessage(
        'Không xác định được thư mục làm việc của terminal nên chưa thêm được.',
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `Đã thêm "${target.name}" vào workspace "${ws.name}".`,
    );
  }

  private async pickOrCreateWorkspaceId(): Promise<string | null> {
    const CREATE = '__create__';
    const items = [
      ...this.workspaceViews().map((v) => ({ label: v.name, id: v.id })),
      { label: '$(add) Tạo workspace mới…', id: CREATE },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Chọn workspace để lưu terminal này (workspace sẽ KHÔNG được kích hoạt)',
    });
    if (!picked) return null;
    if (picked.id !== CREATE) return picked.id;

    const name = await vscode.window.showInputBox({
      prompt: 'Tên workspace mới',
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (name === undefined) return null;
    try {
      const ws = createWorkspace(this.store, name.trim(), randomUUID());
      this.touch(ws.id);
      this.scheduleSave();
      this.onChanged.fire();
      return ws.id;
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  // -------------------------------------------------------------- poll 3s

  async refreshStatuses(): Promise<void> {
    // QuickPick phân định ambiguity có thể mở lâu hơn một nhịp poll — không chồng lượt,
    // nhưng trả về promise của lượt đang chạy để caller (finalClaimSweep) chờ được nó.
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    let running: RunningSession[] = [];
    try {
      running = await this.agent.listRunning();
    } catch {
      return;
    }
    const bySession = new Map(running.map((r) => [r.sessionId, r]));

    let changed = this.syncTerminalNames();
    if (this.syncStatuses(bySession)) changed = true;
    if (await this.matchActiveWorkspace(running)) changed = true;
    if (changed) this.onChanged.fire();
  }

  /**
   * Người dùng đổi tên terminal bằng menu Rename CÓ SẴN của VS Code → không có event API
   * nào báo — đồng bộ tên widget về entry qua poll để tên trong cây và tên tab luôn khớp.
   */
  private syncTerminalNames(): boolean {
    let changed = false;
    for (const ws of this.store.workspaces) {
      for (const entry of ws.terminals) {
        const terminal = this.terminals.get(entry.id);
        if (!terminal) continue;
        const ten = terminal.name.trim();
        if (ten !== '' && ten !== entry.name) {
          entry.name = ten;
          this.touch(ws.id);
          changed = true;
        }
      }
    }
    if (changed) this.scheduleSave();
    return changed;
  }

  private startActivePoll(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.refreshStatuses();
    }, ACTIVE_POLL_MS);
  }

  private stopActivePoll(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * Cơ hội cuối để bắt session trước khi dispose terminal của workspace active — sau đó
   * cwd không còn terminal nào để đối chiếu nữa. Xóa askedCwds: nhóm mơ hồ người dùng đã
   * Esc trong phiên được hỏi lại đúng một lần nữa, vì đây là "bây giờ hoặc không bao giờ".
   */
  private async finalClaimSweep(): Promise<void> {
    const id = this.activeId;
    if (id === null) return;
    const ws = findWorkspace(this.store, id);
    if (!ws) return;
    // Bất kỳ terminal nào còn mở đều đáng quét: ngoài entry chưa có id, pass phả hệ giờ còn
    // sửa được entry ôm NHẦM id — mà cái đó nhìn từ ngoài không phân biệt được với đúng.
    const conChuaBat = ws.terminals.some((t) => this.terminals.has(t.id));
    if (!conChuaBat) return;

    // Đợi lượt poll đang dở (nếu có) xong hẳn rồi mới quét — lượt dở đã đi qua vòng hỏi
    // ambiguity với askedCwds cũ, xóa set xong phải chạy một lượt MỚI thì mới hỏi lại được.
    const inflight = this.refreshPromise;
    if (inflight) await inflight;
    this.askedCwds.clear();
    // Lần cuối rồi: không được để một lần đọc bảng tiến trình hỏng (đã cache) hay kết luận
    // "terminal này không có claude"/"cặp này đã xác nhận" của lần trước làm mất cơ hội bắt.
    this.daTraKhongThayClaude.clear();
    this.phaHeDaXacNhan.clear();
    this.epDocBangTuoi = true;
    try {
      await this.refreshStatuses();
    } finally {
      // Cờ kẹt `true` thì mọi lần tra sau đều bỏ cache và đọc lại bảng — phải trả về dù lỗi.
      this.epDocBangTuoi = false;
    }
  }

  private syncStatuses(bySession: Map<string, RunningSession>): boolean {
    let changed = false;
    for (const ws of this.store.workspaces) {
      for (const entry of ws.terminals) {
        const session = entry.claudeSessionId ? bySession.get(entry.claudeSessionId) : undefined;
        const before = this.statuses.get(entry.id);
        if (session) {
          if (before !== session.status) {
            this.statuses.set(entry.id, session.status);
            changed = true;
          }
        } else if (before !== undefined) {
          // Session biến mất khỏi registry: chỉ đổi hiển thị, KHÔNG gỡ sessionId (còn resume).
          this.statuses.delete(entry.id);
          changed = true;
        }
      }
    }
    return changed;
  }

  private async matchActiveWorkspace(running: RunningSession[]): Promise<boolean> {
    // Ứng viên: MỌI terminal đang mở mà cửa sổ này track, bất kể workspace của nó có active
    // hay không — terminal -c/-r tạo trên workspace chưa active cũng phải được thăng cấp,
    // và claudeSessionId của workspace khác cũng phải được tính là "đã có chủ".
    const chuTerminal = new Map<string, string>(); // terminalId → workspaceId
    for (const wsBatKy of this.store.workspaces) {
      for (const entry of wsBatKy.terminals) {
        if (this.terminals.has(entry.id)) chuTerminal.set(entry.id, wsBatKy.id);
      }
    }
    if (chuTerminal.size === 0) return false;
    const claim = (terminalId: string, session: RunningSession): boolean => {
      const wsId = chuTerminal.get(terminalId);
      return wsId !== undefined && this.claimSession(wsId, terminalId, session);
    };

    // Phả hệ tiến trình TRƯỚC, vì nó là bằng chứng mạnh hơn cwd và còn sửa được claim sai.
    let changed = await this.suaClaimTheoPhaHe(running, chuTerminal);

    // Ứng viên dựng SAU pass phả hệ: claim vừa bị sửa thì vòng ghép theo cwd phải thấy bản mới.
    // Chỉ terminal ĐANG MỞ mới là ứng viên; id của entry chưa mở (kể cả workspace khác, kể cả
    // do cửa sổ VS Code khác đang chạy) đi vào `idDaCoChuKhac` để không bị cướp.
    const candidates: MatchCandidate[] = [];
    const idDaCoChuKhac = new Set<string>();
    for (const wsBatKy of this.store.workspaces) {
      for (const entry of wsBatKy.terminals) {
        if (!chuTerminal.has(entry.id)) {
          if (entry.claudeSessionId !== undefined) idDaCoChuKhac.add(entry.claudeSessionId);
          continue;
        }
        candidates.push({
          terminalId: entry.id,
          cwd: entry.cwd,
          ...(entry.claudeSessionId !== undefined
            ? { claimedSessionId: entry.claudeSessionId }
            : {}),
        });
      }
    }
    const result = matchClaudeSessions(candidates, running, process.platform, idDaCoChuKhac);

    for (const pair of result.matched) {
      if (claim(pair.terminalId, pair.session)) changed = true;
    }
    if (changed) this.scheduleSave();

    for (const group of result.ambiguous) {
      if (group.sessions.length === 0 || group.terminalIds.length === 0) continue;
      // Phả hệ đã rút nhóm về 1-1 → gán bằng loại trừ, không cần hỏi. KHÔNG được chỉ
      // `continue` chờ nhịp poll sau: ở finalClaimSweep (lúc đóng workspace) không còn
      // nhịp nào nữa — bỏ qua ở đây là mất cơ hội gắn vĩnh viễn.
      if (group.sessions.length === 1 && group.terminalIds.length === 1) {
        if (claim(group.terminalIds[0]!, group.sessions[0]!)) {
          changed = true;
          this.scheduleSave();
        }
        continue;
      }
      const key = normalizeCwd(group.cwd);
      if (this.askedCwds.has(key)) continue;
      // Đánh dấu TRƯỚC khi hỏi: bỏ qua (Esc) cũng tính là đã hỏi, không spam mỗi 3 giây.
      this.askedCwds.add(key);
      if (await this.resolveAmbiguity(chuTerminal, group.terminalIds, group.sessions)) {
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Phả hệ tiến trình là BẰNG CHỨNG THẬT: pid của session đi ngược lên tổ tiên gặp pid shell
   * của terminal nào thì nó đang chạy trong terminal đó — bất kể cwd ghi trong entry (người
   * dùng `cd` chỗ khác rồi mới chạy claude) và bất kể entry nào đang giữ id đó. Nên pass này
   * còn SỬA được claim sai: gặp thật trên máy người dùng — một entry ôm nhầm session của
   * terminal khác, terminal đúng vì thế vĩnh viễn không bắt được (session đã "có chủ" nên bị
   * lọc khỏi vòng ghép) và kẹt ở nhãn "đang mở" dù claude chạy sờ sờ trong đó.
   *
   * Đọc bảng tiến trình tốn cỡ giây nên chỉ chạy khi CÓ dấu hiệu bất thường:
   *  - terminal khai là `claude` mà không giữ session nào còn sống, HOẶC
   *  - entry giữ session sống nhưng cwd session khác cwd entry (dấu hiệu claim sai), HOẶC
   *  - có session sống chưa ai nhận, mà pid của nó chưa từng bị kết luận là "ngoài cửa sổ này".
   */
  private async suaClaimTheoPhaHe(
    running: RunningSession[],
    chuTerminal: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    const song = running.filter((r) => r.kind === 'interactive');
    if (song.length === 0) return false;
    // Quét bắt lần cuối được miễn backoff — TRỪ khi máy này đọc hỏng liên tục (WMI khóa):
    // khi đó mỗi lần đóng workspace phải chờ thêm 5 giây timeout mà chẳng bao giờ có kết quả.
    const boQuaLui = this.epDocBangTuoi && this.docBangHongLienTiep < HONG_LIEN_TIEP_BO_CUOC;
    const luiMs = Math.min(
      LUI_SAU_DOC_HONG_MS * Math.max(1, this.docBangHongLienTiep),
      LUI_TOI_DA_MS,
    );
    if (!boQuaLui && this.docBangHongLuc !== null && Date.now() - this.docBangHongLuc < luiMs) {
      return false;
    }
    const songTheoId = new Map(song.map((r) => [r.sessionId, r]));

    const daNhan = new Set<string>();
    let dangNgo = false;
    for (const [terminalId, wsId] of chuTerminal) {
      const entry = this.findEntry(wsId, terminalId);
      if (!entry) continue;
      const phien =
        entry.claudeSessionId !== undefined ? songTheoId.get(entry.claudeSessionId) : undefined;
      // Terminal đã tra rồi mà bên trong không có claude nào thì thôi nghi ngờ nó nữa —
      // nếu không, một terminal claude đã thoát (còn mở) ép đọc bảng tiến trình tới hết phiên.
      const daTra = this.daTraKhongThayClaude.has(terminalId);
      if (phien) {
        daNhan.add(phien.sessionId);
        // cwd lệch = dấu hiệu ôm nhầm session của terminal khác. Nhưng cặp đã được phả hệ xác
        // nhận thì lệch cwd là BÌNH THƯỜNG (người dùng `cd` chỗ khác rồi mới chạy claude) —
        // không loại trừ thì điều kiện này đúng mãi và ép đọc bảng tiến trình mỗi 30 giây.
        if (
          !daTra &&
          phien.cwd !== '' &&
          this.phaHeDaXacNhan.get(terminalId) !== phien.sessionId &&
          normalizeCwd(phien.cwd) !== normalizeCwd(entry.cwd)
        ) {
          dangNgo = true;
        }
      } else if (!daTra) {
        // MỌI terminal chưa giữ session sống, không riêng `kind: claude`: session có thể đang
        // chạy trong một terminal `plain` cùng cwd với một entry claude ôm nhầm — ca đó cwd
        // khớp nên không có dấu hiệu nào khác, chỉ phả hệ mới gỡ được. Guard `daTra` giữ chi
        // phí ở mức đúng MỘT lần đọc cho mỗi terminal.
        dangNgo = true;
      }
    }
    if (!dangNgo) {
      dangNgo = song.some(
        (r) => !daNhan.has(r.sessionId) && r.pid !== null && !this.pidNgoaiCuaSo.has(r.pid),
      );
    }
    if (!dangNgo) return false;

    const shellTheoPid = new Map<number, string>();
    for (const terminalId of chuTerminal.keys()) {
      const pid = this.shellPids.get(terminalId);
      if (pid !== undefined) shellTheoPid.set(pid, terminalId);
    }
    const pidCanTra = song.map((r) => r.pid).filter((p): p is number => p !== null);
    if (shellTheoPid.size === 0 || pidCanTra.length === 0) return false;

    const bang = await this.layBangTienTrinh(pidCanTra, this.epDocBangTuoi);
    if (bang.size === 0) {
      // Đọc hỏng (CIM treo/timeout 5s, thiếu quyền): KHÔNG kết luận gì — không đánh dấu
      // pidNgoaiCuaSo/daTraKhongThayClaude, vì bảng thiếu sẽ biến "chưa tra được" thành
      // "đã tra, không có". Lùi lại, mỗi lần hỏng lùi xa hơn.
      this.docBangHongLuc = Date.now();
      this.docBangHongLienTiep += 1;
      if (this.docBangHongLienTiep >= HONG_LIEN_TIEP_BO_CUOC && !this.daCanhBaoDocBang) {
        this.daCanhBaoDocBang = true;
        void vscode.window.showWarningMessage(
          'Không đọc được bảng tiến trình của hệ điều hành, nên không thể tự nhận diện session Claude theo tiến trình. Vẫn dùng được: gắn tay bằng "AI Workspace: Gắn session Claude vào terminal".',
        );
      }
      return false;
    }
    this.docBangHongLuc = null;
    this.docBangHongLienTiep = 0;
    const { theoTerminal, pidNgoai } = gomSessionTheoTerminal(song, bang, shellTheoPid);
    // Claude ở cửa sổ VS Code khác / ngoài VS Code: nhớ lại để nó không bắt ta đọc bảng
    // tiến trình ở mọi nhịp poll sau (cache âm, xóa khi có shell mới).
    for (const pid of pidNgoai) this.pidNgoaiCuaSo.add(pid);
    // Terminal đã tra mà không có claude nào bên trong: đừng để nó ép đọc bảng mãi. Cờ này
    // được xóa khi terminal đó chạy một lệnh mới (có thể chính là `claude`) — xem
    // onShellExecutionStart — hoặc khi có shell mới xuất hiện.
    for (const terminalId of chuTerminal.keys()) {
      if (theoTerminal.has(terminalId)) this.daTraKhongThayClaude.delete(terminalId);
      else {
        this.daTraKhongThayClaude.add(terminalId);
        this.phaHeDaXacNhan.delete(terminalId);
      }
    }

    let changed = false;
    for (const [terminalId, ds] of theoTerminal) {
      const wsId = chuTerminal.get(terminalId);
      // Terminal có thể đã đóng trong lúc chờ đọc bảng tiến trình (cỡ giây) — đừng gắn
      // session vào một terminal không còn nữa.
      if (wsId === undefined || !this.terminals.has(terminalId)) continue;
      const entry = this.findEntry(wsId, terminalId);
      if (!entry) continue;
      const chon = chonSessionChoTerminal(ds, entry.claudeSessionId);
      if (chon === null) continue;
      // Cặp (terminal, session) đã có bằng chứng tiến trình: ghi nhận để lệch cwd của cặp này
      // thôi bị coi là đáng ngờ ở các nhịp sau.
      this.phaHeDaXacNhan.set(terminalId, chon.sessionId);
      if (entry.claudeSessionId === chon.sessionId) continue;
      // claimSession tự gỡ id khỏi mọi entry khác (bất biến một-hội-thoại-một-entry) và tự
      // tra lại entry theo id sau await (bất biến re-resolve-rồi-touch).
      if (this.claimSession(wsId, terminalId, chon)) changed = true;
    }
    if (changed) this.scheduleSave();
    return changed;
  }

  private async resolveAmbiguity(
    chuTerminal: ReadonlyMap<string, string>,
    terminalIds: string[],
    sessions: RunningSession[],
  ): Promise<boolean> {
    let changed = false;
    const remaining = [...terminalIds];
    for (const session of sessions) {
      if (remaining.length === 0) break;
      const items = remaining
        .map((id) => {
          const wsId = chuTerminal.get(id);
          const entry = wsId !== undefined ? this.findEntry(wsId, id) : undefined;
          return { label: entry?.name ?? id, id };
        })
        .filter((item) => item.label !== '');
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Terminal nào đang chạy session "${session.name ?? session.sessionId}"?`,
        title: `Terminal nào đang chạy session "${session.name ?? session.sessionId}"?`,
      });
      if (!picked) break;
      const wsId = chuTerminal.get(picked.id);
      if (wsId !== undefined && this.claimSession(wsId, picked.id, session)) changed = true;
      remaining.splice(remaining.indexOf(picked.id), 1);
    }
    if (changed) this.scheduleSave();
    return changed;
  }

  /**
   * Tự tra lại entry theo id thay vì tin object caller đang cầm: `resolveAmbiguity` giữ tham
   * chiếu workspace qua một QuickPick có thể mở rất lâu, mà merge lúc save có thể thay object
   * đó (xem ghi chú ở activate()). Workspace active trên thực tế luôn đã touch nên hiếm khi
   * bị thay — nhưng đừng để tính đúng đắn phụ thuộc vào một bất biến ở xa như thế.
   */
  private claimSession(workspaceId: string, terminalId: string, session: RunningSession): boolean {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return false;
    // Bất biến CẤU TRÚC: một hội thoại chỉ thuộc một entry. Gỡ id khỏi entry khác ngay tại
    // đây (đồng bộ, không await) thay vì trông vào từng chỗ gọi nhớ tự dọn — hai entry cùng
    // id là sinh double `--resume` ở lần khôi phục sau.
    //
    // NHƯNG chỉ đụng vào phần thuộc về cửa sổ này: terminal đang mở ở đây, hoặc workspace ta
    // đã làm chủ. `touch` một workspace lạ là nhận chủ quyền nó VĨNH VIỄN (touchedIds không
    // bao giờ xóa) → mọi lần lưu sau ghi đè bản đĩa của cửa sổ kia bằng ảnh chụp cũ trong RAM
    // ta. Entry lạ trùng id để cửa sổ chủ của nó tự dọn (nó cũng chạy đúng code này), và
    // `mergeForSave` khử trùng lần cuối ở cửa ghi.
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.id === terminalId || t.claudeSessionId !== session.sessionId) continue;
        if (!this.touchedIds.has(w.id) && !this.terminals.has(t.id)) continue;
        delete t.claudeSessionId;
        this.statuses.delete(t.id);
        this.touch(w.id);
      }
    }
    entry.claudeSessionId = session.sessionId;
    // Registry có thể trả name rỗng (parseAgentsJson cho chuỗi rỗng đi qua), mà `??` không
    // bắt được chuỗi rỗng — schema đòi claudeName >= 1 ký tự nên phải dùng `||`.
    entry.claudeName = session.name?.trim() || entry.name;
    entry.kind = 'claude'; // thăng cấp: terminal thường hóa ra đang chạy một session
    // startCommand chỉ có nghĩa với terminal 'plain': sau khi thăng cấp, activate sẽ chạy
    // nhánh claude nên lệnh này không bao giờ chạy nữa, mà menu sửa nó cũng chỉ hiện cho
    // aiTerminalPlain — để lại là rác vô hình (và vẫn tính vào fingerprint trust).
    delete entry.startCommand;
    this.statuses.set(entry.id, session.status);
    this.touch(workspaceId);
    return true;
  }

  /**
   * Gắn tay một session Claude đang chạy vào terminal — lối thoát cho các trường hợp máy
   * không tự bắt được (nhiều terminal cùng cwd, đã Esc QuickPick, poll chưa kịp chạy).
   *
   * Session đã bị entry khác giữ vẫn ĐƯỢC liệt kê (đánh dấu chủ cũ) — chọn thì CHUYỂN claim
   * về terminal này, gỡ khỏi entry cũ nên không sinh double --resume. Trước đây lọc thẳng
   * các session đó khiến lệnh chết đường: claude chạy sờ sờ mà "không có session để gắn".
   * Registry đọc không được thì vẫn còn đường nhập session ID tay (/status trong Claude).
   */
  async assignClaudeSession(workspaceId: string, terminalId: string): Promise<void> {
    if (!this.findEntry(workspaceId, terminalId)) return;

    let running: RunningSession[] = [];
    try {
      running = await this.agent.listRunning();
    } catch {
      // registry đọc không được — danh sách rỗng, vẫn còn mục nhập tay bên dưới
    }
    const chuCu = new Map<string, string>();
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.claudeSessionId !== undefined && t.id !== terminalId) {
          chuCu.set(t.claudeSessionId, `${w.name} / ${t.name}`);
        }
      }
    }

    type Muc = vscode.QuickPickItem & { session?: RunningSession; nhapTay?: boolean };
    const options: Muc[] = running
      .filter((r) => r.kind === 'interactive')
      .map((r) => {
        const chu = chuCu.get(r.sessionId);
        return {
          label: r.name?.trim() || r.sessionId,
          description: chu ? `${r.cwd} — đang gắn ở "${chu}", chọn để CHUYỂN về đây` : r.cwd,
          detail: `trạng thái: ${r.status}`,
          session: r,
        };
      });
    options.push({
      label: 'Nhập session ID thủ công…',
      description: 'khi registry không thấy session — xem ID bằng /status trong Claude Code',
      nhapTay: true,
    });

    const picked = await vscode.window.showQuickPick(options, {
      placeHolder:
        options.length === 1
          ? 'Registry không thấy session nào đang chạy (claude agents --json) — nhập ID tay?'
          : 'Session Claude nào đang chạy trong terminal này?',
    });
    if (!picked) return;

    let session: RunningSession;
    if (picked.nhapTay === true) {
      const id = await vscode.window.showInputBox({
        prompt: 'Session ID (UUID) — xem bằng lệnh /status trong Claude Code',
        validateInput: (v) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())
            ? undefined
            : 'Phải là UUID (8-4-4-4-12 ký tự hex)',
      });
      if (id === undefined) return;
      session = {
        sessionId: id.trim().toLowerCase(),
        name: null,
        cwd: '',
        pid: null,
        kind: 'interactive',
        status: 'idle',
      };
    } else if (picked.session) {
      session = picked.session;
    } else {
      return;
    }

    // claimSession tự tra lại entry theo id sau await (bất biến re-resolve-then-touch) và tự
    // gỡ id khỏi mọi entry khác đang giữ nó (bất biến một-hội-thoại-một-entry) — quét theo
    // store hiện hành chứ không tin snapshot chuCu tính trước QuickPick.
    if (this.claimSession(workspaceId, terminalId, session)) {
      this.scheduleSave();
      this.onChanged.fire();
    }
  }

  // --------------------------------------------------------------- dispose

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActivePoll();
    this.ketThucLoading();
    // Gỡ khóa V5 khi đóng cửa sổ bình thường. saveStore hoàn toàn đồng bộ (writeFileSync +
    // renameSync) nên việc này chạy trọn vẹn trong deactivate; chỉ khi VS Code chết đột ngột
    // mới còn khóa mồ côi — đúng như README mô tả. KHÔNG đóng terminal ở đây.
    if (this.activeId !== null) {
      const ws = findWorkspace(this.store, this.activeId);
      if (ws) {
        ws.activeWindowId = null;
        this.touch(ws.id);
        this.scheduleSave();
      }
    }
    this.flush();
    for (const sub of this.subscriptions) sub.dispose();
    this.subscriptions.length = 0;
    this.onChanged.dispose();
  }
}
