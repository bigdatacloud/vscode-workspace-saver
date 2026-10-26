import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  window: {
    terminals: [] as unknown[],
    activeTerminal: undefined as unknown,
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({ get: vi.fn((_k: string, d?: unknown) => d) })),
  },
  commands: { executeCommand: vi.fn() },
  TerminalLocation: { Panel: 1, Editor: 2 },
  Disposable: class {
    constructor(private readonly callback: () => void = () => {}) {}
    dispose(): void {
      this.callback();
    }
  },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('vscode', () => vscodeMock);

import type * as vscode from 'vscode';
import type { RunningSession } from '../../src/agent/types';
import type { StoreFile, TerminalEntry, Workspace } from '../../src/model/schema';
import { WorkspaceManager } from '../../src/workspace/manager';

const U = (n: string) =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

const ID = U('1');
const WS = U('2');
const PHIEN = U('3');

function entryClaude(): TerminalEntry {
  return { id: ID, name: 'repo', cwd: String.raw`D:\repo`, kind: 'claude', claudeSessionId: PHIEN };
}

function phien(status: RunningSession['status']): RunningSession {
  return {
    sessionId: PHIEN,
    name: 'repo',
    pid: 1234,
    cwd: String.raw`D:\repo`,
    status,
    kind: 'interactive',
  };
}

/**
 * Dựng manager không qua constructor (hệt `workspace-manager.test.ts`) và gán đúng những
 * mảnh mà đường "vỏ trống" đụng tới.
 */
function dungManager(terminalSong: boolean) {
  const ws: Workspace = {
    id: WS,
    name: 'Working',
    lastActiveAt: null,
    activeWindowId: null,
    terminals: [entryClaude()],
  };
  const store: StoreFile = { version: 2, workspaces: [ws] };
  const nhatKy: string[] = [];
  const terminal = {
    dispose: vi.fn(() => nhatKy.push('dispose')),
  } as unknown as vscode.Terminal;
  const manager = Object.create(WorkspaceManager.prototype) as Record<string, unknown>;
  Object.assign(manager, {
    store,
    terminals: {
      has: vi.fn(() => terminalSong),
      get: vi.fn(() => (terminalSong ? terminal : undefined)),
      release: vi.fn(() => nhatKy.push('release')),
      ownsTerminal: vi.fn(() => null),
      adopt: vi.fn(),
    },
    statuses: new Map<string, string>(),
    loadingIds: new Set<string>(),
    errorIds: new Set<string>(),
    daThayPhien: new Set<string>(),
    vaiDaDoi: new Set<string>(),
    // `quenTerminal` dọn sạch mọi bảng phụ gắn theo terminalId — gán đủ để nó chạy thật,
    // không mock, vì thứ ca này đo chính là chuỗi release → dispose → activate.
    shellPids: new Map<string, number>(),
    dangChayLenh: new Set<string>(),
    daTraKhongThayClaude: new Set<string>(),
    phaHeDaXacNhan: new Map<string, string>(),
    pendingCommands: new Map<string, unknown>(),
    ketQuaWorker: new Map<string, unknown>(),
    cauHoiWorker: new Map<string, unknown>(),
    touch: vi.fn(),
    scheduleSave: vi.fn(),
    onChanged: { fire: vi.fn() },
    activate: vi.fn(async () => {
      nhatKy.push('activate');
    }),
    hienTheoId: vi.fn(async () => false),
    kenhLuoi: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn() })),
    // Phiên `busy` không đi qua nhánh đọc transcript, nhưng gán cho chắc: ca này đo trạng
    // thái, không đo cách phát hiện "đang chờ trả lời".
    dangChoTraLoi: vi.fn(() => false),
  });
  return { manager, ws, store, terminal, nhatKy };
}

function trangThai(manager: Record<string, unknown>, ws: Workspace): string {
  const f = manager['terminalState'] as (e: TerminalEntry) => string;
  return f.call(manager, ws.terminals[0]!);
}

function dongBo(manager: Record<string, unknown>, ds: RunningSession[]): void {
  const f = manager['syncStatuses'] as (m: Map<string, RunningSession>) => boolean;
  f.call(manager, new Map(ds.map((r) => [r.sessionId, r])));
}

describe('vỏ trống — phiên đã thoát nhưng terminal còn sống', () => {
  beforeEach(() => {
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.window.terminals = [];
  });

  it('sổ phiên THẤY phiên rồi MẤT nó: entry thành "vỏ trống", không còn là "đang mở"', () => {
    // Đây đúng là chuỗi người dùng đi ngày 26/10/2026: phiên chạy, rồi họ terminate nó, rồi
    // nhịp poll sau không còn thấy phiên — nhưng cái vỏ shell vẫn sống.
    const { manager, ws } = dungManager(true);

    dongBo(manager, [phien('busy')]);
    expect(trangThai(manager, ws)).toBe('busy');

    dongBo(manager, []);
    expect(trangThai(manager, ws)).toBe('voTrong');
  });

  it('CHƯA từng thấy phiên: giữ nguyên "đang mở" — terminal vừa mở không phải phiên đã chết', () => {
    const { manager, ws } = dungManager(true);
    dongBo(manager, []);
    expect(trangThai(manager, ws)).toBe('open');
  });

  it('terminal đã đóng hẳn: vẫn là "chưa mở", vỏ trống không được lấn sang ca đó', () => {
    const { manager, ws } = dungManager(false);
    dongBo(manager, [phien('busy')]);
    dongBo(manager, []);
    expect(trangThai(manager, ws)).toBe('closed');
  });

  it('bấm vào vỏ trống: HỎI mở lại, và chọn "Mở lại" thì đóng vỏ rồi kích hoạt đúng entry', async () => {
    const { manager, ws, terminal, nhatKy } = dungManager(true);
    dongBo(manager, [phien('busy')]);
    dongBo(manager, []);
    vscodeMock.window.showWarningMessage.mockResolvedValue('Mở lại');

    const focus = manager['focusTerminal'] as (w: string, t: string) => Promise<void>;
    await focus.call(manager, ws.id, ID);

    // Không được đi đường "đưa terminal ra trước mặt": thứ người dùng bấm vào là PHIÊN.
    expect(manager['hienTheoId']).not.toHaveBeenCalled();
    const loiNhan = String(vscodeMock.window.showWarningMessage.mock.calls[0]?.[0]);
    expect(loiNhan).toContain('đã thoát');
    expect(loiNhan).not.toContain('đang chạy');
    // Thứ tự release → dispose → activate là bắt buộc: `activate` chỉ mở entry mà sổ terminal
    // không còn giữ, mà `onDidCloseTerminal` thì bắn muộn vài trăm mili giây.
    const terminals = manager['terminals'] as { release: ReturnType<typeof vi.fn> };
    expect(terminals.release).toHaveBeenCalledWith(ID);
    expect(terminal.dispose).toHaveBeenCalled();
    expect(manager['activate']).toHaveBeenCalledWith(ws.id, ID);
    expect(nhatKy).toEqual(['release', 'dispose', 'activate']);
  });

  it('chờ vỏ rời hẳn danh sách terminal của VS Code rồi mới kích hoạt', async () => {
    // `dispose()` chỉ ra lệnh: đo 26/10/2026 thì terminal còn nằm trong `window.terminals`
    // thêm 0,4–3,3 giây. Kích hoạt ngay trong khoảng đó thì bước nối-lại khớp marker
    // `AI_WORKSPACE_TERMINAL_ID` trên chính cái xác và "nối lại" nó thay vì bật phiên mới.
    const { manager, ws, terminal } = dungManager(true);
    dongBo(manager, [phien('busy')]);
    dongBo(manager, []);
    vscodeMock.window.terminals = [terminal];
    vscodeMock.window.showWarningMessage.mockResolvedValue('Mở lại');
    (terminal.dispose as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      setTimeout(() => {
        vscodeMock.window.terminals = [];
      }, 200);
    });

    const batDau = Date.now();
    const focus = manager['focusTerminal'] as (w: string, t: string) => Promise<void>;
    await focus.call(manager, ws.id, ID);

    expect(manager['activate']).toHaveBeenCalledWith(ws.id, ID);
    expect(Date.now() - batDau).toBeGreaterThanOrEqual(190);
  });

  it('bấm vào vỏ trống rồi BỎ QUA hộp thoại: không đóng gì, không kích hoạt gì', async () => {
    const { manager, ws, terminal } = dungManager(true);
    dongBo(manager, [phien('busy')]);
    dongBo(manager, []);
    vscodeMock.window.showWarningMessage.mockResolvedValue(undefined);

    const focus = manager['focusTerminal'] as (w: string, t: string) => Promise<void>;
    await focus.call(manager, ws.id, ID);

    // Hỏi đúng câu "vỏ trống" chứ không rơi về câu "không đưa ra trước mặt được" — không có
    // mệnh đề này thì ca vẫn xanh cả khi nhận biết vỏ trống bị gỡ.
    expect(String(vscodeMock.window.showWarningMessage.mock.calls[0]?.[0])).toContain('đã thoát');
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(manager['activate']).not.toHaveBeenCalled();
  });
});
