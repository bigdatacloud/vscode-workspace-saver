import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  window: {
    terminals: [] as unknown[],
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
  },
  commands: { executeCommand: vi.fn() },
  TerminalLocation: { Panel: 1, Editor: 2 },
  Disposable: class {
    constructor(private readonly callback: () => void = () => {}) {}
    dispose(): void { this.callback(); }
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
import type { TerminalManager } from '../../src/terminal/manager';
import { MANAGED_TERMINAL_ID_ENV } from '../../src/terminal/manager';
import { WorkspaceManager } from '../../src/workspace/manager';

const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

function codexEntry(id: string): TerminalEntry {
  return {
    id,
    name: 'repo',
    cwd: String.raw`D:\repo`,
    kind: 'plain',
    agentId: 'codex',
    startCommand: 'codex --yolo',
  };
}

function fakeTerminal(
  name = 'repo',
  cwd = String.raw`D:\repo`,
  managedId?: string,
  pid?: number,
): vscode.Terminal {
  return {
    name,
    creationOptions: {
      name,
      cwd,
      env: managedId === undefined ? undefined : { [MANAGED_TERMINAL_ID_ENV]: managedId },
    },
    shellIntegration: { cwd: { fsPath: cwd } },
    processId: Promise.resolve(pid),
    dispose: vi.fn(),
  } as unknown as vscode.Terminal;
}

interface ManagerHarness {
  store: StoreFile;
  terminals: Pick<TerminalManager, 'adopt' | 'get' | 'has' | 'ownsTerminal' | 'release'>;
  agent: { listRunning(): Promise<RunningSession[]> };
  phienTrongTerminalThua: Map<vscode.Terminal, string[]>;
  layBangTienTrinh(pids: number[], fresh?: boolean): Promise<Map<number, number>>;
  ghiNhanShellPid(id: string): void;
  quenTerminal(id: string): void;
  touch(id: string): void;
  scheduleSave(): void;
  onChanged: { fire(): void };
  noiLaiTerminalHoiSinh(ws: Workspace): Promise<{ ids: string[]; boQua: string[] }>;
  adoptInto(ws: Workspace, terminal: vscode.Terminal): TerminalEntry | null;
  removeTerminal(workspaceId: string, terminalId: string): Promise<void>;
}

function bareManager(store: StoreFile, terminals: ManagerHarness['terminals']): ManagerHarness {
  const manager = Object.create(WorkspaceManager.prototype) as ManagerHarness;
  Object.assign(manager, {
    store,
    terminals,
    agent: { listRunning: async () => [] },
    phienTrongTerminalThua: new Map(),
    statuses: new Map(),
    touchedIds: new Set(),
    layBangTienTrinh: vi.fn(async () => new Map()),
    ghiNhanShellPid: vi.fn(),
    quenTerminal: vi.fn(),
    touch: vi.fn(),
    scheduleSave: vi.fn(),
    onChanged: { fire: vi.fn() },
  });
  return manager;
}

describe('WorkspaceManager — terminal hồi sinh', () => {
  beforeEach(() => {
    vscodeMock.window.terminals = [];
    vscodeMock.window.showWarningMessage.mockReset();
  });

  it('nhận đúng từng Codex trùng tên/cwd qua terminal ID, không phụ thuộc thứ tự tab', async () => {
    const entries = [codexEntry(U('1')), codexEntry(U('2'))];
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: entries,
    };
    const live = [
      fakeTerminal('⠏ repo', String.raw`D:\repo`, entries[1]!.id),
      fakeTerminal('⠋ repo', String.raw`D:\repo`, entries[0]!.id),
    ];
    vscodeMock.window.terminals = live;
    const owned = new Map<vscode.Terminal, string>();
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn((id, terminal) => { owned.set(terminal, id); }),
      get: vi.fn((id) => [...owned].find(([, key]) => key === id)?.[0]),
      has: vi.fn((id) => [...owned.values()].includes(id)),
      ownsTerminal: vi.fn((terminal) => owned.get(terminal) ?? null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    const result = await manager.noiLaiTerminalHoiSinh(ws);

    expect(result.ids).toEqual([entries[0]!.id, entries[1]!.id]);
    expect(terminals.adopt).toHaveBeenNthCalledWith(1, entries[0]!.id, live[1]);
    expect(terminals.adopt).toHaveBeenNthCalledWith(2, entries[1]!.id, live[0]);
    expect(terminals.has(entries[0]!.id)).toBe(true);
    expect(terminals.has(entries[1]!.id)).toBe(true);
  });

  it('nhiều Codex cũ chỉ trùng tên/cwd thì giữ nguyên nhưng không nhận nuôi đoán', async () => {
    const entries = [codexEntry(U('1')), codexEntry(U('2'))];
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: entries,
    };
    vscodeMock.window.terminals = [fakeTerminal('⠏ repo'), fakeTerminal('⠋ repo')];
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    const result = await manager.noiLaiTerminalHoiSinh(ws);

    expect(result.ids).toEqual([]);
    expect(result.boQua).toEqual([entries[0]!.id, entries[1]!.id]);
    expect(terminals.adopt).not.toHaveBeenCalled();
  });

  it('marker của entry khác là bằng chứng ngược: không fallback nhận theo tên/cwd', async () => {
    const entryA = codexEntry(U('1'));
    const entryB = codexEntry(U('2'));
    const wsA: Workspace = {
      id: U('3'), name: 'A', lastActiveAt: null, activeWindowId: null, terminals: [entryA],
    };
    const wsB: Workspace = {
      id: U('4'), name: 'B', lastActiveAt: null, activeWindowId: null, terminals: [entryB],
    };
    vscodeMock.window.terminals = [fakeTerminal('repo', String.raw`D:\repo`, entryB.id)];
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [wsA, wsB] }, terminals);

    const result = await manager.noiLaiTerminalHoiSinh(wsA);

    expect(result.ids).toEqual([]);
    expect(result.boQua).toEqual([]);
    expect(terminals.adopt).not.toHaveBeenCalled();
  });

  it('marker entry khác cũng thắng bằng chứng phả hệ Claude ở phase thấp hơn', async () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const entryA: TerminalEntry = {
      id: U('1'), name: 'claude-a', cwd: String.raw`D:\repo`, kind: 'claude', claudeSessionId: sessionId,
    };
    const entryB = codexEntry(U('2'));
    const wsA: Workspace = {
      id: U('3'), name: 'A', lastActiveAt: null, activeWindowId: null, terminals: [entryA],
    };
    const wsB: Workspace = {
      id: U('4'), name: 'B', lastActiveAt: null, activeWindowId: null, terminals: [entryB],
    };
    const live = fakeTerminal('claude-a', String.raw`D:\repo`, entryB.id, 500);
    vscodeMock.window.terminals = [live];
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [wsA, wsB] }, terminals);
    manager.agent = {
      listRunning: async () => [{
        sessionId, name: 'claude-a', cwd: entryA.cwd, pid: 600,
        kind: 'interactive', status: 'idle',
      }],
    };
    manager.layBangTienTrinh = vi.fn(async () => new Map([[600, 500]]));

    const result = await manager.noiLaiTerminalHoiSinh(wsA);

    expect(result.ids).toEqual([]);
    expect(terminals.adopt).not.toHaveBeenCalled();
  });

  it('terminal remove-only rồi thêm lại tái dùng marker UUID đã mồ côi', () => {
    const oldId = '11111111-1111-4111-8111-111111111111';
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: [],
    };
    const live = fakeTerminal('repo', String.raw`D:\repo`, oldId);
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    const entry = manager.adoptInto(ws, live);

    expect(entry?.id).toBe(oldId);
    expect(terminals.adopt).toHaveBeenCalledWith(oldId, live);
  });

  it('nhóm Codex lệch số tab sống thì đánh dấu bỏ qua thay vì đoán rồi resume chồng', async () => {
    const entries = [codexEntry(U('1')), codexEntry(U('2'))];
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: entries,
    };
    vscodeMock.window.terminals = [fakeTerminal()];
    const owned = new Map<vscode.Terminal, string>();
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn((id, terminal) => { owned.set(terminal, id); }),
      get: vi.fn((id) => [...owned].find(([, key]) => key === id)?.[0]),
      has: vi.fn((id) => [...owned.values()].includes(id)),
      ownsTerminal: vi.fn((terminal) => owned.get(terminal) ?? null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    const result = await manager.noiLaiTerminalHoiSinh(ws);

    expect(result.ids).toEqual([]);
    expect(result.boQua).toEqual([entries[0]!.id, entries[1]!.id]);
    expect(terminals.adopt).not.toHaveBeenCalled();
  });

  it('xóa trước activate vẫn nhận ra tab sống, hỏi và đóng terminal khi được chọn', async () => {
    const entry = codexEntry(U('1'));
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: [entry],
    };
    const live = fakeTerminal();
    vscodeMock.window.terminals = [live];
    vscodeMock.window.showWarningMessage.mockResolvedValue('Bỏ và đóng terminal');
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    await manager.removeTerminal(ws.id, entry.id);

    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(live.dispose).toHaveBeenCalledOnce();
    expect(ws.terminals).toEqual([]);
    expect(terminals.release).toHaveBeenCalledWith(entry.id);
  });

  it('hủy modal xóa giữ nguyên cả entry lẫn terminal hồi sinh', async () => {
    const entry = codexEntry(U('1'));
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: [entry],
    };
    const live = fakeTerminal();
    vscodeMock.window.terminals = [live];
    vscodeMock.window.showWarningMessage.mockResolvedValue(undefined);
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    await manager.removeTerminal(ws.id, entry.id);

    expect(live.dispose).not.toHaveBeenCalled();
    expect(ws.terminals).toEqual([entry]);
    expect(terminals.release).not.toHaveBeenCalled();
  });

  it('nhiều tab hồi sinh cùng khớp thì cảnh báo mơ hồ, không đóng đoán một tab', async () => {
    const entry = codexEntry(U('1'));
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: [entry],
    };
    const live = [fakeTerminal(), fakeTerminal()];
    vscodeMock.window.terminals = live;
    vscodeMock.window.showWarningMessage.mockResolvedValue(undefined);
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    await manager.removeTerminal(ws.id, entry.id);

    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(vscodeMock.window.showWarningMessage.mock.calls[0]?.[0]).toContain('2 terminal');
    expect(live[0]!.dispose).not.toHaveBeenCalled();
    expect(live[1]!.dispose).not.toHaveBeenCalled();
    expect(ws.terminals).toEqual([entry]);
  });

  it('mất tính duy nhất trong lúc modal mở thì hủy cả thao tác, không âm thầm đổi thành remove-only', async () => {
    const entry = codexEntry(U('1'));
    const ws: Workspace = {
      id: U('3'), name: 'W', lastActiveAt: null, activeWindowId: null, terminals: [entry],
    };
    const first = fakeTerminal();
    const second = fakeTerminal();
    vscodeMock.window.terminals = [first];
    vscodeMock.window.showWarningMessage.mockImplementationOnce(async () => {
      vscodeMock.window.terminals.push(second);
      return 'Bỏ và đóng terminal';
    });
    const terminals: ManagerHarness['terminals'] = {
      adopt: vi.fn(),
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      ownsTerminal: vi.fn(() => null),
      release: vi.fn(),
    };
    const manager = bareManager({ version: 2, workspaces: [ws] }, terminals);

    await manager.removeTerminal(ws.id, entry.id);

    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(ws.terminals).toEqual([entry]);
    expect(terminals.release).not.toHaveBeenCalled();
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledTimes(2);
  });
});
