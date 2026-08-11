import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ZodError } from 'zod';

import { classifyTerminal, pickCwd } from '../adopt/filter';
import type { AgentAdapter, RunningSession, RunningStatus } from '../agent/types';
import { khiKetThucLenh, nenBatLenh, type LenhDangCho } from '../capture/rules';
import { matchClaudeSessions, normalizeCwd, type MatchCandidate } from '../claude/match';
import { docBangTienTrinh } from '../proc/real';
import { timTerminalTheoToTien } from '../proc/tree';
import { realGitRunner } from '../git/exec';
import { GitClient } from '../git/worktree';
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

export type TerminalState = 'busy' | 'idle' | 'blocked' | 'open' | 'closed' | 'error';

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
}

const SAVE_DEBOUNCE_MS = 500;
const STORE_FILE = 'workspaces.json';
/** Cùng nhịp với poll của tree; hai timer chạy song song vô hại nhờ guard refreshPromise. */
const ACTIVE_POLL_MS = 3000;

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
  private store: StoreFile;
  private activeId: string | null = null;

  private readonly trust: TrustStore;
  private readonly git: GitClient;

  /** Trạng thái Claude gần nhất lấy từ registry, theo terminalId. */
  private readonly statuses = new Map<string, RunningStatus>();
  /** Terminal không mở được ở lần activate gần nhất (cwd mất, lỗi tạo…). */
  private readonly errorIds = new Set<string>();
  /** Nhóm cwd đã hỏi QuickPick trong phiên này — không hỏi lại dù người dùng bỏ qua. */
  private readonly askedCwds = new Set<string>();
  /** PID shell của từng terminal đang track (terminalId → pid) — để tra phả hệ tiến trình. */
  private readonly shellPids = new Map<string, number>();
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
    git: GitClient = new GitClient(realGitRunner),
  ) {
    this.git = git;
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
    }));
  }

  getActiveWorkspaceId(): string | null {
    return this.activeId;
  }

  private terminalState(entry: TerminalEntry): TerminalState {
    if (this.errorIds.has(entry.id)) return 'error';
    if (!this.terminals.has(entry.id)) return 'closed';
    return this.statuses.get(entry.id) ?? 'open';
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
        const handle = this.terminals.create(entry.id, { name: entry.name, cwd: entry.cwd });
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

  async closeActive(): Promise<void> {
    const id = this.activeId;
    if (id === null) return;
    // Quét bắt session lần cuối TRƯỚC khi dispose terminal — dispose xong là hết đường bắt.
    await this.finalClaimSweep();
    this.stopActivePoll();
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

  async newClaudeTerminal(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;

    const name = await vscode.window.showInputBox({
      prompt: 'Tên peer của session Claude (dùng cho cờ -n)',
      validateInput: (v) => (v.trim() === '' ? 'Tên không được để trống' : undefined),
    });
    if (name === undefined || name.trim() === '') return;

    const cwdInput = await vscode.window.showInputBox({
      prompt: 'Thư mục làm việc của terminal',
      value: folderCwd() ?? '',
      validateInput: (v) => (v.trim() === '' ? 'Thư mục không được để trống' : undefined),
    });
    if (cwdInput === undefined) return;
    let cwd = cwdInput.trim();
    if (cwd === '') return;

    const worktreeCwd = await this.maybeCreateWorktree(cwd);
    if (worktreeCwd === null) return;
    cwd = worktreeCwd;

    // Lấy lại object sau chuỗi input/quickpick rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) {
      void vscode.window.showWarningMessage('Workspace không còn tồn tại.');
      return;
    }
    this.touch(wsNow.id);

    const entry: TerminalEntry = {
      id: randomUUID(),
      name: name.trim(),
      cwd,
      kind: 'claude',
      claudeName: name.trim(),
    };
    upsertTerminal(wsNow, entry);
    this.scheduleSave();

    if (this.activeId === wsNow.id) await this.launchOne(wsNow, entry);
    this.flush();
    this.onChanged.fire();
  }

  /** Trả cwd cuối cùng, hoặc null nếu người dùng hủy giữa chừng. */
  private async maybeCreateWorktree(cwd: string): Promise<string | null> {
    let isRepo = false;
    try {
      isRepo = await this.git.isRepo(cwd);
    } catch {
      isRepo = false;
    }
    if (!isRepo) return cwd;

    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Chạy tại thư mục này', choice: 'here' as const },
        { label: '$(add) Tạo worktree mới…', choice: 'worktree' as const },
      ],
      { placeHolder: `${cwd} là git repository — chạy tại đây hay tạo worktree riêng?` },
    );
    if (!picked) return null;
    if (picked.choice === 'here') return cwd;

    const branch = await vscode.window.showInputBox({
      prompt: 'Branch cho worktree mới (chưa có thì sẽ được tạo)',
      validateInput: (v) => (v.trim() === '' ? 'Branch không được để trống' : undefined),
    });
    if (branch === undefined || branch.trim() === '') return null;

    const suggested = path.resolve(
      cwd,
      '..',
      `${path.basename(cwd)}-${branch.trim().replaceAll('/', '-')}`,
    );
    const wtPath = await vscode.window.showInputBox({ prompt: 'Đường dẫn worktree', value: suggested });
    if (wtPath === undefined || wtPath.trim() === '') return null;

    try {
      await this.git.addWorktree(cwd, wtPath.trim(), branch.trim());
    } catch (error) {
      void vscode.window.showErrorMessage(`Không tạo được worktree: ${String(error)}`);
      return null;
    }
    return wtPath.trim();
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

  /** Ghi PID shell của terminal (bất đồng bộ) để tra phả hệ tiến trình khi match session. */
  private ghiNhanShellPid(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    void terminal.processId.then((pid) => {
      if (typeof pid === 'number' && this.terminals.has(terminalId)) {
        this.shellPids.set(terminalId, pid);
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
    if (!nenBatLenh(entry.kind, this.agent.ownsCommand(lenh), lenh)) return;

    this.pendingCommands.set(key, {
      lenh,
      luuTruoc: entry.startCommand,
      batDauLuc: Date.now(),
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
    if (!p || p.lenh !== event.execution.commandLine.value) return;
    this.pendingCommands.delete(key);

    const ws = this.timWorkspaceChuaTerminal(key);
    if (!ws) return;
    const entry = ws.terminals.find((t) => t.id === key);
    // Entry đã thăng cấp claude trong lúc lệnh chạy → startCommand không còn ý nghĩa, để yên.
    if (!entry || entry.kind !== 'plain') return;

    const gia = khiKetThucLenh(p, Date.now());
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

    let changed = this.syncStatuses(bySession);
    if (await this.matchActiveWorkspace(running)) changed = true;
    if (changed) this.onChanged.fire();
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
    const conChuaBat = ws.terminals.some(
      (t) => this.terminals.has(t.id) && t.claudeSessionId === undefined,
    );
    if (!conChuaBat) return;

    // Đợi lượt poll đang dở (nếu có) xong hẳn rồi mới quét — lượt dở đã đi qua vòng hỏi
    // ambiguity với askedCwds cũ, xóa set xong phải chạy một lượt MỚI thì mới hỏi lại được.
    const inflight = this.refreshPromise;
    if (inflight) await inflight;
    this.askedCwds.clear();
    await this.refreshStatuses();
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
    if (this.activeId === null) return false;
    const ws = findWorkspace(this.store, this.activeId);
    if (!ws) return false;

    const open = ws.terminals.filter((entry) => this.terminals.has(entry.id));
    const candidates: MatchCandidate[] = open.map((entry) => ({
      terminalId: entry.id,
      cwd: entry.cwd,
      ...(entry.claudeSessionId !== undefined ? { claimedSessionId: entry.claudeSessionId } : {}),
    }));
    const result = matchClaudeSessions(candidates, running);

    let changed = false;
    for (const pair of result.matched) {
      if (this.claimSession(ws.id, pair.terminalId, pair.session)) changed = true;
    }

    // Nhóm mơ hồ (nhiều terminal/nhiều session cùng cwd): thử phân giải TẤT ĐỊNH bằng phả
    // hệ tiến trình trước — pid của session đi ngược lên tổ tiên phải gặp pid shell của
    // đúng một terminal. Chỉ phần không tra được mới rơi xuống QuickPick hỏi người dùng.
    if (result.ambiguous.length > 0) {
      const bangTienTrinh = await docBangTienTrinh();
      for (const group of result.ambiguous) {
        const shellCuaNhom = new Map<number, string>();
        for (const tid of group.terminalIds) {
          const pid = this.shellPids.get(tid);
          if (pid !== undefined) shellCuaNhom.set(pid, tid);
        }
        const chuaGan: RunningSession[] = [];
        const terminalDaGan = new Set<string>();
        for (const session of group.sessions) {
          const tid =
            session.pid !== null
              ? timTerminalTheoToTien(session.pid, bangTienTrinh, shellCuaNhom)
              : null;
          if (tid !== null && !terminalDaGan.has(tid) && this.claimSession(ws.id, tid, session)) {
            terminalDaGan.add(tid);
            changed = true;
          } else {
            chuaGan.push(session);
          }
        }
        group.sessions = chuaGan;
        group.terminalIds = group.terminalIds.filter((t) => !terminalDaGan.has(t));
      }
    }
    if (changed) this.scheduleSave();

    for (const group of result.ambiguous) {
      if (group.sessions.length === 0 || group.terminalIds.length === 0) continue;
      const key = normalizeCwd(group.cwd);
      if (this.askedCwds.has(key)) continue;
      // Đánh dấu TRƯỚC khi hỏi: bỏ qua (Esc) cũng tính là đã hỏi, không spam mỗi 3 giây.
      this.askedCwds.add(key);
      if (await this.resolveAmbiguity(ws, group.terminalIds, group.sessions)) changed = true;
    }
    return changed;
  }

  private async resolveAmbiguity(
    ws: Workspace,
    terminalIds: string[],
    sessions: RunningSession[],
  ): Promise<boolean> {
    let changed = false;
    const remaining = [...terminalIds];
    for (const session of sessions) {
      if (remaining.length === 0) break;
      const items = remaining
        .map((id) => ({ label: ws.terminals.find((t) => t.id === id)?.name ?? id, id }))
        .filter((item) => item.label !== '');
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Terminal nào đang chạy session "${session.name ?? session.sessionId}"?`,
        title: `Terminal nào đang chạy session "${session.name ?? session.sessionId}"?`,
      });
      if (!picked) break;
      if (this.claimSession(ws.id, picked.id, session)) changed = true;
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
   */
  async assignClaudeSession(workspaceId: string, terminalId: string): Promise<void> {
    if (!this.findEntry(workspaceId, terminalId)) return;

    let running: RunningSession[] = [];
    try {
      running = await this.agent.listRunning();
    } catch {
      // rơi xuống thông báo "không có session" bên dưới
    }
    // Session đã bị entry khác (bất kỳ workspace nào) giữ thì không đưa ra chọn nữa —
    // hai entry cùng trỏ một hội thoại là nguồn double --resume.
    const claimed = new Set<string>();
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.claudeSessionId !== undefined && t.id !== terminalId) claimed.add(t.claudeSessionId);
      }
    }
    const options = running.filter((r) => r.kind === 'interactive' && !claimed.has(r.sessionId));
    if (options.length === 0) {
      void vscode.window.showInformationMessage(
        'Không có session Claude nào đang chạy (chưa bị gắn) để chọn.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      options.map((r) => ({
        label: r.name?.trim() || r.sessionId,
        description: r.cwd,
        detail: `trạng thái: ${r.status}`,
        session: r,
      })),
      { placeHolder: 'Session Claude nào đang chạy trong terminal này?' },
    );
    if (!picked) return;

    // claimSession tự tra lại entry theo id sau await (bất biến re-resolve-then-touch).
    if (this.claimSession(workspaceId, terminalId, picked.session)) {
      this.scheduleSave();
      this.onChanged.fire();
    }
  }

  // --------------------------------------------------------------- dispose

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActivePoll();
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
