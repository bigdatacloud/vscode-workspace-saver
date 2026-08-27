import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ZodError } from 'zod';

import {
  classifyTerminal,
  pickCwd,
  pickUniqueMatch,
} from '../adopt/filter';
import type { AgentAdapter, RunningSession, RunningStatus } from '../agent/types';
import { khiKetThucLenh, nenBatLenh, type LenhDangCho } from '../capture/rules';
import { CodexAdapter } from '../agent/codex';
import { chonSessionChoTerminal, gomSessionTheoTerminal } from '../claude/ancestry';
import { claudeHomeMacDinh, dangChoNguoiDung, duongDanTranscript } from '../claude/transcript';
import { matchClaudeSessions, normalizeCwd, type MatchCandidate } from '../claude/match';
import { boKyHieuTrangThai } from '../agent/title';
import { realGitRunner } from '../git/exec';
import {
  GitClient,
  HAU_TO_WORKTREE,
  chuanHoaDuongDan,
  ghepTenWorktree,
  laWorktreeCuaExtension,
  phanLoaiWorktree,
  trongThuMuc,
  type LoaiWorktree,
  type WorktreeInfo,
} from '../git/worktree';
import { chonWorkspaceNhan } from './receiving';
import { docBangTienTrinh } from '../proc/real';
import { timTerminalTheoToTien } from '../proc/tree';
import {
  WorkspaceSchema,
  emptyStore,
  type StoreFile,
  type TerminalEntry,
  type Workspace,
  type WorktreeRef,
} from '../model/schema';
import {
  createWorkspace,
  deleteShard,
  findWorkspace,
  gopShard,
  loadShards,
  migrateLegacy,
  realStoreFs,
  removeTerminal as removeTerminalEntry,
  saveShard,
  tenFileWorkspace,
  type KetQuaChuyen,
  type ShardResult,
} from '../model/store';
import { upsertTerminal } from '../model/store';
import { MANAGED_TERMINAL_ID_ENV, TerminalManager } from '../terminal/manager';
import { TrustStore } from '../trust/store';
import { activateWorkspace, type ActivatePorts, type ActivateReport } from './activate';
import { gopGoiYDuongDan } from './paths';
import { decideTerminalRemoval, type RemoveTerminalDecision } from './remove';

export type TerminalState = 'busy' | 'idle' | 'blocked' | 'loading' | 'open' | 'closed' | 'error';

/** Kết quả hỏi worktree: thư mục làm việc, kèm worktree khi thật sự có một cái. */
interface KetQuaWorktree {
  cwd: string;
  worktree?: WorktreeRef;
}

/** Một worktree do extension tạo, kèm phân loại và các entry của workspace trỏ vào nó. */
interface UngVienDon {
  repoRoot: string;
  path: string;
  branch: string | null;
  loai: LoaiWorktree;
  entryIds: string[];
}

export interface WorkspaceView {
  id: string;
  name: string;
  terminalCount: number;
  /** Đang mở trong cửa sổ này. Nhiều workspace được mở cùng lúc. */
  isActive: boolean;
  /**
   * Terminal người dùng tự mở tay sẽ rơi vào workspace này. Phải hiện ra cây: quy tắc chọn
   * (xem `receiving.ts`) là ngầm định, không hiện thì không ai đoán được nó rơi vào đâu.
   */
  isReceiving: boolean;
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
  /** Agent đang chạy trong terminal này (nếu có) — quyết định nhãn trong cây. */
  agent?: 'claude' | 'codex';
}

const SAVE_DEBOUNCE_MS = 500;
/** File gộp của bản cũ — chỉ còn dùng để chuyển dữ liệu sang thư mục shard đúng một lần. */
const STORE_FILE = 'workspaces.json';
/** Thư mục chứa mỗi workspace một file: `<globalStorage>/workspaces/<id>.json`. */
const THU_MUC_SHARD = 'workspaces';
/** Đường dẫn đã dùng gần đây, để lần sau gõ vài ký tự là ra (globalState). */
const KHOA_LICH_SU_CWD = 'aiWorkspace.duongDanGanDay';
const LICH_SU_CWD_TOI_DA = 20;
/** Cùng nhịp với poll của tree; hai timer chạy song song vô hại nhờ guard refreshPromise. */
const ACTIVE_POLL_MS = 3000;
/** Trần trạng thái "đang tải" — session không hiện trong registry sau chừng này thì thôi xoay. */
const LOADING_TIMEOUT_MS = 90_000;
/** Đọc chừng này byte cuối transcript để biết phiên có đang chờ người dùng không. */
const DUOI_TRANSCRIPT_BYTE = 256 * 1024;
/** Dò id phiên Codex: mỗi nhịp chừng này, tối đa chừng này lần (~2 phút). */
const CODEX_DO_NHIP_MS = 3000;
const CODEX_DO_SO_LAN = 40;
/** Hạn giờ chờ `Terminal.processId` — terminal chưa gắn tiến trình có thể không bao giờ trả. */
const DOI_PROCESS_ID_MS = 2500;
/** Tên shell mặc định — trùng những tên này thì không tính là bằng chứng nhận nuôi. */
const TEN_SHELL_MAC_DINH = new Set([
  'pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'sh', 'fish', 'git bash', 'wsl', 'terminal',
]);
/** Đọc bảng tiến trình hỏng thì nghỉ chừng này rồi mới thử lại (mỗi lần thử tốn tới 5 giây). */
const LUI_SAU_DOC_HONG_MS = 60_000;
/** Ghi shard hỏng (đĩa bận, quyền) thì hẹn thử lại sau chừng này. */
const LUI_SAU_GHI_HONG_MS = 5_000;
const LUI_TOI_DA_MS = 600_000;
/** Hỏng liên tiếp chừng này lần thì coi như máy không tra được: cảnh báo và thôi ưu tiên. */
const HONG_LIEN_TIEP_BO_CUOC = 3;
const ENTRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function terminalCwd(terminal: vscode.Terminal): string | undefined {
  return terminal.shellIntegration?.cwd?.fsPath ?? creationCwd(terminal);
}

function nameCwdKey(name: string, cwd: string): string {
  return JSON.stringify([name, normalizeCwd(cwd)]);
}

function restoredTerminalKey(terminal: vscode.Terminal): string | null {
  const cwd = terminalCwd(terminal);
  return cwd === undefined ? null : nameCwdKey(boKyHieuTrangThai(terminal.name), cwd);
}

function managedTerminalId(terminal: vscode.Terminal): string | undefined {
  const env = (terminal.creationOptions as vscode.TerminalOptions).env;
  const value = env?.[MANAGED_TERMINAL_ID_ENV];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function terminalMatchesEntry(terminal: vscode.Terminal, entry: TerminalEntry): boolean {
  const cwd = terminalCwd(terminal);
  if (cwd === undefined || normalizeCwd(cwd) !== normalizeCwd(entry.cwd)) return false;
  const actualName = entry.kind === 'claude' || entry.agentId !== undefined
    ? boKyHieuTrangThai(terminal.name)
    : terminal.name;
  return actualName === entry.name || (entry.claudeName !== undefined && actualName === entry.claudeName);
}


function folderCwd(): string | undefined {
  return nonEmpty(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
}

export class WorkspaceManager implements vscode.Disposable {
  private readonly filePath: string;
  /** Thư mục chứa mỗi workspace một file — nguồn dữ liệu thật kể từ bản tách file. */
  private readonly thuMucShard: string;
  private readonly boNhoChung: vscode.Memento;
  private store: StoreFile;
  /**
   * Các workspace ĐANG MỞ trong cửa sổ này, theo thứ tự kích hoạt — mới nhất ở CUỐI.
   *
   * Mảng chứ không phải Set vì cần thứ tự "mở gần nhất" cho quy tắc workspace đang nhận, và
   * kích hoạt lại một workspace đang mở phải đẩy nó lên cuối.
   */
  private activeIds: string[] = [];
  /**
   * Key của terminal ta sở hữu được focus GẦN NHẤT.
   *
   * Không thể chỉ đọc `window.activeTerminal` lúc cần: VS Code focus terminal vừa mở ngay khi
   * tạo, và không hứa hẹn thứ tự giữa việc đó với `onDidOpenTerminal`. Nhìn mỗi activeTerminal
   * thì terminal mới (chưa thuộc workspace nào) làm quy tắc "theo terminal đang focus" rơi
   * thẳng về "workspace mở gần nhất" — đúng cái nó sinh ra để tránh.
   *
   * KHÔNG xoá khi focus rời sang terminal lạ: "chỗ bạn vừa làm việc" vẫn là câu trả lời đúng.
   */
  private terminalFocusCuoi: string | null = null;

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
  /**
   * Terminal đang có lệnh chạy dở (mọi lệnh, không chỉ lệnh được bắt làm startCommand).
   * Dùng để biết tiêu đề tab lúc này là do CHƯƠNG TRÌNH đặt chứ không phải người dùng rename.
   */
  private readonly dangChayLenh = new Set<string>();
  /** Cặp terminalId → sessionId đã được phả hệ tiến trình xác nhận (cwd lệch là bình thường). */
  private readonly phaHeDaXacNhan = new Map<string, string>();
  /** Ảnh chụp phiên đang chạy tại bước nối-lại của lần kích hoạt gần nhất (xem coPhienDangChayNgoai). */
  private phienLucKhoiPhuc: RunningSession[] = [];
  /** Terminal bị coi là trùng ở lần nối lại gần nhất → id phiên của nó, để xác minh trước khi đóng. */
  private phienTrongTerminalThua = new Map<vscode.Terminal, string[]>();
  private docRegistryLoiKhiKhoiPhuc = false;
  /** Kết quả soi transcript, khóa theo sessionId — file không đổi thì khỏi đọc lại. */
  private readonly choTraLoiCache = new Map<
    string,
    { mtime: number; idle: boolean; cho: boolean }
  >();
  /** Buộc lần tra phả hệ tới đọc bảng tươi, bỏ qua cache (dùng cho quét bắt lần cuối). */
  private epDocBangTuoi = false;
  /** Lúc đọc bảng tiến trình hỏng gần nhất — lùi một nhịp dài thay vì thử lại mỗi 3 giây. */
  private docBangHongLuc: number | null = null;
  /** Lỗi lưu gần nhất đã báo — không bắn lại cùng một popup ở mọi chu kỳ lưu. */
  private loiLuuDaBao: string | null = null;
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
  /**
   * Workspace cửa sổ này đã sửa và CHƯA ghi xuống đĩa. Khác hẳn `touchedIds` của mô hình
   * một-file-chung: đây chỉ là "cần ghi", xoá sau khi ghi xong — không phải một tuyên bố
   * chủ quyền vĩnh viễn khiến mọi lần lưu sau đè bản của cửa sổ khác.
   */
  private readonly dirtyIds = new Set<string>();

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

  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly onChanged = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChanged.event;

  constructor(
    context: vscode.ExtensionContext,
    private readonly terminals: TerminalManager,
    private readonly agent: AgentAdapter,
    private readonly codex: CodexAdapter,
    private readonly git: GitClient = new GitClient(realGitRunner),
  ) {
    this.boNhoChung = context.globalState;
    this.trust = new TrustStore({
      get: (key) => context.globalState.get<string>(key),
      set: (key, value) => Promise.resolve(context.globalState.update(key, value)),
    });

    const dir = context.globalStorageUri.fsPath;
    this.filePath = path.join(dir, STORE_FILE);
    this.thuMucShard = path.join(dir, THU_MUC_SHARD);
    try {
      nodeFs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Không tạo được thư mục lưu trữ ${dir}: ${String(error)}`,
      );
    }
    // loadShards nuốt lỗi từng file; lỗi cấp thư mục (EBUSY/EACCES do antivirus, OneDrive)
    // vẫn ném ra và sẽ giết cả extension nếu không chặn ở đây.
    try {
      // Chuyển từ file gộp cũ sang thư mục shard (chạy đúng một lần, file cũ chỉ bị đổi tên).
      // Bọc RIÊNG: bước chuyển hỏng thì vẫn phải nạp được những shard đã có, nếu không cửa sổ
      // này hiện danh sách TRỐNG suốt phiên trong khi dữ liệu vẫn nằm nguyên trên đĩa.
      let daChuyen: KetQuaChuyen = { loai: 'khong-co' };
      try {
        daChuyen = migrateLegacy(realStoreFs, this.filePath, this.thuMucShard, Date.now, path.sep);
      } catch (error) {
        void vscode.window.showWarningMessage(
          `Không chuyển được dữ liệu từ ${this.filePath}: ${String(error)}. Danh sách hiện tại lấy từ ${this.thuMucShard}.`,
        );
      }
      const shard = loadShards(realStoreFs, this.thuMucShard, Date.now, path.sep);
      this.store = { version: 2, workspaces: shard.workspaces };
      if (daChuyen.loai === 'xong') {
        void vscode.window.showInformationMessage(
          `Đã chuyển ${daChuyen.soLuong} workspace sang lưu trữ tách file (mỗi workspace một file trong ${this.thuMucShard}). File cũ vẫn còn, chỉ đổi tên.`,
        );
      } else if (daChuyen.loai === 'hong') {
        void vscode.window.showWarningMessage(
          `File workspaces.json cũ bị hỏng nên không chuyển được; đã giữ lại bản sao ở ${daChuyen.backup}. Danh sách workspace bắt đầu từ những gì đọc được.`,
        );
      }
      if (shard.hong.length > 0) {
        void vscode.window.showWarningMessage(
          `${shard.hong.length} file workspace bị hỏng nên đã được sao lưu (${shard.hong.map((h) => h.backup).join(', ')}); các workspace còn lại vẫn nguyên.`,
        );
      }
      // Sửa di chứng của lỗi hút tiêu đề: tên đã lưu có thể dính ký hiệu trạng thái quay của
      // agent ("✳ ", "◐ "…). Chỉ sửa TRONG BỘ NHỚ, KHÔNG touch/save — touch một workspace chỉ
      // để dọn tên là nhận chủ quyền nó vĩnh viễn với các cửa sổ VS Code khác; tên sạch sẽ
      // được ghi xuống ở lần lưu nào đó ta vốn đã phải ghi.
      for (const ws of this.store.workspaces) {
        // CHỈ entry agent: tên do người dùng đặt cho terminal thường hoàn toàn có thể bắt đầu
        // bằng "• " hay "· " và cắt đi là sửa dữ liệu của họ.
        for (const t of ws.terminals) {
          if (t.kind === 'claude' || t.agentId !== undefined) t.name = boKyHieuTrangThai(t.name);
        }
      }
    } catch (error) {
      this.store = emptyStore();
      void vscode.window.showWarningMessage(
        `Không đọc được ${this.thuMucShard}: ${String(error)}. Phiên này bắt đầu với danh sách rỗng; hãy kiểm tra quyền truy cập thư mục trước khi tạo workspace mới.`,
      );
    }

    this.subscriptions.push(
      this.terminals.onClosed((key) => {
        // V7: đóng terminal bằng tay KHÔNG gỡ entry khỏi workspace, chỉ đổi trạng thái hiển thị.
        // Lệnh đang chạy dở lúc terminal bị đóng: `onShellExecutionEnd` sẽ KHÔNG bao giờ tới,
        // mà startCommand đã được ghi ngay lúc lệnh bắt đầu (chống crash). Không hoàn nguyên
        // ở đây thì một `git status` vô tình thành "app của terminal này" và được chạy lại ở
        // mọi lần khôi phục sau.
        const dangCho = this.pendingCommands.get(key);
        if (dangCho) this.hoanNguyenLenhDangCho(key, dangCho);
        this.quenTerminal(key);
        this.onChanged.fire();
      }),
      vscode.window.onDidOpenTerminal((terminal) => {
        void this.onTerminalOpened(terminal);
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (terminal === undefined) return;
        const key = this.terminals.ownsTerminal(terminal);
        if (key !== null) this.terminalFocusCuoi = key;
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
    const nhan = this.wsNhan();
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
        isActive: this.laDangMo(ws.id),
        isReceiving: ws.id === nhan,
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
      agent: this.agentCuaEntry(entry),
    }));
  }

  /** Workspace sẽ nhận terminal mới khi lệnh được gọi bằng phím tắt (không có item cây). */
  getReceivingWorkspaceId(): string | null {
    return this.wsNhan();
  }

  private laDangMo(workspaceId: string): boolean {
    return this.activeIds.includes(workspaceId);
  }

  /**
   * Workspace nhận terminal người dùng tự mở tay. Quy tắc thuần nằm ở `chonWorkspaceNhan`;
   * đây chỉ là chỗ nối nó với `vscode.window.activeTerminal` và bảng track terminal.
   */
  private wsNhan(): string | null {
    const dangFocus = vscode.window.activeTerminal;
    const key =
      (dangFocus === undefined ? null : this.terminals.ownsTerminal(dangFocus)) ??
      this.terminalFocusCuoi;
    return chonWorkspaceNhan(
      key,
      (k) => this.store.workspaces.find((w) => w.terminals.some((t) => t.id === k))?.id ?? null,
      this.activeIds,
    );
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

  private ketThucLoading(ids?: string[]): void {
    // Có danh sách → chỉ gỡ đúng những id đó, giữ nguyên timer (nó vẫn là trần an toàn cho
    // các id còn lại của workspace khác).
    if (ids !== undefined) {
      for (const id of ids) this.loadingIds.delete(id);
      return;
    }
    if (this.loadingTimer !== null) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.loadingIds.clear();
  }

  // ------------------------------------------------------------- lưu trữ

  /** Đánh dấu workspace này CẦN GHI ở lần lưu tới (xem ghi chú ở `dirtyIds`). */
  private touch(workspaceId: string): void {
    this.touchedIds.add(workspaceId);
    this.dirtyIds.add(workspaceId);
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

  /**
   * Ghi ĐÚNG những workspace cửa sổ này vừa sửa, mỗi cái một file. Không đụng tới file của
   * workspace khác nên không còn đường nào ghi đè việc của cửa sổ VS Code khác — thứ mà mô
   * hình một-file-chung phải dùng luật gộp phức tạp mới né được (và vẫn né hụt).
   */
  private saveNow(): void {
    const canGhi = [...this.dirtyIds];
    const loi: string[] = [];
    for (const id of canGhi) {
      const ws = findWorkspace(this.store, id);
      try {
        if (!ws) {
          // Đã bị xóa khỏi RAM → xóa file. Không cần bia mộ: file biến mất là biến mất.
          // `remove` NÉM khi xoá không được (file bị khoá) — bắt ở dưới và giữ id trong
          // `dirtyIds` để thử lại, nếu không workspace sẽ sống lại ở nhịp đồng bộ sau.
          deleteShard(realStoreFs, this.thuMucShard, id, path.sep);
          this.dirtyIds.delete(id);
          continue;
        }
        // Cửa sổ khác có thể vừa thêm terminal vào CHÍNH workspace này giữa hai lần ta ghi.
        const raw = realStoreFs.readFile(tenFileWorkspace(this.thuMucShard, id, path.sep));
        let tren: Workspace | null = null;
        if (raw !== null) {
          try {
            tren = WorkspaceSchema.parse(JSON.parse(raw));
          } catch {
            tren = null; // file hỏng: bản của ta là bản tốt nhất còn lại
          }
        }
        saveShard(realStoreFs, this.thuMucShard, gopShard(tren, ws), path.sep);
        this.dirtyIds.delete(id);
      } catch (error) {
        loi.push(`${ws?.name ?? id}: ${String(error)}`);
      }
    }
    // Nạp lại danh sách từ đĩa để thấy workspace cửa sổ khác vừa tạo/xóa. Chỉ thay những
    // workspace ta KHÔNG đang sửa dở — object của ta phải giữ nguyên tham chiếu.
    this.dongBoTuDia();
    this.dirty = this.dirtyIds.size > 0;
    this.onChanged.fire();
    if (loi.length > 0) {
      // Id lỗi vẫn nằm trong `dirtyIds` (RAM an toàn), nhưng KHÔNG có gì tự lên lịch lại:
      // phải tự hẹn, nếu không thay đổi chỉ được ghi khi người dùng tình cờ sửa tiếp.
      if (this.saveTimer === null && !this.disposed) {
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null;
          this.saveNow();
        }, LUI_SAU_GHI_HONG_MS);
      }
      // Chỉ kêu MỘT lần cho mỗi lỗi: một workspace sai schema sẽ hỏng ở mọi chu kỳ lưu, bắn
      // popup mỗi 500ms là không dùng nổi.
      const khoa = loi.join('; ');
      if (this.loiLuuDaBao !== khoa) {
        this.loiLuuDaBao = khoa;
        this.baoLoiLuu(khoa);
      }
    } else {
      this.loiLuuDaBao = null;
    }
  }

  /**
   * Hợp nhất danh sách trên đĩa vào RAM: thấy workspace cửa sổ khác vừa tạo, và BỎ những
   * workspace mà cửa sổ khác đã xóa (file không còn) — trước đây bản RAM cũ của ta hồi sinh
   * chúng ở lần lưu kế tiếp.
   */
  private dongBoTuDia(): void {
    // Đang kích hoạt workspace: buildPorts/onMinted đang GIỮ THAM CHIẾU tới object workspace.
    // Thay object lúc này là mọi mutation sau đó rơi vào bản mồ côi — mất đúng sessionId vừa
    // mint. Bỏ qua một nhịp đồng bộ không mất gì, lần lưu sau sẽ làm.
    if (this.activating) return;
    let shard: ShardResult;
    try {
      shard = loadShards(realStoreFs, this.thuMucShard, Date.now, path.sep);
    } catch {
      return; // đọc thư mục lỗi: giữ nguyên bản RAM, lần sau thử lại
    }
    const tuDia = new Map(shard.workspaces.map((w) => [w.id, w]));
    const hongTheoId = new Set(shard.hong.map((h) => h.id));
    const ra: Workspace[] = [];
    for (const ws of this.store.workspaces) {
      // Đang sửa dở, hoặc là workspace đang active của cửa sổ này → bản của ta là chuẩn và
      // các closure đang giữ tham chiếu tới CHÍNH object này, không được thay.
      if (this.dirtyIds.has(ws.id) || this.laDangMo(ws.id)) {
        ra.push(ws);
        tuDia.delete(ws.id);
        continue;
      }
      // File của nó ĐỌC KHÔNG ĐƯỢC (hỏng, đang bị khoá) — khác hẳn "cửa sổ khác đã xóa".
      // Quên nó ở đây là mất luôn bản RAM đang tốt, và các terminal của nó kẹt trạng thái
      // "đã có chủ" vĩnh viễn vì không ai release.
      if (hongTheoId.has(ws.id)) {
        ra.push(ws);
        continue;
      }
      const tren = tuDia.get(ws.id);
      if (tren === undefined) continue; // cửa sổ khác đã xóa → quên nó đi
      // Terminal đang mở ở cửa sổ NÀY thì bản của ta mới đúng; phần còn lại theo đĩa.
      const dangMoODay = ws.terminals.some((t) => this.terminals.has(t.id));
      ra.push(dangMoODay ? gopShard(tren, ws) : tren);
      tuDia.delete(ws.id);
    }
    for (const con of tuDia.values()) ra.push(con); // workspace mới của cửa sổ khác
    this.store = { version: 2, workspaces: ra };
  }

  private baoLoiLuu(chiTiet: string): void {
    void vscode.window.showWarningMessage(`Không ghi được workspace xuống đĩa: ${chiTiet}`);
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

    if (this.laDangMo(workspaceId)) {
      const opened = ws.terminals.find((entry) => this.terminals.has(entry.id));
      if (opened) this.terminals.focus(opened.id);
      return;
    }

    // Tuần tự hoá các lượt kích hoạt. Mở nhiều workspace vẫn được, chỉ là lần lượt: hai lượt
    // song song sẽ tranh nhau NHẬN cùng một terminal đang chạy sẵn trong noiLaiTerminalHoiSinh,
    // và cả hai cùng ghi activeWindowId nhưng chỉ một lượt về đích.
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

      // KHÔNG hỏi "đóng workspace đang mở trước?" — mở nhiều workspace cùng lúc là chuyện
      // bình thường, và workspace đang mở ở đây không hề bị đụng tới.

      // Modal khoá V5 ở trên có thể mở vô hạn; một lượt saveNow trong lúc đó có thể đã thay object
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

      // Cả bước dò lẫn bước mở đều nằm trong MỘT thanh tiến trình: bước dò có thể mất vài
      // giây (đọc registry + bảng tiến trình), để trần thì trông như VS Code treo.
      const ketQua = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Đang mở workspace "${wsNow.name}"…` },
        async () => {
          // Nối lại những terminal VẪN ĐANG CHẠY trước khi mở cái mới — nếu không, reload cửa
          // sổ sẽ `--resume` lần hai vào hội thoại đang chạy dở (xem noiLaiTerminalHoiSinh).
          // Sau `touch`, merge giữ nguyên object của ta nên await ở đây không làm mất wsNow.
          const noiLai = await this.noiLaiTerminalHoiSinh(wsNow);
          // Bước dò mất vài giây — workspace có thể đã bị xóa trong lúc đó. Nhả lại những
          // terminal vừa nhận: giữ chúng dưới id của một workspace đã chết là khóa chúng lại
          // vĩnh viễn (không ai nhận nuôi được nữa, cũng không bao giờ bị đóng).
          if (!findWorkspace(this.store, workspaceId)) {
            for (const id of noiLai.ids) this.terminals.release(id);
            return null;
          }

          // Terminal đang mở (đã adopt vào ws này từ trước, hoặc vừa nối lại ở trên) phải được
          // để yên: TerminalManager.create dùng chung key sẽ dispose terminal cũ — giết một
          // shell đang chạy dở. Và gửi `--resume` vào terminal đang chạy claude thì lệnh đó bị
          // gõ thẳng vào hội thoại đang sống. Chỉ mở những entry thực sự chưa có terminal.
          const toOpen: Workspace = {
            ...wsNow,
            terminals: wsNow.terminals.filter(
              (entry) => !this.terminals.has(entry.id) && !noiLai.boQua.includes(entry.id),
            ),
          };
          // Claude cần nhiều giây boot + resume trước khi registry thấy session — đánh dấu
          // "đang tải" ngay để cây có phản hồi tức thì, không trông như đơ.
          this.batDauLoading(toOpen.terminals.filter((t) => t.kind === 'claude').map((t) => t.id));
          this.onChanged.fire();
          const report = await activateWorkspace(toOpen, this.buildPorts(wsNow));
          // Kiểm LẠI sau khi mở: `deleteWorkspace` chỉ có một modal chặn, người dùng hoàn toàn
          // có thể xóa workspace trong lúc các terminal đang được mở. Không kiểm thì
          // `this.activeId` trỏ vào workspace ma (menu Đóng không hiện, phím tắt im lặng) và
          // các terminal vừa tạo bị track dưới id không thuộc về ai — không bao giờ đóng được.
          if (!findWorkspace(this.store, workspaceId)) {
            for (const id of [...noiLai.ids, ...report.opened]) this.terminals.release(id);
            return null;
          }
          return { noiLai, report };
        },
      );
      if (ketQua === null) return;
      if (ketQua.noiLai.ids.length > 0) {
        void vscode.window.showInformationMessage(
          `Đã nối lại ${ketQua.noiLai.ids.length} terminal đang chạy sẵn (không mở lại phiên lần hai).`,
        );
      }
      if (ketQua.noiLai.boQua.length > 0) {
        void vscode.window.showWarningMessage(
          `Chưa mở lại ${ketQua.noiLai.boQua.length} terminal Codex vì các tab legacy cùng tên/thư mục không có ID để phân biệt. Các tab sống được giữ nguyên và không resume thêm. Hãy đóng các tab Codex mơ hồ, đóng workspace, rồi kích hoạt lại.`,
        );
      }
      const thua = ketQua.noiLai.thua;
      if (thua.length > 0) {
        // Hai tiến trình cùng ghi một file phiên thì mỗi cái giữ một bản lịch sử khác nhau —
        // đó chính là cảm giác "lịch sử mất một khoảng dài". Đóng bớt là cách duy nhất gộp
        // lại, nhưng phải do người dùng bấm: mỗi tiến trình có thể đang làm dở việc gì đó.
        const ten = thua.map((t) => `"${t.name}"`).join(', ');
        void vscode.window
          .showWarningMessage(
            `${thua.length} terminal đang chạy TRÙNG hội thoại với terminal đã nối lại (di chứng của những lần khôi phục chồng trước đây): ${ten}. Để nguyên thì hai tiến trình cùng ghi một file phiên và lịch sử sẽ lệch nhau.`,
            'Đóng các terminal trùng',
            'Để nguyên',
          )
          .then(async (tra) => {
            if (tra !== 'Đóng các terminal trùng') return;
            // Thông báo KHÔNG modal: người dùng có thể bấm sau vài phút, lúc đó tiến trình
            // trùng có thể đã thoát và họ đang gõ việc khác trong chính shell đó. Kiểm lại
            // ngay trước khi đóng: vẫn còn mở, vẫn chưa ai nhận, và hội thoại trùng vẫn sống.
            let conSong = new Set<string>();
            try {
              conSong = new Set(
                (await this.agent.listRunning())
                  .filter((r) => r.kind === 'interactive')
                  .map((r) => r.sessionId),
              );
            } catch {
              return; // không xác minh được thì không đóng gì cả
            }
            for (const t of thua) {
              if (!vscode.window.terminals.includes(t)) continue;
              if (this.terminals.ownsTerminal(t) !== null) continue;
              const idCu = this.phienTrongTerminalThua.get(t) ?? [];
              if (!idCu.some((id) => conSong.has(id))) continue;
              t.dispose();
            }
          });
      } else if (ketQua.noiLai.trung > 0) {
        void vscode.window.showWarningMessage(
          `${ketQua.noiLai.trung} hội thoại Claude đang chạy nhiều tiến trình cùng lúc (di chứng của những lần khôi phục chồng trước đây). Mỗi hội thoại chỉ nối lại được MỘT terminal — nên đóng bớt các terminal Claude không nằm trong cây AI Workspaces.`,
        );
      }
      this.applyReport(ketQua.report);

      // Lấy LẠI object rồi mới ghi: giữa `touch` đầu hàm và đây có nhiều await (modal, dò
      // terminal, mở terminal), một lượt lưu xen vào đã ghi xong và XOÁ id khỏi `dirtyIds`.
      // Không touch lại thì khóa V5 + lastActiveAt không bao giờ xuống đĩa — cửa sổ khác không
      // thấy workspace này đang mở và cùng resume một hội thoại.
      const wsGhi = findWorkspace(this.store, workspaceId);
      if (!wsGhi) return;
      this.activeIds = [...this.activeIds.filter((x) => x !== wsGhi.id), wsGhi.id];
      wsGhi.lastActiveAt = new Date().toISOString();
      wsGhi.activeWindowId = vscode.env.sessionId;
      this.touch(wsGhi.id);
      this.startActivePoll();
      this.scheduleSave();
      this.flush();
      this.onChanged.fire();
    } finally {
      this.activating = false;
    }
  }

  /**
   * Nối lại terminal đang chạy sẵn thay vì mở mới.
   *
   * Reload cửa sổ VS Code: pty host sống sót nên terminal cũ (và tiến trình claude bên trong)
   * được hồi sinh, NHƯNG map terminal của extension chỉ nằm trong RAM nên sau reload nó không
   * còn nhận ra chúng. Không nối lại thì mỗi lần kích hoạt workspace là `--resume` thêm một
   * tiến trình nữa vào ĐÚNG hội thoại đang chạy dở — đo trên máy người dùng có hội thoại chạy
   * tới BA tiến trình cùng lúc, tất cả cùng ghi vào một file phiên.
   *
   * Hai mức bằng chứng, mạnh trước:
   *  1. Phả hệ tiến trình: session của entry đang chạy dưới shell của terminal chưa track nào.
   *  2. Trùng TÊN terminal VÀ cwd khớp — chỉ cho entry `plain`. KHÔNG áp cho entry claude:
   *     entry claude mà hội thoại đã thoát sẽ không có dòng registry nào, nhận nuôi theo tên
   *     là loại nó khỏi danh sách mở → `--resume` KHÔNG BAO GIỜ chạy, mất hẳn việc khôi phục
   *     hội thoại mà chẳng có tín hiệu gì. Với entry claude, mở mới + resume là đúng: không
   *     có tiến trình claude nào sống để mà nhân đôi.
   *
   * @returns id các entry đã nối lại (để caller nhả ra nếu phải bỏ dở) và số hội thoại đang
   *   chạy nhiều tiến trình.
   */
  private async noiLaiTerminalHoiSinh(
    ws: Workspace,
  ): Promise<{ ids: string[]; boQua: string[]; trung: number; thua: vscode.Terminal[] }> {
    const chuaTrack = () =>
      vscode.window.terminals.filter((t) => this.terminals.ownsTerminal(t) === null);
    // Mọi phase thấp hơn exact marker chỉ được xét terminal legacy. Marker khác entry là
    // ownership evidence mạnh hơn cả name/cwd lẫn phả hệ của một session claim đã cũ/trùng.
    const legacyChuaTrack = () =>
      chuaTrack().filter((terminal) => managedTerminalId(terminal) === undefined);
    if (chuaTrack().length === 0) return { ids: [], boQua: [], trung: 0, thua: [] };
    const cho = ws.terminals.filter((e) => !this.terminals.has(e.id));
    if (cho.length === 0) return { ids: [], boQua: [], trung: 0, thua: [] };

    const daNhan: string[] = [];
    let soTrung = 0;
    const nhan = (entry: TerminalEntry, terminal: vscode.Terminal, pid?: number): void => {
      this.terminals.adopt(entry.id, terminal);
      if (pid !== undefined) this.shellPids.set(entry.id, pid);
      else this.ghiNhanShellPid(entry.id);
      daNhan.push(entry.id);
    };

    // (0) Terminal do bản mới tạo mang id entry trong creationOptions.env; VS Code giữ lại
    // creation options khi persistent terminal hồi sinh. Đây là bằng chứng trực tiếp, mạnh hơn
    // tên/cwd và phân biệt được nhiều Codex giống hệt nhau dù thứ tự tab đã đổi.
    for (const entry of cho) {
      if (this.terminals.has(entry.id)) continue;
      const khop = chuaTrack().filter((terminal) => managedTerminalId(terminal) === entry.id);
      if (khop.length === 1) nhan(entry, khop[0]!);
    }

    // (1) Bằng chứng phả hệ tiến trình. Xét MỌI phiên đang chạy chứ không riêng phiên mà
    // entry đang giữ id: sau reload, terminal hồi sinh có thể đang chạy một hội thoại mà
    // extension chưa kịp ghi id (hoặc id đã cũ) — bỏ qua nó là mở thêm terminal thứ hai cho
    // đúng thư mục đó, tức đúng cái vòng lặp nhân đôi cần chặn.
    let song: RunningSession[] = [];
    this.docRegistryLoiKhiKhoiPhuc = false;
    try {
      song = (await this.agent.listRunning()).filter(
        (r) => r.kind === 'interactive' && r.pid !== null,
      );
    } catch {
      // registry đọc không được → bỏ qua mức 1, còn mức 2 theo tên. Ghi nhớ để nhánh `-c`
      // biết là ta ĐANG MÙ, không được phép suy ra "thư mục này không có phiên nào chạy".
      this.docRegistryLoiKhiKhoiPhuc = true;
    }
    this.phienLucKhoiPhuc = song;
    // Một hội thoại đang có nhiều tiến trình = di chứng của những lần resume chồng trước đây;
    // nối lại chỉ nhận được MỘT terminal, phần thừa vẫn ghi vào cùng file phiên.
    // Chỉ đếm hội thoại LIÊN QUAN tới workspace này: máy có thể đang chạy claude cho hàng
    // loạt dự án khác, cảnh báo về chúng chỉ làm nhiễu.
    const idCuaWs = new Set(
      ws.terminals.map((t) => t.claudeSessionId).filter((x): x is string => x !== undefined),
    );
    const demTheoPhien = new Map<string, number>();
    for (const r of song) {
      if (!idCuaWs.has(r.sessionId)) continue;
      demTheoPhien.set(r.sessionId, (demTheoPhien.get(r.sessionId) ?? 0) + 1);
    }
    soTrung = [...demTheoPhien.values()].filter((n) => n > 1).length;

    /** terminal chưa track → các phiên Claude đang chạy BÊN TRONG nó (theo phả hệ tiến trình). */
    const phienTrongTerminal = new Map<vscode.Terminal, RunningSession[]>();
    if (song.length > 0) {
      const terminalTheoPid = new Map<number, vscode.Terminal>();
      // processId của một terminal chưa gắn tiến trình có thể không bao giờ resolve —
      // Promise.all chờ TẤT CẢ, nên phải có hạn giờ, nếu không luồng activate treo vĩnh viễn.
      await Promise.all(
        legacyChuaTrack().map(async (t) => {
          let hen: NodeJS.Timeout | undefined;
          const pid = await Promise.race([
            t.processId,
            new Promise<undefined>((r) => {
              hen = setTimeout(() => r(undefined), DOI_PROCESS_ID_MS);
            }),
          ]);
          if (hen !== undefined) clearTimeout(hen); // không để lại N timer 2.5s mỗi lần activate
          if (typeof pid === 'number') terminalTheoPid.set(pid, t);
        }),
      );
      if (terminalTheoPid.size > 0) {
        // Ép đọc bảng tươi: đây là thời điểm một-lần-duy-nhất, sai là nhân đôi hội thoại.
        const bang = await this.layBangTienTrinh(song.map((r) => r.pid as number), true);
        const shellTheoPid = new Map<number, string>();
        for (const pid of terminalTheoPid.keys()) shellTheoPid.set(pid, String(pid));
        // KHÔNG dùng gomSessionTheoTerminal ở đây: nó gộp theo sessionId và chỉ giữ tiến trình
        // ĐẦU của mỗi hội thoại. Đúng cho việc gắn session, nhưng ở đây một hội thoại có thể
        // đang chạy nhiều tiến trình ở nhiều terminal — bỏ qua các tiến trình sau là để lọt
        // đúng terminal cần nối lại.
        for (const r of song) {
          const khoa = timTerminalTheoToTien(r.pid as number, bang, shellTheoPid);
          if (khoa === null) continue;
          const terminal = terminalTheoPid.get(Number(khoa));
          if (!terminal) continue;
          const ds = phienTrongTerminal.get(terminal);
          if (ds) ds.push(r);
          else phienTrongTerminal.set(terminal, [r]);
        }
      }
    }

    // (1a) Khớp theo ĐÚNG id entry đang giữ — bằng chứng mạnh nhất.
    for (const entry of cho) {
      if (entry.claudeSessionId === undefined || this.terminals.has(entry.id)) continue;
      for (const [terminal, ds] of phienTrongTerminal) {
        if (this.terminals.ownsTerminal(terminal) !== null) continue;
        if (!ds.some((r) => r.sessionId === entry.claudeSessionId)) continue;
        nhan(entry, terminal);
        break;
      }
    }

    // (1b) Terminal đang chạy một hội thoại Claude Ở ĐÚNG THƯ MỤC của entry, dù id không khớp
    // (entry chưa từng bắt được id, hoặc id đã cũ vì người dùng /clear rồi chạy phiên khác).
    // Đây chính là ca người dùng gặp: tab cũ vẫn chạy dở, kích hoạt workspace lại mở thêm tab
    // thứ hai cho cùng thư mục. Nhận nuôi rồi trỏ lại id sang phiên đang chạy thật.
    // Bằng chứng ở đây là registry CLAUDE, nên chỉ áp cho entry Claude: một terminal chạy
    // claude ở cùng thư mục với entry Codex thì vẫn không phải terminal của entry đó.
    const idDaCoChu = new Set<string>();
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.claudeSessionId !== undefined && this.terminals.has(t.id)) {
          idDaCoChu.add(t.claudeSessionId);
        }
      }
    }
    for (const entry of cho) {
      if (this.terminals.has(entry.id) || entry.kind !== 'claude') continue;
      for (const [terminal, ds] of phienTrongTerminal) {
        if (this.terminals.ownsTerminal(terminal) !== null) continue;
        // CHỈ cwd trùng là chưa đủ: người dùng hoàn toàn có thể tự mở một tab claude riêng ở
        // cùng thư mục cho việc khác. Nhận nuôi nó nghĩa là lần đóng workspace sau sẽ giết
        // luôn tab đó cùng hội thoại đang dở. Đòi thêm tên khớp — cùng mức bằng chứng với
        // nhánh (2) của entry plain. So sau khi bỏ ký hiệu trạng thái, vì agent ghi tiêu đề
        // tab thành "<ký hiệu> <tên phiên>".
        const tenTab = boKyHieuTrangThai(terminal.name);
        if (tenTab !== entry.name && tenTab !== (entry.claudeName ?? entry.name)) continue;
        const khop = ds.find(
          (r) =>
            r.cwd !== '' &&
            normalizeCwd(r.cwd) === normalizeCwd(entry.cwd) &&
            // Hội thoại đã có entry khác (đang mở) giữ: đây là tiến trình TRÙNG của nó, nhận
            // vào là cướp id của entry kia rồi cả hai cùng rối.
            !idDaCoChu.has(r.sessionId),
        );
        if (!khop) continue;
        idDaCoChu.add(khop.sessionId);
        nhan(entry, terminal);
        // Trỏ id sang phiên đang chạy thật để lần sau khớp thẳng ở (1a) và trạng thái hiện đúng.
        this.claimSession(ws.id, entry.id, khop);
        break;
      }
    }

    // (2) Chỉ entry `plain`, và đòi CẢ tên lẫn cwd khớp — không có bằng chứng tiến trình thì
    // phải chắc chắn bằng cách khác. Nhận nuôi nhầm ở đây là có hại thật: `closeActive` sẽ
    // dispose luôn terminal riêng của người dùng. Ngay sau reload, Shell Integration thường
    // chưa kịp báo cwd → không đủ bằng chứng → mở terminal mới (như trước bản này), thà thừa
    // một shell còn hơn giết nhầm một shell đang chạy dở.
    for (const entry of cho) {
      if (entry.kind !== 'plain' || entry.agentId === 'codex' || this.terminals.has(entry.id)) continue;
      // Tên shell mặc định KHÔNG phải bằng chứng: mọi terminal người dùng tự mở đều tên
      // `pwsh`/`bash`/…, nên "trùng tên + trùng cwd" khi tên là tên shell chỉ nghĩa là "có
      // một terminal nào đó ở cùng thư mục" — nhận nuôi nhầm rồi `closeActive` giết nó.
      if (TEN_SHELL_MAC_DINH.has(entry.name.trim().toLowerCase())) continue;
      const khop = legacyChuaTrack().filter((t) => {
        if (t.name !== entry.name) return false;
        // Ngay sau reload, Shell Integration thường chưa kịp báo cwd, nhưng cwd LÚC TẠO thì
        // VS Code khôi phục cùng terminal — dùng nó làm nguồn thứ hai thay vì bó tay.
        const cwd = t.shellIntegration?.cwd?.fsPath ?? creationCwd(t);
        return cwd !== undefined && normalizeCwd(cwd) === normalizeCwd(entry.cwd);
      });
      if (khop.length === 1) nhan(entry, khop[0]!);
    }

    // (2b) Codex phải xét THEO NHÓM, không xét từng entry: hai entry cùng tên/cwd với một tab
    // sống vẫn làm tab đó trông "duy nhất" ở lượt entry đầu, nhưng ta không biết nó thuộc id
    // nào. Codex không có registry PID như Claude để phân biệt. Đúng đủ số lượng thì ghép ổn
    // định được nhóm một-một; mọi nhóm nhiều phần tử hoặc lệch số lượng đều bỏ qua mở lại CẢ
    // nhóm để không resume chồng và cũng không nhận nuôi nhầm terminal rồi đóng nó về sau.
    // Người dùng có thể đóng tab mơ hồ rồi kích hoạt lại để mở đủ từ store.
    const codexConLai = cho.filter(
      (entry) => entry.agentId === 'codex' && !this.terminals.has(entry.id),
    );
    const terminalConLai = legacyChuaTrack();
    const soEntryTheoKey = new Map<string, number>();
    const soTerminalTheoKey = new Map<string, number>();
    for (const entry of codexConLai) {
      const key = nameCwdKey(entry.name, entry.cwd);
      soEntryTheoKey.set(key, (soEntryTheoKey.get(key) ?? 0) + 1);
    }
    for (const terminal of terminalConLai) {
      const key = restoredTerminalKey(terminal);
      if (key !== null) soTerminalTheoKey.set(key, (soTerminalTheoKey.get(key) ?? 0) + 1);
    }
    const boQua = codexConLai
      .filter((entry) => {
        const key = nameCwdKey(entry.name, entry.cwd);
        const live = soTerminalTheoKey.get(key) ?? 0;
        return live > 0 && (live !== 1 || soEntryTheoKey.get(key) !== 1);
      })
      .map((entry) => entry.id);
    const boQuaSet = new Set(boQua);
    for (const entry of codexConLai) {
      if (boQuaSet.has(entry.id)) continue;
      const key = nameCwdKey(entry.name, entry.cwd);
      const terminal = pickUniqueMatch(
        terminalConLai,
        (candidate) => restoredTerminalKey(candidate) === key,
      );
      if (terminal !== undefined) nhan(entry, terminal);
    }
    return { ids: daNhan, boQua, trung: soTrung, thua: this.terminalThua(phienTrongTerminal) };
  }

  /**
   * Terminal chưa track mà bên trong đang chạy một hội thoại ĐÃ có terminal khác nhận — di
   * chứng của những lần khôi phục chồng trước đây. Hai tiến trình cùng ghi một file phiên nên
   * mỗi cái giữ một bản lịch sử khác nhau; giữ lại chỉ tổ rối. Trả danh sách để hỏi người dùng
   * có đóng bớt không — KHÔNG bao giờ tự đóng: mỗi tiến trình đang giữ một phần việc dở.
   */
  private terminalThua(
    phienTrongTerminal: ReadonlyMap<vscode.Terminal, RunningSession[]>,
  ): vscode.Terminal[] {
    this.phienTrongTerminalThua = new Map();
    const daCoChu = new Set<string>();
    for (const ws of this.store.workspaces) {
      for (const t of ws.terminals) {
        if (t.claudeSessionId !== undefined && this.terminals.has(t.id)) daCoChu.add(t.claudeSessionId);
      }
    }
    const ra: vscode.Terminal[] = [];
    for (const [terminal, ds] of phienTrongTerminal) {
      if (this.terminals.ownsTerminal(terminal) !== null) continue;
      const trung = ds.filter((r) => daCoChu.has(r.sessionId));
      if (trung.length === 0) continue;
      ra.push(terminal);
      // Nhớ id để lúc người dùng bấm nút còn xác minh lại được (hộp thoại không modal).
      this.phienTrongTerminalThua.set(terminal, trung.map((r) => r.sessionId));
    }
    return ra;
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
    const codexRestoreModes = new Map<string, 'exact' | 'last' | 'picker' | 'new'>();
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
      laLenhAgent: (entry) => this.laEntryAgent(entry),
      chonLenhKhoiPhucAgent: async (entry) => {
        if (entry.agentId !== 'codex') return undefined;
        const snapshot = {
          cwd: entry.cwd,
          name: entry.name,
          startCommand: entry.startCommand,
          agentSessionId: entry.agentSessionId,
        };
        const options = this.codex.buildRestoreOptions(entry.startCommand, entry.agentSessionId);
        const picked = await vscode.window.showQuickPick(options, {
          title: `Mở lại Codex: ${entry.name}`,
          placeHolder: 'Chọn lệnh mở lại session (lựa chọn đầu là mặc định)',
        });
        if (!picked) return undefined;

        // QuickPick có thể mở lâu; entry/workspace có thể đã bị xóa trong lúc chờ. Chỉ sửa
        // object hiện hành. Các nhánh không resume đúng id cũ phải bỏ claim cũ để lượt dò sau
        // gắn session thực sự vừa mở, nếu không lần activate kế tiếp lại quay về hội thoại cũ.
        const entryNow = this.findEntry(ws.id, entry.id);
        if (!entryNow || entryNow.agentId !== 'codex') return undefined;
        if (
          entryNow.cwd !== snapshot.cwd ||
          entryNow.name !== snapshot.name ||
          entryNow.startCommand !== snapshot.startCommand ||
          entryNow.agentSessionId !== snapshot.agentSessionId
        ) {
          void vscode.window.showWarningMessage(
            `Terminal "${snapshot.name}" đã thay đổi trong lúc chọn session; chưa mở để tránh resume nhầm.`,
          );
          return undefined;
        }
        codexRestoreModes.set(entry.id, picked.mode);
        return { command: picked.command, entry: entryNow };
      },
      onAgentLaunched: (entry, command, startedAt) => {
        if (entry.agentId !== 'codex') return;
        const mode = codexRestoreModes.get(entry.id);
        codexRestoreModes.delete(entry.id);
        if (mode === undefined) return;
        const entryNow = this.findEntry(ws.id, entry.id);
        if (!entryNow || entryNow !== entry) return;
        // Chỉ commit lựa chọn SAU khi terminal đã tạo và sendText thành công. Nếu create/send
        // ném, exact session id cũ vẫn nguyên vẹn để thử lại lần sau.
        if (mode !== 'exact') delete entryNow.agentSessionId;
        entryNow.startCommand = command;
        this.touch(ws.id);
        this.scheduleSave();
        if (mode === 'exact') return;
        // `resume --last` và picker ghi tiếp file cũ; "new" phải chỉ nhận file mới. Cùng
        // một bộ dò với lệnh tạo terminal nên vẫn giữ bất biến một session/một entry.
        void this.khamPhaSessionCodex(ws.id, entry.id, entry.cwd, startedAt, mode !== 'new');
      },
      coPhienDangChayNgoai: (cwd) => {
        // Không đọc nổi registry ở bước nối lại = không biết → phải coi như CÓ (xem ghi chú
        // ở ActivatePorts): thà mở phiên mới còn hơn `-c` chui vào hội thoại đang chạy dở.
        if (this.docRegistryLoiKhiKhoiPhuc) return true;
        const daCoChu = new Set<string>();
        for (const w of this.store.workspaces) {
          for (const t of w.terminals) {
            if (t.claudeSessionId !== undefined && this.terminals.has(t.id)) {
              daCoChu.add(t.claudeSessionId);
            }
          }
        }
        return this.phienLucKhoiPhuc.some(
          (r) =>
            r.cwd !== '' &&
            normalizeCwd(r.cwd) === normalizeCwd(cwd) &&
            !daCoChu.has(r.sessionId),
        );
      },
      // Vân tay trust tính trên TOÀN workspace, không phải tập sắp mở: hôm nay mở 5 terminal,
      // hôm sau 2 cái đã chạy sẵn nên chỉ mở 3 — cùng một workspace mà tập lệnh khác nhau thì
      // vân tay trượt và người dùng bị hỏi tin cậy lại mỗi lần.
      isTrusted: () => this.trust.isTrusted(trustKey, this.lenhCanTinCay(ws)),
      confirmTrust: async () => {
        // Hiện ĐÚNG tập lệnh sẽ được ghi vào vân tay (cả workspace), không phải tập sắp chạy:
        // tin một tập rộng hơn những gì người dùng nhìn thấy là mở đường chạy ngầm sau này.
        const tatCa = this.lenhCanTinCay(ws);
        const lines = tatCa.map((c) => `• ${c}`).join('\n');
        const answer = await vscode.window.showWarningMessage(
          `Workspace "${ws.name}" có các lệnh khởi động sau; chúng chạy mỗi khi terminal tương ứng được mở:\n\n${lines}`,
          { modal: true },
          'Tin và chạy',
        );
        if (answer !== 'Tin và chạy') return false;
        await this.trust.trust(trustKey, tatCa);
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
   * Đường đi của LỆNH đóng workspace — hỏi confirm trước.
   * Check "đang mở" TRƯỚC modal: Extension Host headless (smoke test) không có ai bấm.
   */
  async closeConfirmed(workspaceId: string): Promise<void> {
    if (!this.laDangMo(workspaceId)) return;
    const ten = findWorkspace(this.store, workspaceId)?.name ?? '';
    const answer = await vscode.window.showWarningMessage(
      `Đóng workspace "${ten}"? Terminal của nó sẽ đóng — trạng thái đã tự lưu, kích hoạt lại là mở tiếp.`,
      { modal: true },
      'Đóng',
    );
    if (answer !== 'Đóng') return;
    // Trong lúc chờ modal, workspace có thể đã bị đóng bởi luồng khác.
    if (!this.laDangMo(workspaceId)) return;
    await this.close(workspaceId);
  }

  /** Đóng ĐÚNG một workspace. Các workspace khác đang mở không bị đụng tới. */
  async close(workspaceId: string): Promise<void> {
    if (!this.laDangMo(workspaceId)) return;
    // Quét bắt session lần cuối TRƯỚC khi dispose terminal — dispose xong là hết đường bắt.
    await this.finalClaimSweep(workspaceId);
    this.activeIds = this.activeIds.filter((x) => x !== workspaceId);
    // Vòng poll phục vụ MỌI workspace đang mở — chỉ tắt khi không còn cái nào.
    if (this.activeIds.length === 0) this.stopActivePoll();
    this.flush();

    const ws = findWorkspace(this.store, workspaceId);
    if (ws) {
      // Chỉ gỡ nhãn "đang tải" của workspace này: xoá sạch loadingIds làm spinner của
      // workspace khác đang mở dở biến mất oan.
      this.ketThucLoading(ws.terminals.map((t) => t.id));
      for (const entry of ws.terminals) {
        this.terminals.get(entry.id)?.dispose();
        this.statuses.delete(entry.id);
        // Không xóa thì nhãn "lỗi" của lần activate trước còn dính mãi ở lần mở sau.
        this.errorIds.delete(entry.id);
      }
      ws.activeWindowId = null;
      this.touch(ws.id);
    }
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
    this.activeIds = this.activeIds.filter((x) => x !== wsNow.id);
    wsNow.activeWindowId = null;
    // Xóa = xóa FILE của workspace đó ở lần lưu tới. Không cần bia mộ nữa: mô hình một-file-
    // chung phải nhớ "đã xóa" để lần gộp sau không cứu nó sống lại từ đĩa, còn ở đây file
    // biến mất là biến mất, và các cửa sổ khác thấy điều đó ngay ở lần đồng bộ kế tiếp.
    this.deletedIds.add(wsNow.id);
    this.dirtyIds.add(wsNow.id);
    for (const entry of wsNow.terminals) {
      this.terminals.release(entry.id);
      this.quenTerminal(entry.id);
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

    const luaChon = await vscode.window.showQuickPick(
      this.agent.buildLaunchOptions(path.basename(duongDan) || 'claude'),
      { placeHolder: 'Chạy Claude thế nào?' },
    );
    if (!luaChon) return;

    // Hỏi worktree SAU CÙNG, vì bước này TẠO THẬT thư mục + nhánh git. Hỏi trước rồi người
    // dùng Esc ở hộp thoại sau là để lại rác không ai dọn (addWorktree cố ý không có đường gỡ).
    const kq = await this.hoiWorktree(duongDan, this.agent.id);
    if (kq === undefined) return;
    const cwd = kq.cwd;
    // Tên terminal = tên worktree. Tên ghép PHẲNG nên basename của đường dẫn chính là nó.
    const ten = path.basename(cwd) || 'claude';
    const wt = kq.worktree === undefined ? {} : { worktree: kq.worktree };

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
            ...wt,
          }
        : { id: randomUUID(), name: ten, cwd, kind: 'plain', ...wt };
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
   * Tạo terminal Codex. Khác luồng Claude ở chỗ Codex KHÔNG cho đặt trước session id, nên
   * không thể "mint rồi chạy" — phải chạy trước rồi khám phá id từ file rollex mà Codex ghi
   * ra (`~/.codex/sessions/…`). Lệnh khởi chạy được lưu vào `startCommand` để lần khôi phục
   * sau vẫn mở đúng thứ ngay cả khi chưa kịp khám phá ra id.
   */
  async newCodexTerminal(workspaceId: string): Promise<void> {
    if (!findWorkspace(this.store, workspaceId)) return;

    const duongDan = await this.hoiDuongDan();
    if (duongDan === undefined) return;

    const luaChon = await vscode.window.showQuickPick(this.codex.buildLaunchOptions(), {
      placeHolder: 'Chạy Codex thế nào?',
    });
    if (!luaChon) return;

    // Hỏi worktree SAU CÙNG (xem ghi chú ở newClaudeTerminal): bước này tạo thật thư mục+nhánh.
    const kq = await this.hoiWorktree(duongDan, this.codex.id);
    if (kq === undefined) return;
    const cwd = kq.cwd;
    const ten = path.basename(cwd) || 'codex';

    // Lấy lại object sau chuỗi hộp thoại rồi mới touch (xem ghi chú ở activate()).
    const wsNow = findWorkspace(this.store, workspaceId);
    if (!wsNow) {
      void vscode.window.showWarningMessage('Workspace không còn tồn tại.');
      return;
    }
    this.touch(wsNow.id);

    const entry: TerminalEntry = {
      id: randomUUID(),
      name: ten,
      cwd,
      kind: 'plain',
      agentId: 'codex',
      startCommand: luaChon.command,
      ...(kq.worktree === undefined ? {} : { worktree: kq.worktree }),
    };
    upsertTerminal(wsNow, entry);
    this.scheduleSave();

    const truocKhiChay = Date.now();
    const handle = this.terminals.create(entry.id, {
      name: entry.name,
      cwd,
      location: wsNow.terminalLocation,
    });
    this.ghiNhanShellPid(entry.id);
    handle.sendText(luaChon.command);
    this.batDauLoading([entry.id]);
    this.onChanged.fire();
    void this.nhoCwd(cwd);
    // Chỉ biến thể resume mới được nhận diện qua "file cũ vừa được ghi tiếp"; với phiên MỚI
    // thì bắt buộc phải có file rollout mới, nếu không sẽ vơ nhầm phiên của terminal khác
    // đang chạy trong cùng thư mục.
    const laResume = luaChon.mode !== 'new';
    void this.khamPhaSessionCodex(workspaceId, entry.id, cwd, truocKhiChay, laResume);
  }

  /**
   * Dò id phiên Codex vừa mở. Codex ghi file rollout ngay khi phiên bắt đầu, nhưng có độ trễ
   * (và người dùng có thể còn đang chọn phiên ở màn hình `codex resume`), nên dò lặp lại
   * trong một khoảng thời gian rồi thôi — không tìm được thì entry vẫn khôi phục bằng lệnh
   * khởi chạy đã lưu, chỉ là mở phiên mới thay vì phiên cũ.
   */
  private async khamPhaSessionCodex(
    workspaceId: string,
    terminalId: string,
    cwd: string,
    tuLuc: number,
    laResume: boolean,
  ): Promise<void> {
    for (let lan = 0; lan < CODEX_DO_SO_LAN; lan += 1) {
      await new Promise((r) => setTimeout(r, CODEX_DO_NHIP_MS));
      if (this.disposed || !this.terminals.has(terminalId)) return;
      const entry = this.findEntry(workspaceId, terminalId);
      if (!entry || entry.agentId !== 'codex') return;
      if (entry.agentSessionId !== undefined) return;

      const phien = this.codex.timSessionMoi(cwd, tuLuc, Date.now(), {
        chapNhanFileCu: laResume,
        boQua: this.sessionCodexDaCoChu(terminalId),
      });
      if (!phien) continue;
      this.ganSessionCodexVaoEntry(workspaceId, terminalId, phien.sessionId);
      this.loadingIds.delete(terminalId);
      this.onChanged.fire();
      return;
    }
  }

  /** Các phiên Codex đã thuộc entry khác — không được gắn lần hai cho terminal này. */
  private sessionCodexDaCoChu(trongterminalId: string): Set<string> {
    const ra = new Set<string>();
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.id !== trongterminalId && t.agentSessionId !== undefined) ra.add(t.agentSessionId);
      }
    }
    return ra;
  }

  /**
   * Ghi phiên Codex vào entry, giữ bất biến MỘT hội thoại chỉ thuộc MỘT entry — y như
   * `claimSession` làm cho Claude: hai entry cùng id là hai `codex resume <id>` cùng ghi một
   * file rollout. Chỉ đụng phần thuộc cửa sổ này (touch workspace lạ là leo thang quyền sở hữu).
   * Toàn bộ đồng bộ, không await xen giữa tra lại entry và `touch`.
   */
  private ganSessionCodexVaoEntry(
    workspaceId: string,
    terminalId: string,
    sessionId: string,
  ): boolean {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return false;
    for (const w of this.store.workspaces) {
      for (const t of w.terminals) {
        if (t.id === terminalId || t.agentSessionId !== sessionId) continue;
        if (!this.touchedIds.has(w.id) && !this.terminals.has(t.id)) continue;
        delete t.agentSessionId;
        if (t.startCommand === this.codex.buildResumeCommand(sessionId, t.startCommand)) {
          // Không XÓA lệnh: entry còn là terminal Codex, xóa đi là lần mở lại chỉ có shell
          // trống. Hạ về "phiên mới" — mất hội thoại cũ (nó thuộc terminal khác) nhưng vẫn
          // mở đúng công cụ.
          t.startCommand = this.codex
            .buildRestoreOptions(t.startCommand)
            .find((option) => option.mode === 'new')?.command;
        }
        this.touch(w.id);
      }
    }
    entry.agentId = 'codex';
    entry.agentSessionId = sessionId;
    entry.startCommand = this.codex.buildResumeCommand(sessionId, entry.startCommand);
    this.touch(workspaceId);
    this.scheduleSave();
    return true;
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

  /**
   * Entry này có phải terminal agent do chính extension dựng lệnh khởi chạy không.
   *
   * Đòi HAI bằng chứng: (1) `agentId` — chỉ code của extension đặt, người dùng/repo không
   * chạm được; (2) chuỗi lệnh khớp ĐÚNG một lệnh mà adapter sinh ra. Chỉ dựa vào chuỗi là
   * thủng: auto-capture ghi lại `./codex` của một repo lạ rồi lệnh đó chạy mỗi lần activate
   * mà không bao giờ qua modal tin cậy. Chỉ dựa vào `agentId` cũng thủng: auto-capture có thể
   * thay `startCommand` của chính entry codex bằng một lệnh bất kỳ.
   */
  /**
   * Agent đang chạy trong terminal này. MỘT vị từ dùng chung cho nhãn trong cây lẫn lệnh gắn
   * session — hai nơi nhận diện lệch nhau thì người dùng thấy nhãn `shell` mà menu lại xử như
   * Codex. `agentId` là bằng chứng mạnh (do extension đặt); lệnh đã bắt được là bằng chứng
   * yếu hơn nhưng đủ để hiển thị và để chọn nhánh gắn session.
   */
  private agentCuaEntry(entry: TerminalEntry): 'claude' | 'codex' | undefined {
    if (entry.kind === 'claude') return 'claude';
    if (entry.agentId === 'codex') return 'codex';
    if (entry.startCommand !== undefined && this.codex.ownsCommand(entry.startCommand)) {
      return 'codex';
    }
    return undefined;
  }

  private laEntryAgent(entry: TerminalEntry): boolean {
    // Nhánh này hiện là dự phòng: cả hai chỗ gọi đều đã lọc `kind === 'plain'` từ trước.
    // Giữ lại để hàm đúng nghĩa khi đứng một mình, đừng tưởng nó đang gánh việc.
    if (entry.kind === 'claude') return true;
    if (entry.agentId !== 'codex' || entry.startCommand === undefined) return false;
    const hopLe = new Set(this.codex.buildLaunchOptions().map((o) => o.command));
    for (const option of this.codex.buildRestoreOptions(entry.startCommand, entry.agentSessionId)) {
      hopLe.add(option.command);
    }
    return hopLe.has(entry.startCommand);
  }

  /**
   * Tập lệnh khởi động CẦN tin cậy của cả workspace — nguồn duy nhất cho vân tay trust.
   * Lệnh agent bị loại, và bộ lọc phải khớp ĐÚNG bộ lọc trong `activateWorkspace`, nếu không
   * vân tay hai bên lệch nhau và người dùng bị hỏi tin cậy lại mỗi lần.
   */
  private lenhCanTinCay(ws: Workspace): string[] {
    return ws.terminals
      .filter((t) => t.kind === 'plain' && t.startCommand && !this.laEntryAgent(t))
      .map((t) => t.startCommand as string);
  }

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
  /**
   * Hỏi worktree cho terminal agent sắp mở. Lý do tồn tại: hai terminal cùng trỏ một thư mục
   * thì "nối lại phiên gần nhất" (`claude -c`, `codex resume --last`) trỏ vào CÙNG một hội
   * thoại, và cơ chế bắt session theo cwd cũng không phân biệt nổi. Mỗi worktree là một thư
   * mục + một nhánh riêng nên hết đụng nhau.
   *
   * Hỏi VIỆC chứ không hỏi tên worktree: tên là `<việc>-<vai>` (xem `ghepTenWorktree`), nên
   * mọi vai cùng làm một việc nằm liền nhau trong `git branch`. `vai` tạm là id agent; khi
   * có roles thì đây là chỗ duy nhất đổi nguồn sang tên vai.
   *
   * Trả về thư mục làm việc cuối cùng kèm worktree (nếu có); `undefined` nghĩa là người dùng
   * hủy cả lệnh.
   */
  private async hoiWorktree(cwd: string, vai: string): Promise<KetQuaWorktree | undefined> {
    const goc = await this.git.repoRoot(cwd);
    if (goc === null) return { cwd }; // không phải repo git thì không có worktree để bàn

    const viec = await vscode.window.showInputBox({
      title: `Worktree trong repo ${path.basename(goc)}`,
      prompt: `Tên việc — thư mục + nhánh riêng sẽ là "<việc>-${vai}". Để TRỐNG nếu làm thẳng trên thư mục vừa chọn.`,
      placeHolder: 'ví dụ: fix-login',
      validateInput: (v) => {
        const t = v.trim();
        if (t === '') return undefined;
        // Tên này đi thẳng vào tên nhánh git và một đoạn đường dẫn — chặn ngay ở cửa nhập.
        if (!/^[\w.][\w./-]*$/.test(t) || t.includes('..')) {
          return 'Chỉ dùng chữ, số, dấu . _ - / và không bắt đầu bằng dấu -';
        }
        return undefined;
      },
    });
    if (viec === undefined) return undefined;
    if (viec.trim() === '') return { cwd };
    const tenWt = ghepTenWorktree(viec, vai);

    // NGOÀI repo, không phải `<repo>/.worktrees/`: đặt bên trong repo thì `git clean -xdf`
    // (lệnh dọn rất thường dùng) xoá sạch worktree cùng mọi thay đổi chưa commit trong đó,
    // và VS Code còn index/watch một cây làm việc thứ hai nằm lồng bên trong.
    const duongDan = path.join(path.dirname(goc), `${path.basename(goc)}${HAU_TO_WORKTREE}`, tenWt);
    if (nodeFs.existsSync(duongDan)) {
      // Thư mục sẵn có phải THẬT là một cây làm việc git, không phải rác trùng tên (hoặc một
      // lần `git worktree add` bị giết giữa chừng vì timeout).
      if ((await this.git.repoRoot(duongDan)) === null) {
        void vscode.window.showWarningMessage(
          `"${duongDan}" đã tồn tại nhưng không phải worktree git hợp lệ. Chọn tên khác hoặc dọn thư mục đó trước.`,
        );
        return undefined;
      }
      // DÙNG LẠI, không đánh số thứ tự: mở lại cùng việc + cùng vai phải cho ra cùng worktree.
      // Thêm hậu tố `-2` ở đây là biến thao tác mở lại thành thao tác tạo mới.
      return { cwd: duongDan, ...(await this.nhanhCuaWorktree(duongDan)) };
    }

    try {
      await this.git.addWorktree(goc, duongDan, tenWt);
    } catch (e) {
      void vscode.window.showWarningMessage(
        `Không tạo được worktree "${tenWt}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
    return { cwd: duongDan, worktree: { path: duongDan, branch: tenWt } };
  }

  /**
   * Nhánh của một worktree đã có sẵn. Đọc không được thì trả rỗng — terminal vẫn mở bình
   * thường, chỉ là entry không mang `worktree`; không đáng chặn cả lệnh vì một lệnh đọc phụ.
   */
  private async nhanhCuaWorktree(duongDan: string): Promise<{ worktree?: WorktreeRef }> {
    const ds = await this.git.listWorktrees(duongDan);
    const khop = ds.find((w) => chuanHoaDuongDan(w.path) === chuanHoaDuongDan(duongDan));
    const branch = khop?.branch;
    if (branch === undefined || branch === null) return {};
    return { worktree: { path: duongDan, branch } };
  }

  /**
   * Dọn worktree do extension tạo. Bốn lớp chặn, theo thứ tự:
   *  1. chỉ đụng đường dẫn nằm trong `<repo>-worktrees/` (`laWorktreeCuaExtension`),
   *  2. cái đang có terminal mở thì không gỡ được,
   *  3. cái còn thay đổi chưa commit / nhánh chưa merge thì không được tích sẵn,
   *  4. `git worktree remove` không `--force`, `git branch -d` không `-D` — git từ chối là
   *     lưới an toàn đang làm việc, không phải lỗi cần vượt qua.
   */
  async cleanWorktrees(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
    if (!ws) return;

    const ungVien = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Đang dò worktree…' },
      () => this.doWorktree(ws),
    );
    if (ungVien.length === 0) {
      void vscode.window.showInformationMessage(
        'Không tìm thấy worktree nào do extension tạo cho workspace này.',
      );
      return;
    }

    const NHAN: Record<LoaiWorktree, string> = {
      sach: 'sạch, đã merge',
      chuaMerge: 'CHƯA merge vào nhánh mặc định',
      banThayDoi: 'CÒN THAY ĐỔI CHƯA COMMIT',
      dangDung: 'đang có terminal mở — đóng terminal trước đã',
    };
    const chon = await vscode.window.showQuickPick(
      ungVien.map((u) => ({
        label: path.basename(u.path),
        description: NHAN[u.loai],
        detail: u.path,
        picked: u.loai === 'sach',
        ung: u,
      })),
      { canPickMany: true, placeHolder: 'Chọn worktree để gỡ (chỉ cái sạch được tích sẵn)' },
    );
    if (!chon || chon.length === 0) return;

    // QuickPick không có cách khoá một mục lại, nên lọc lần nữa ở đây: gỡ worktree đang có
    // terminal mở là rút thư mục làm việc ra từ dưới chân một shell đang chạy dở.
    const go = chon.map((c) => c.ung).filter((u) => u.loai !== 'dangDung');
    if (go.length === 0) {
      void vscode.window.showWarningMessage(
        'Những worktree đó đang có terminal mở. Đóng terminal rồi chạy lại lệnh dọn.',
      );
      return;
    }

    const soEntry = go.reduce((t, u) => t + u.entryIds.length, 0);
    const answer = await vscode.window.showWarningMessage(
      `Gỡ ${go.length} worktree?`,
      {
        modal: true,
        detail: [
          ...go.map((u) => `• ${u.path}${u.branch === null ? '' : ` (nhánh ${u.branch})`}`),
          '',
          soEntry === 0
            ? 'Không terminal nào của workspace này trỏ vào chúng.'
            : `${soEntry} terminal trỏ vào các worktree này cũng sẽ bị bỏ khỏi workspace — thư mục mất rồi thì chúng không mở lại được nữa.`,
          'Git sẽ TỪ CHỐI nếu còn thay đổi chưa commit hoặc nhánh chưa merge: lệnh này không có cờ ép.',
        ].join('\n'),
      },
      'Gỡ',
    );
    if (answer !== 'Gỡ') return;

    const loi: string[] = [];
    let daGo = 0;
    for (const u of go) {
      const r = await this.git.removeWorktree(u.repoRoot, u.path);
      if (!r.ok) {
        loi.push(`${path.basename(u.path)}: ${r.stderr}`);
        continue;
      }
      daGo += 1;
      // Bỏ entry NGAY sau khi thư mục mất: để lại entry trỏ vào đường dẫn chết là để lại thứ
      // không bao giờ mở lại được.
      for (const id of u.entryIds) await this.removeTerminal(workspaceId, id);
      if (u.branch === null) continue;
      const rb = await this.git.deleteBranch(u.repoRoot, u.branch);
      if (!rb.ok) loi.push(`nhánh ${u.branch}: ${rb.stderr}`);
    }

    const bao = `Đã gỡ ${daGo}/${go.length} worktree.`;
    if (loi.length === 0) {
      void vscode.window.showInformationMessage(bao);
      return;
    }
    void vscode.window.showWarningMessage(`${bao} Git từ chối ${loi.length} việc: ${loi.join(' · ')}`);
  }

  /**
   * Liệt kê worktree do extension tạo, cho các repo mà workspace này có dính tới.
   *
   * `git worktree list` chạy từ BẤT KỲ worktree nào cũng liệt kê cả repo, và mục ĐẦU TIÊN
   * luôn là worktree chính — đó mới là repoRoot để đối chiếu `<repo>-worktrees/`. KHÔNG dùng
   * `rev-parse --show-toplevel` ở đây: đứng trong một worktree thì nó trả về chính worktree
   * đó, và bước lọc an toàn sẽ so sai hoàn toàn.
   *
   * Nhờ đi qua `worktree list`, worktree MỒ CÔI — cái mà entry trỏ vào nó đã bị bỏ khỏi
   * workspace từ trước — vẫn hiện ra, miễn còn một entry nào đó neo được vào cùng repo. Đó là
   * đường duy nhất dọn được rác của những lần trước.
   */
  private async doWorktree(ws: Workspace): Promise<UngVienDon[]> {
    const thuMuc = new Set<string>();
    for (const e of ws.terminals) {
      thuMuc.add(e.cwd);
      if (e.worktree !== undefined) thuMuc.add(e.worktree.path);
    }

    const theoRepo = new Map<string, WorktreeInfo[]>();
    for (const d of thuMuc) {
      if (!nodeFs.existsSync(d)) continue;
      const ds = await this.git.listWorktrees(d);
      const chinh = ds[0];
      if (chinh === undefined) continue;
      if (!theoRepo.has(chinh.path)) theoRepo.set(chinh.path, ds);
    }

    const trongWt = (t: TerminalEntry, wtPath: string): boolean =>
      trongThuMuc(t.worktree?.path ?? t.cwd, wtPath);

    const ra: UngVienDon[] = [];
    for (const [repoRoot, ds] of theoRepo) {
      const base = await this.git.defaultBranch(repoRoot);
      // Không xác định được nhánh mặc định → coi MỌI nhánh là chưa merge. Đoán bừa ở đây là
      // xoá nhầm việc của người dùng.
      const daMerge =
        base === null ? new Set<string>() : new Set(await this.git.mergedBranches(repoRoot, base));
      for (const w of ds) {
        if (!laWorktreeCuaExtension(w.path, repoRoot)) continue;
        // "Đang dùng" xét MỌI workspace — terminal của workspace khác cũng không được kéo thảm
        // dưới chân. Nhưng chỉ entry của workspace NÀY mới bị bỏ đi cùng.
        const dangDung = this.store.workspaces.some((w2) =>
          w2.terminals.some((t) => this.terminals.has(t.id) && trongWt(t, w.path)),
        );
        ra.push({
          repoRoot,
          path: w.path,
          branch: w.branch,
          loai: phanLoaiWorktree({
            dangDung,
            sachGit: await this.git.isClean(w.path),
            daMerge: w.branch !== null && daMerge.has(w.branch),
          }),
          entryIds: ws.terminals.filter((t) => trongWt(t, w.path)).map((t) => t.id),
        });
      }
    }
    return ra;
  }

  private async hoiDuongDan(): Promise<string | undefined> {
    // Vòng lặp vì "duyệt thư mục" là một chuyến đi vòng: mở hộp thoại hệ điều hành, người
    // dùng bấm Cancel ở đó thì phải quay LẠI QuickPick với nguyên chữ đã gõ — bắt họ chạy
    // lại cả lệnh chỉ vì bấm nhầm nút duyệt là tệ.
    let batDau = '';
    for (;;) {
      const chon = await this.chonDuongDanNhanh(batDau);
      if (chon === undefined) return undefined; // Esc ở QuickPick → hủy hẳn
      if (chon.loai === 'xong') return chon.duongDan;

      const gocMacDinh = this.thuMucMacDinhDeDuyet(chon.dangGo);
      const chonDuoc = await vscode.window.showOpenDialog({
        title: 'Chọn thư mục làm việc cho terminal',
        openLabel: 'Chọn thư mục này',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: gocMacDinh === undefined ? undefined : vscode.Uri.file(gocMacDinh),
      });
      const daChon = chonDuoc?.[0];
      if (daChon !== undefined) return daChon.fsPath;
      batDau = chon.dangGo;
    }
  }

  /** Thư mục mở sẵn khi bật hộp thoại duyệt: chỗ người dùng đang gõ dở → gợi ý mới nhất. */
  private thuMucMacDinhDeDuyet(dangGo: string): string | undefined {
    const go = dangGo.trim();
    if (go !== '' && nodeFs.existsSync(go)) return go;
    const cha = go === '' ? undefined : path.dirname(go);
    if (cha !== undefined && cha !== go && nodeFs.existsSync(cha)) return cha;
    return this.goiYDuongDan()[0];
  }

  private goiYDuongDan(): string[] {
    return gopGoiYDuongDan([
      this.lichSuCwd(),
      this.store.workspaces.flatMap((w) => w.terminals.map((t) => t.cwd)),
      (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    ]);
  }

  private async chonDuongDanNhanh(
    batDau: string,
  ): Promise<{ loai: 'xong'; duongDan: string } | { loai: 'duyet'; dangGo: string } | undefined> {
    type Muc = vscode.QuickPickItem & { duongDan: string | null };
    const goiY = this.goiYDuongDan();
    const mucGoiY: Muc[] = goiY.map((p) => ({
      label: path.basename(p) || p,
      description: p,
      duongDan: p,
    }));
    // Ở CUỐI danh sách: Enter khi chưa gõ gì phải rơi vào gợi ý đầu tiên, không phải nút duyệt.
    // `alwaysShow` để nó không bị bộ lọc ăn mất khi người dùng gõ một chuỗi không khớp gì.
    const mucDuyet: Muc = {
      label: '$(folder-opened) Duyệt tìm thư mục…',
      description: 'mở hộp thoại chọn thư mục',
      duongDan: null,
      alwaysShow: true,
    };

    type KetQua = { loai: 'xong'; duongDan: string } | { loai: 'duyet'; dangGo: string };
    return await new Promise<KetQua | undefined>((resolve) => {
      let ketQua: KetQua | undefined;
      const qp = vscode.window.createQuickPick<Muc>();
      qp.title = 'Thư mục làm việc cho terminal';
      qp.placeholder = 'Gõ để tìm trong đường dẫn đã dùng, dán đường dẫn đầy đủ, hoặc chọn "Duyệt tìm thư mục"';
      // Lọc cả theo description: người dùng gõ "qualipa" phải khớp được giữa đường dẫn.
      qp.matchOnDescription = true;
      qp.items = [...mucGoiY, mucDuyet];
      qp.onDidChangeValue((v) => {
        const go = v.trim();
        if (go === '' || goiY.some((p) => p === go)) {
          qp.items = [...mucGoiY, mucDuyet];
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
          mucDuyet,
        ];
      });
      qp.onDidAccept(() => {
        const muc = qp.selectedItems[0];
        if (muc !== undefined && muc.duongDan === null) {
          ketQua = { loai: 'duyet', dangGo: qp.value };
          qp.hide();
          return;
        }
        const duongDan = (muc?.duongDan ?? qp.value).trim();
        if (duongDan === '') return;
        if (!nodeFs.existsSync(duongDan)) {
          qp.title = `Đường dẫn không tồn tại: ${duongDan}`;
          return; // giữ hộp thoại mở để sửa tiếp
        }
        ketQua = { loai: 'xong', duongDan };
        qp.hide();
      });
      qp.onDidHide(() => {
        qp.dispose();
        resolve(ketQua);
      });
      qp.value = batDau;
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
    const wsBefore = findWorkspace(this.store, workspaceId);
    const entryBefore = wsBefore?.terminals.find((entry) => entry.id === terminalId);
    if (!wsBefore || !entryBefore) {
      // Item stale nhưng key còn track: nhả để terminal không bị khóa khỏi adoption mãi mãi.
      this.terminals.release(terminalId);
      this.quenTerminal(terminalId);
      return;
    }

    const trackedBefore = this.terminals.get(terminalId);
    const liveCandidates = (entry: TerminalEntry): vscode.Terminal[] => {
      const untracked = vscode.window.terminals.filter(
        (terminal) => this.terminals.ownsTerminal(terminal) === null,
      );
      // ID do TerminalManager nhúng lúc tạo là bằng chứng trực tiếp. Chỉ rơi về tên+cwd cho
      // terminal legacy chưa có marker; marker của entry khác là bằng chứng terminal KHÔNG thuộc
      // entry này, dù tên/cwd có giống hệt.
      const exact = untracked.filter((terminal) => managedTerminalId(terminal) === entry.id);
      if (exact.length > 0) return exact;
      return untracked.filter(
        (terminal) => managedTerminalId(terminal) === undefined && terminalMatchesEntry(terminal, entry),
      );
    };
    const candidatesBefore = trackedBefore === undefined ? liveCandidates(entryBefore) : [];
    const terminalBefore = trackedBefore ?? pickUniqueMatch(candidatesBefore, () => true);
    let decision: RemoveTerminalDecision;
    if (trackedBefore === undefined && candidatesBefore.length > 1) {
      // Không đưa nút "đóng" khi không biết tab nào là của entry: một thao tác remove không
      // được biến thành đóng đoán terminal người dùng. Modal vẫn chặn việc âm thầm quên entry.
      const answer = await vscode.window.showWarningMessage(
        `Tìm thấy ${candidatesBefore.length} terminal cùng khớp "${entryBefore.name}" nhưng không xác định được tab tương ứng. Chỉ bỏ entry khỏi workspace và giữ nguyên tất cả terminal?`,
        { modal: true },
        'Chỉ bỏ khỏi workspace',
      );
      decision = answer === 'Chỉ bỏ khỏi workspace' ? 'remove-only' : 'cancel';
    } else {
      decision = await decideTerminalRemoval(terminalBefore !== undefined, async () => {
        const answer = await vscode.window.showWarningMessage(
          `Có đóng terminal "${entryBefore.name}" đang mở khi bỏ khỏi workspace "${wsBefore.name}" không?`,
          { modal: true },
          'Bỏ và đóng terminal',
          'Chỉ bỏ khỏi workspace',
        );
        if (answer === 'Bỏ và đóng terminal') return 'close';
        if (answer === 'Chỉ bỏ khỏi workspace') return 'keep';
        return undefined;
      });
    }
    if (decision === 'cancel') return;

    // Modal có thể mở lâu: chỉ sửa entry hiện hành. Nếu nó đã biến mất thì không tự ý đóng
    // terminal dựa trên một item cũ; luồng xóa workspace chịu trách nhiệm release tracking.
    const wsNow = findWorkspace(this.store, workspaceId);
    const entryNow = wsNow?.terminals.find((entry) => entry.id === terminalId);
    if (!wsNow || !entryNow) return;
    const candidatesNow = trackedBefore === undefined ? liveCandidates(entryNow) : [];
    const sameUniqueLive =
      terminalBefore !== undefined &&
      candidatesNow.length === 1 &&
      candidatesNow[0] === terminalBefore &&
      (
        managedTerminalId(terminalBefore) === terminalId ||
        (entryNow.name === entryBefore.name && entryNow.cwd === entryBefore.cwd)
      );
    const canStillClose =
      terminalBefore !== undefined &&
      (
        this.terminals.get(terminalId) === terminalBefore ||
        (trackedBefore === undefined && sameUniqueLive)
      );
    if (decision === 'remove-and-close' && !canStillClose) {
      void vscode.window.showWarningMessage(
        `Terminal "${entryBefore.name}" đã thay đổi trong lúc chờ xác nhận; chưa bỏ khỏi workspace để tránh đóng nhầm tab.`,
      );
      return;
    }
    if (decision === 'remove-and-close' && terminalBefore !== undefined) {
      terminalBefore.dispose();
    }
    this.terminals.release(terminalId);
    this.quenTerminal(terminalId);
    removeTerminalEntry(wsNow, terminalId);
    this.touch(wsNow.id);
    this.scheduleSave();
    this.onChanged.fire();
  }

  focusTerminal(workspaceId: string, terminalId: string): void {
    if (this.terminals.focus(terminalId)) return;
    const ws = findWorkspace(this.store, workspaceId);
    const entry = ws?.terminals.find((t) => t.id === terminalId);
    if (!ws || !entry) return;
    if (!this.laDangMo(ws.id)) {
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
    if (this.terminals.ownsTerminal(terminal) !== null) return;
    // Tra TRƯỚC mọi await, và `wsNhan()` có `terminalFocusCuoi` làm lối lui cho đúng tình
    // huống terminal vừa mở đã kịp thành activeTerminal.
    const nhan = this.wsNhan();
    if (nhan === null) return;
    const ws = findWorkspace(this.store, nhan);
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
      if (!this.laDangMo(ws.id)) return;
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
    // Ghi nhận TRƯỚC mọi bộ lọc: đây là tín hiệu "có chương trình đang chạy trong terminal
    // này", dùng cho việc bảo vệ tên (xem syncTerminalNames), không phải để bắt startCommand.
    this.dangChayLenh.add(key);
    const ws = this.timWorkspaceChuaTerminal(key);
    if (!ws) return;
    const entry = ws.terminals.find((t) => t.id === key);
    if (!entry) return;
    const lenh = event.execution.commandLine.value;
    const laLenhClaude = this.agent.ownsCommand(lenh);
    // Entry codex: lệnh codex KHÔNG được auto-capture, nếu không nó ghi đè `codex resume <id>`
    // mà ta vừa gài, mất luôn cái chốt phiên. Terminal thường mà người dùng tự gõ `codex` thì
    // VẪN bắt như mọi app khác — và vì entry đó không có `agentId`, lệnh ấy vẫn phải qua cổng
    // tin cậy ở lần khôi phục.
    const boQuaBat = laLenhClaude || (entry.agentId === 'codex' && this.codex.ownsCommand(lenh));
    if (laLenhClaude) {
      // Vừa chạy claude trong terminal này → kết luận "đã tra, không có claude" và cặp phả hệ
      // đã xác nhận của lần trước hết hiệu lực. CHỈ xóa cho lệnh claude: xóa cho mọi lệnh vặt
      // (`ls`, `git status`) mở lại cổng đọc bảng tiến trình mà chẳng thêm khả năng phát hiện
      // nào — claude mới khởi động luôn có pid mới, tự kích điều kiện "session chưa ai nhận".
      this.daTraKhongThayClaude.delete(key);
      this.phaHeDaXacNhan.delete(key);
    }
    if (!nenBatLenh(entry.kind, boQuaBat, lenh)) return;

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
    this.dangChayLenh.delete(key);
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

    let gia = khiKetThucLenh(p, Date.now(), undefined, event.exitCode);
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
    const marker = managedTerminalId(terminal);
    if (
      marker !== undefined &&
      this.store.workspaces.some((candidate) => candidate.terminals.some((entry) => entry.id === marker))
    ) {
      // Terminal vẫn mang marker của entry còn tồn tại ở workspace khác. Tạo alias id mới sẽ
      // khiến lần Reload sau không entry nào có thể nối đúng và có thể đóng nhầm terminal đó.
      return null;
    }
    const cwd = pickCwd(
      nonEmpty(terminal.shellIntegration?.cwd?.fsPath),
      creationCwd(terminal),
      folderCwd(),
    );
    // Không đoán cwd: entry không có cwd thì lần sau không mở lại đúng chỗ được.
    if (cwd === null) return null;

    // Schema bắt name >= 1 ký tự; terminal không tên sẽ làm hỏng file store khi ghi.
    const name = terminal.name.trim() === '' ? 'terminal' : terminal.name;
    // Remove-only giữ terminal sống cùng marker cũ. Nếu marker ấy đã mồ côi và vẫn là UUID hợp
    // lệ thì tái dùng nó, để terminal vừa thêm lại tiếp tục nối đúng qua các lần Reload sau.
    const id = marker !== undefined && ENTRY_ID_RE.test(marker) ? marker : randomUUID();
    const entry: TerminalEntry = { id, name, cwd, kind: 'plain' };
    upsertTerminal(ws, entry);
    this.terminals.adopt(entry.id, terminal);
    this.ghiNhanShellPid(entry.id);
    this.touch(ws.id);
    this.scheduleSave();
    this.onChanged.fire();
    return entry;
  }

  /**
   * Quên mọi trạng thái phụ gắn theo terminalId. Gọi ở CẢ hai đường terminal rời khỏi tầm
   * quản lý: đóng thật (`onClosed`) và gỡ khỏi workspace (`terminals.release`, không phát
   * sự kiện đóng nào) — nếu không các Map/Set này chỉ phình tới hết phiên.
   */
  private quenTerminal(terminalId: string): void {
    this.shellPids.delete(terminalId);
    this.dangChayLenh.delete(terminalId);
    this.daTraKhongThayClaude.delete(terminalId);
    this.phaHeDaXacNhan.delete(terminalId);
    this.pendingCommands.delete(terminalId);
    this.loadingIds.delete(terminalId);
    this.statuses.delete(terminalId);
    this.errorIds.delete(terminalId);
  }

  /** Trả startCommand về giá trị trước khi lệnh đang dở chiếm chỗ (lệnh không bao giờ kết thúc). */
  private hoanNguyenLenhDangCho(terminalId: string, p: LenhDangCho): void {
    const ws = this.timWorkspaceChuaTerminal(terminalId);
    const entry = ws?.terminals.find((t) => t.id === terminalId);
    if (!ws || !entry || entry.kind !== 'plain') return;
    const gia = khiKetThucLenh(p, Date.now());
    if (gia === entry.startCommand) return;
    if (gia === undefined) delete entry.startCommand;
    else entry.startCommand = gia;
    this.touch(ws.id);
    this.scheduleSave();
  }

  private onShellIntegrationChanged(event: vscode.TerminalShellIntegrationChangeEvent): void {
    const key = this.terminals.ownsTerminal(event.terminal);
    if (key === null) return;
    // Terminal của workspace CHƯA active cũng được track (lệnh tạo terminal chạy được trên
    // workspace inactive). Tra theo terminal thay vì theo activeId, nếu không entry của
    // workspace đó giữ mãi cwd cũ và lần khôi phục sau mở sai chỗ.
    const ws = this.timWorkspaceChuaTerminal(key);
    if (!ws) return;
    const entry = ws.terminals.find((t) => t.id === key);
    if (!entry) return;
    const cwd = nonEmpty(event.shellIntegration.cwd?.fsPath) ?? entry.cwd;
    if (cwd === entry.cwd) return;
    entry.cwd = cwd;
    this.touch(ws.id);
    this.scheduleSave();
  }

  async addOpenTerminal(terminal: vscode.Terminal | undefined): Promise<void> {
    // Menu chuột phải tab terminal không đảm bảo truyền đúng một `vscode.Terminal`
    // (có bản VS Code truyền context object khác). Nhận tham số chỉ khi nó thực sự là
    // terminal đang sống — nếu không, entry sẽ có name/cwd undefined và làm hỏng store.
    const known = terminal !== undefined && vscode.window.terminals.includes(terminal);
    let target = known ? terminal : undefined;
    if (target === undefined) {
      // Menu chuột phải TAB TERMINAL trong khu editor không truyền `vscode.Terminal` nào cả.
      // Đoán bằng `activeTerminal` là gắn nhầm cái đang focus khi người dùng bấm vào tab khác
      // — thà hỏi. Chỉ còn một terminal mồ côi thì khỏi hỏi cho nhanh.
      const moCoi = vscode.window.terminals.filter((t) => this.terminals.ownsTerminal(t) === null);
      if (moCoi.length === 0) {
        void vscode.window.showInformationMessage(
          'Mọi terminal đang mở đều đã thuộc một workspace.',
        );
        return;
      }
      if (moCoi.length === 1) target = moCoi[0];
      else {
        const dangFocus = vscode.window.activeTerminal;
        // Cái đang focus lên đầu: gần như luôn là cái người dùng định thêm.
        const thuTu = [
          ...moCoi.filter((t) => t === dangFocus),
          ...moCoi.filter((t) => t !== dangFocus),
        ];
        const chon = await vscode.window.showQuickPick(
          thuTu.map((t) => ({
            label: t.name,
            description: t === dangFocus ? 'đang focus' : undefined,
            terminal: t,
          })),
          { placeHolder: 'Thêm terminal nào vào workspace?' },
        );
        if (!chon) return;
        target = chon.terminal;
      }
    }
    if (target === undefined || !vscode.window.terminals.includes(target)) {
      void vscode.window.showWarningMessage('Không có terminal nào đang mở để thêm.');
      return;
    }
    if (this.terminals.ownsTerminal(target) !== null) {
      void vscode.window.showInformationMessage('Terminal đã thuộc một workspace.');
      return;
    }

    let wsId = this.wsNhan();
    if (wsId === null) {
      wsId = await this.pickOrCreateWorkspaceId();
      if (wsId === null) return;
    }
    const ws = findWorkspace(this.store, wsId);
    if (!ws) return;

    const entry = this.adoptInto(ws, target);
    if (!entry) {
      void vscode.window.showWarningMessage(
        'Không thêm được terminal: chưa xác định được thư mục làm việc hoặc terminal vẫn thuộc một workspace khác.',
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
        // Tiêu đề tab KHÔNG phải lúc nào cũng do người dùng đặt: chương trình đang chạy có thể
        // tự ghi tiêu đề bằng escape sequence. Claude làm đúng thế — nó ghi "<ký hiệu trạng
        // thái> <tên phiên>" và đổi liên tục, còn ngay sau khi khôi phục (trước lúc claude kịp
        // ghi) tiêu đề là tên tiến trình "claude". Hút bừa vào entry là XÓA MẤT tên người dùng
        // đặt và ghi đĩa mỗi nhịp poll. Chỉ nhận tiêu đề khi terminal đang ở dấu nhắc (không
        // có lệnh nào chạy) và không phải terminal agent.
        if (this.laEntryAgent(entry) || this.dangChayLenh.has(entry.id)) continue;
        // Không có Shell Integration thì ta KHÔNG biết có lệnh nào đang chạy hay không, tức
        // không phân biệt được "người dùng rename" với "chương trình tự ghi tiêu đề". Thà
        // không đồng bộ tên còn hơn ghi đè tên người dùng đã đặt.
        if (terminal.shellIntegration === undefined) continue;
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
  private async finalClaimSweep(workspaceId: string): Promise<void> {
    const ws = findWorkspace(this.store, workspaceId);
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

  /**
   * "Rảnh" của registry gộp hai chuyện khác hẳn nhau: đã xong việc, và đang dừng giữa chừng
   * chờ người dùng bấm. Soi transcript để tách ra — nhưng chỉ khi thật sự cần:
   *  - chỉ với terminal đang MỞ (đóng rồi thì nhãn không ai nhìn),
   *  - có cache theo mtime: lúc đang chờ, file không thay đổi nên chỉ đọc đúng một lần.
   */
  private dangChoTraLoi(session: RunningSession): boolean {
    if (session.cwd === '') return false;
    const duongDan = duongDanTranscript(claudeHomeMacDinh(), session.cwd, session.sessionId, path.sep);
    let mtime: number;
    try {
      mtime = nodeFs.statSync(duongDan).mtimeMs;
    } catch {
      return false; // không có transcript (phiên vừa tạo, home khác) — không kết luận gì
    }
    const cache = this.choTraLoiCache.get(session.sessionId);
    if (cache && cache.mtime === mtime && cache.idle === (session.status === 'idle')) {
      return cache.cho;
    }
    let cho = false;
    try {
      const fd = nodeFs.openSync(duongDan, 'r');
      try {
        const co = nodeFs.fstatSync(fd).size;
        const doDai = Math.min(co, DUOI_TRANSCRIPT_BYTE);
        const buf = Buffer.alloc(doDai);
        nodeFs.readSync(fd, buf, 0, doDai, co - doDai);
        cho = dangChoNguoiDung(buf.toString('utf8'), session.status === 'idle');
      } finally {
        nodeFs.closeSync(fd);
      }
    } catch {
      cho = false;
    }
    this.choTraLoiCache.set(session.sessionId, { mtime, idle: session.status === 'idle', cho });
    return cho;
  }

  private syncStatuses(bySession: Map<string, RunningSession>): boolean {
    let changed = false;
    for (const ws of this.store.workspaces) {
      for (const entry of ws.terminals) {
        const session = entry.claudeSessionId ? bySession.get(entry.claudeSessionId) : undefined;
        const before = this.statuses.get(entry.id);
        if (session) {
          // Chỉ soi khi registry nói `idle`: phiên đang bận ghi transcript liên tục nên đọc
          // mỗi nhịp là phí, mà quan sát thực tế thì lúc Claude hỏi, tiến trình luôn ở `idle`
          // (nó dừng hẳn chờ người dùng).
          const trangThai =
            session.status === 'idle' &&
            this.terminals.has(entry.id) &&
            this.dangChoTraLoi(session)
              ? 'blocked'
              : session.status;
          if (before !== trangThai) {
            this.statuses.set(entry.id, trangThai);
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
    // GIỮ NGUYÊN startCommand. Nhánh claude khi khôi phục không dùng tới nó, nhưng xóa đi là
    // mất VĨNH VIỄN lệnh mà auto-capture đã học: không có lệnh nào hạ entry claude về plain
    // để đặt lại, còn menu "Đặt lệnh khởi động" chỉ hiện cho aiTerminalPlain. Người dùng gõ
    // `claude` một lần trong terminal vốn chạy dev server không đáng phải mất lệnh đó.
    // (Nó bị loại khỏi vân tay trust vì `lenhCanTinCay` chỉ lấy entry kind 'plain'.)
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
    const entryDau = this.findEntry(workspaceId, terminalId);
    if (!entryDau) return;
    // Terminal thường mà người dùng tự gõ `codex` cũng đi nhánh Codex — cùng vị từ với nhãn
    // hiển thị trong cây, không để hai nơi nhận diện lệch nhau.
    if (this.agentCuaEntry(entryDau) === 'codex') {
      return await this.ganSessionCodex(workspaceId, terminalId);
    }

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

  /**
   * Gắn tay một phiên Codex vào terminal. Codex không có registry phiên đang chạy, nên danh
   * sách lấy từ các file rollout gần đây; phiên của ĐÚNG thư mục này được đẩy lên đầu.
   */
  private async ganSessionCodex(workspaceId: string, terminalId: string): Promise<void> {
    const entry = this.findEntry(workspaceId, terminalId);
    if (!entry) return;
    const ganDay = this.codex.lietKeGanDay();
    if (ganDay.length === 0) {
      void vscode.window.showInformationMessage(
        'Không thấy phiên Codex nào gần đây trong ~/.codex/sessions.',
      );
      return;
    }
    const cungThuMuc = (p: string) => normalizeCwd(p) === normalizeCwd(entry.cwd);
    const sapXep = [...ganDay].sort(
      (a, b) => Number(cungThuMuc(b.cwd)) - Number(cungThuMuc(a.cwd)),
    );
    const daCoChu = this.sessionCodexDaCoChu(terminalId);
    const picked = await vscode.window.showQuickPick(
      sapXep.map((s) => ({
        label: new Date(s.luc).toLocaleString('vi-VN'),
        description: [
          cungThuMuc(s.cwd) ? '✓ cùng thư mục' : s.cwd,
          daCoChu.has(s.sessionId) ? '— đang gắn ở terminal khác, chọn để CHUYỂN về đây' : '',
        ]
          .filter((x) => x !== '')
          .join(' '),
        detail: s.sessionId,
        phien: s,
      })),
      { placeHolder: 'Phiên Codex nào thuộc terminal này? (phiên cùng thư mục xếp trước)' },
    );
    if (!picked) return;

    // ganSessionCodexVaoEntry tự tra lại entry và tự gỡ id khỏi entry khác (bất biến
    // re-resolve-rồi-touch + một-hội-thoại-một-entry).
    if (this.ganSessionCodexVaoEntry(workspaceId, terminalId, picked.phien.sessionId)) {
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
    for (const id of this.activeIds) {
      const ws = findWorkspace(this.store, id);
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
