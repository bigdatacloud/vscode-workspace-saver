import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  window: {
    terminals: [] as unknown[],
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showInputBox: vi.fn(),
  },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
  commands: { executeCommand: vi.fn() },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('vscode', () => vscodeMock);

import type { Role, StoreFile, TerminalEntry, Workspace } from '../../src/model/schema';
import { WorkspaceManager } from '../../src/workspace/manager';

const U = (n: string) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

/** Id dễ đọc trong assertion: terminal "a" của ws nguồn là U('a')… */
const T = (ten: string): TerminalEntry => ({
  id: U(ten),
  name: `term-${ten}`,
  cwd: String.raw`D:\repo`,
  kind: 'plain',
});

const ws = (id: string, ten: string, terminals: TerminalEntry[], roles?: Role[]): Workspace => ({
  id: U(id),
  name: ten,
  lastActiveAt: null,
  activeWindowId: null,
  terminals,
  ...(roles === undefined ? {} : { roles }),
});

/** Tên các terminal của một workspace, theo đúng thứ tự trong cây. */
const thuTu = (store: StoreFile, wsId: string): string =>
  (store.workspaces.find((w) => w.id === U(wsId))?.terminals ?? []).map((t) => t.name).join(' ');

interface Harness {
  store: StoreFile;
  thaTerminal(idKeo: readonly string[], wsDichId: string, idDich: string | null): Promise<void>;
}

/**
 * Manager trần: chỉ đủ field cho `thaTerminal` chạy thật. Những chỗ đụng đĩa (khoá vai,
 * lưu file) bị thay bằng vi.fn — việc cần kiểm là THỨ TỰ và VAI sau khi thả, không phải I/O.
 */
function bareManager(store: StoreFile): Harness {
  const manager = Object.create(WorkspaceManager.prototype) as Harness;
  Object.assign(manager, {
    store,
    terminals: { has: () => false },
    vaiDaDoi: new Set<string>(),
    dirty: false,
    dirtyIds: new Set<string>(),
    saveTimer: null,
    goKhoiVai: vi.fn(),
    ghiKhoiVaiChoEntry: vi.fn(),
    touch: vi.fn(),
    scheduleSave: vi.fn(),
    flush: vi.fn(),
    onChanged: { fire: vi.fn() },
  });
  return manager;
}

describe('thaTerminal — kéo thả trong cùng workspace', () => {
  beforeEach(() => {
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.window.showInformationMessage.mockReset();
  });

  it('chèn TRƯỚC terminal đích', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a'), T('b'), T('c')])] };
    const manager = bareManager(store);

    await manager.thaTerminal([U('c')], U('1'), U('b'));

    expect(thuTu(store, '1')).toBe('term-a term-c term-b');
  });

  it('thả lên dòng workspace (đích null) thì xuống cuối', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a'), T('b'), T('c')])] };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('1'), null);

    expect(thuTu(store, '1')).toBe('term-b term-c term-a');
  });

  it('sắp xếp lại trong cùng workspace KHÔNG báo "đã chuyển" — có chuyển đi đâu đâu', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a'), T('b')])] };
    const manager = bareManager(store);

    await manager.thaTerminal([U('b')], U('1'), U('a'));

    expect(vscodeMock.window.showInformationMessage).not.toHaveBeenCalled();
  });
});

describe('thaTerminal — kéo sang workspace KHÁC, thả vào vị trí bất kỳ', () => {
  beforeEach(() => {
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.window.showInformationMessage.mockReset();
  });

  it('thả lên một terminal GIỮA danh sách ws đích thì chèn đúng chỗ đó, không rơi xuống cuối', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [ws('1', 'A', [T('a')]), ws('2', 'B', [T('x'), T('y'), T('z')])],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), U('y'));

    expect(thuTu(store, '2')).toBe('term-x term-a term-y term-z');
    expect(thuTu(store, '1')).toBe('');
  });

  it('kéo NHIỀU terminal sang ws khác: giữ nguyên thứ tự tương đối giữa chúng', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [ws('1', 'A', [T('a'), T('b'), T('c')]), ws('2', 'B', [T('x'), T('y')])],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a'), U('c')], U('2'), U('y'));

    expect(thuTu(store, '2')).toBe('term-x term-a term-c term-y');
    expect(thuTu(store, '1')).toBe('term-b');
  });

  it('thả lên dòng workspace đích thì xuống cuối workspace đó', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [ws('1', 'A', [T('a')]), ws('2', 'B', [T('x'), T('y')])],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), null);

    expect(thuTu(store, '2')).toBe('term-x term-y term-a');
  });

  it('báo cho người dùng biết đã chuyển mấy cái và sang đâu', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [ws('1', 'A', [T('a')]), ws('2', 'B', [])],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), null);

    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('"B"'),
    );
  });

  it('workspace đích không tồn tại → không làm gì, không mất terminal', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a')])] };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('9'), null);

    expect(thuTu(store, '1')).toBe('term-a');
  });
});

describe('thaTerminal — vai khi sang workspace khác', () => {
  const vai = (id: string, name: string, kind: Role['kind'] = 'worker'): Role => ({ id: U(id), name, kind });

  beforeEach(() => {
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.window.showInformationMessage.mockReset();
  });

  it('ws đích có vai CÙNG TÊN thì giữ vai (id vai đổi sang id của ws đích)', async () => {
    const entry: TerminalEntry = { ...T('a'), roleId: U('5') };
    const store: StoreFile = {
      version: 2,
      workspaces: [
        ws('1', 'A', [entry], [vai('5', 'reviewer')]),
        ws('2', 'B', [T('x')], [vai('6', 'reviewer')]),
      ],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), U('x'));

    const moi = store.workspaces[1]?.terminals.find((t) => t.id === U('a'));
    expect(moi?.roleId).toBe(U('6'));
    expect(vscodeMock.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('ws đích KHÔNG có vai cùng tên thì bỏ vai và nói rõ lý do', async () => {
    const entry: TerminalEntry = { ...T('a'), roleId: U('5') };
    const store: StoreFile = {
      version: 2,
      workspaces: [ws('1', 'A', [entry], [vai('5', 'reviewer')]), ws('2', 'B', [])],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), null);

    expect(store.workspaces[1]?.terminals[0]?.roleId).toBeUndefined();
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('reviewer'),
    );
  });

  it('ws đích đã có người điều phối thì vai điều phối bị bỏ — kéo thả không lách được luật một-sếp', async () => {
    const keo: TerminalEntry = { ...T('a'), roleId: U('5') };
    const sepCu: TerminalEntry = { ...T('x'), roleId: U('6') };
    const store: StoreFile = {
      version: 2,
      workspaces: [
        ws('1', 'A', [keo], [vai('5', 'lead', 'orchestrator')]),
        ws('2', 'B', [sepCu], [vai('6', 'lead', 'orchestrator')]),
      ],
    };
    const manager = bareManager(store);

    await manager.thaTerminal([U('a')], U('2'), U('x'));

    const moi = store.workspaces[1]?.terminals.find((t) => t.id === U('a'));
    expect(moi?.roleId).toBeUndefined();
    expect(vscodeMock.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('điều phối'),
    );
  });
});

interface HarnessThuTu extends Harness {
  thaWorkspace(idKeo: readonly string[], idDich: string | null): Promise<void>;
  doiChoWorkspace(id: string, huong: 'len' | 'xuong'): Promise<void>;
  boGhimThuTu(): Promise<void>;
  doiChoTerminal(workspaceId: string, terminalId: string, huong: 'len' | 'xuong'): Promise<void>;
  workspaceViews(): { id: string; daGhim?: boolean }[];
}

function managerThuTu(store: StoreFile): HarnessThuTu {
  const manager = bareManager(store) as HarnessThuTu;
  Object.assign(manager, { wsNhan: () => null, laDangMo: () => false });
  return manager;
}

/** Tên các workspace theo đúng thứ tự cây vẽ ra. */
const cayWs = (manager: HarnessThuTu, store: StoreFile): string =>
  manager
    .workspaceViews()
    .map((v) => store.workspaces.find((w) => w.id === v.id)?.name ?? '?')
    .join(' ');

describe('thứ tự workspace trong cây', () => {
  const W = (id: string, ten: string, lastActiveAt: string | null = null, order?: number): Workspace => ({
    ...ws(id, ten, []),
    lastActiveAt,
    ...(order === undefined ? {} : { order }),
  });

  it('chưa ai kéo thì vẫn tự sắp theo lần kích hoạt gần nhất như trước', () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [W('1', 'cu', '2026-01-01T00:00:00Z'), W('2', 'moi', '2026-10-16T00:00:00Z')],
    };
    const manager = managerThuTu(store);

    expect(cayWs(manager, store)).toBe('moi cu');
  });

  it('kéo một workspace lên trên thì nó ở yên đó, kể cả khi cái khác vừa được kích hoạt', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [W('1', 'a', '2026-01-01T00:00:00Z'), W('2', 'b', '2026-10-16T00:00:00Z')],
    };
    const manager = managerThuTu(store);

    await manager.thaWorkspace([U('1')], U('2'));

    expect(cayWs(manager, store)).toBe('a b');
    // "b" vừa được dùng gần nhất mà vẫn nằm dưới → thứ tự tay đã thắng thứ tự tự động.
    expect(store.workspaces.find((w) => w.id === U('1'))?.order).toBe(0);
  });

  it('chỉ ghim tới chỗ vừa thả — phần dưới vẫn tự sắp', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [
        W('1', 'a', '2026-10-03T00:00:00Z'),
        W('2', 'b', '2026-10-02T00:00:00Z'),
        W('3', 'c', '2026-10-01T00:00:00Z'),
      ],
    };
    const manager = managerThuTu(store);

    await manager.thaWorkspace([U('3')], U('2')); // c lên trước b

    expect(cayWs(manager, store)).toBe('a c b');
    expect(store.workspaces.find((w) => w.id === U('2'))?.order).toBeUndefined();
  });

  it('bỏ ghim thì mọi order biến mất và cây về lại thứ tự tự động', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [W('1', 'a', '2026-01-01T00:00:00Z', 0), W('2', 'b', '2026-10-16T00:00:00Z', 1)],
    };
    const manager = managerThuTu(store);

    await manager.boGhimThuTu();

    expect(store.workspaces.every((w) => w.order === undefined)).toBe(true);
    expect(cayWs(manager, store)).toBe('b a');
  });

  it('nút Lên đưa workspace lên một bậc và ghim nó lại', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [
        W('1', 'a', '2026-10-03T00:00:00Z'),
        W('2', 'b', '2026-10-02T00:00:00Z'),
        W('3', 'c', '2026-10-01T00:00:00Z'),
      ],
    };
    const manager = managerThuTu(store);

    await manager.doiChoWorkspace(U('3'), 'len');

    expect(cayWs(manager, store)).toBe('a c b');
  });

  it('bấm Lên ở workspace đầu danh sách thì không đổi gì, không ghim ai', async () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [W('1', 'a', '2026-10-03T00:00:00Z'), W('2', 'b', '2026-10-02T00:00:00Z')],
    };
    const manager = managerThuTu(store);

    await manager.doiChoWorkspace(U('1'), 'len');

    expect(cayWs(manager, store)).toBe('a b');
    expect(store.workspaces.every((w) => w.order === undefined)).toBe(true);
  });

  it('view báo cái nào đã ghim để cây hiện ra được', async () => {
    const store: StoreFile = { version: 2, workspaces: [W('1', 'a'), W('2', 'b')] };
    const manager = managerThuTu(store);

    await manager.thaWorkspace([U('2')], U('1'));

    const views = manager.workspaceViews();
    expect(views[0]?.daGhim).toBe(true);
    expect(views[1]?.daGhim).toBeUndefined();
  });
});

describe('nút Lên / Xuống cho terminal', () => {
  it('đưa terminal lên một bậc trong workspace của nó', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a'), T('b'), T('c')])] };
    const manager = managerThuTu(store);

    await manager.doiChoTerminal(U('1'), U('c'), 'len');

    expect(thuTu(store, '1')).toBe('term-a term-c term-b');
  });

  it('terminal cuối bấm Xuống thì giữ nguyên', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a'), T('b')])] };
    const manager = managerThuTu(store);

    await manager.doiChoTerminal(U('1'), U('b'), 'xuong');

    expect(thuTu(store, '1')).toBe('term-a term-b');
  });

  it('workspace không tồn tại thì không ném', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a')])] };
    const manager = managerThuTu(store);

    await expect(manager.doiChoTerminal(U('9'), U('a'), 'len')).resolves.toBeUndefined();
  });
});

interface HarnessDoiTen {
  store: StoreFile;
  renameTerminal(workspaceId: string, terminalId: string): Promise<void>;
}

describe('đổi tên terminal — đồng bộ sang tên phiên Claude', () => {
  const CLAUDE = (id: string): TerminalEntry => ({
    ...T(id),
    kind: 'claude',
    claudeSessionId: U('7'),
    claudeName: 'ten-cu',
  });

  /** Manager trần + terminal giả để xem extension gõ gì vào phiên. */
  function managerDoiTen(store: StoreFile, dangMo: boolean) {
    const daGui: string[] = [];
    const terminal = {
      show: vi.fn(),
      sendText: vi.fn((t: string) => { daGui.push(t); }),
    };
    const manager = Object.create(WorkspaceManager.prototype) as HarnessDoiTen;
    Object.assign(manager, {
      store,
      terminals: { get: () => (dangMo ? terminal : undefined), has: () => dangMo },
      touch: vi.fn(),
      scheduleSave: vi.fn(),
      flush: vi.fn(),
      onChanged: { fire: vi.fn() },
      ghiKiemToan: vi.fn(),
    });
    return { manager, daGui };
  }

  beforeEach(() => {
    vscodeMock.window.showInformationMessage.mockReset();
    vscodeMock.window.showWarningMessage.mockReset();
    vscodeMock.commands.executeCommand.mockReset();
    vscodeMock.window.showInputBox = vi.fn(async () => 'ten-moi');
  });

  it('terminal Claude ĐANG MỞ: gõ /rename vào phiên để app mobile thấy tên mới', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [CLAUDE('a')])] };
    const { manager, daGui } = managerDoiTen(store, true);

    await manager.renameTerminal(U('1'), U('a'));

    expect(daGui).toContain('/rename ten-moi');
  });

  it('cập nhật luôn claudeName để lần khởi chạy sau dùng -n đúng tên', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [CLAUDE('a')])] };
    const { manager } = managerDoiTen(store, true);

    await manager.renameTerminal(U('1'), U('a'));

    const entry = store.workspaces[0]?.terminals[0];
    expect(entry?.name).toBe('ten-moi');
    expect(entry?.claudeName).toBe('ten-moi');
  });

  it('terminal Claude ĐANG ĐÓNG: không gõ gì, nhưng claudeName vẫn đổi cho lần chạy sau', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [CLAUDE('a')])] };
    const { manager, daGui } = managerDoiTen(store, false);

    await manager.renameTerminal(U('1'), U('a'));

    expect(daGui).toEqual([]);
    expect(store.workspaces[0]?.terminals[0]?.claudeName).toBe('ten-moi');
  });

  it('terminal shell thường: không gõ /rename — nó sẽ chạy như một lệnh shell không tồn tại', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [T('a')])] };
    const { manager, daGui } = managerDoiTen(store, true);

    await manager.renameTerminal(U('1'), U('a'));

    expect(daGui).toEqual([]);
    expect(store.workspaces[0]?.terminals[0]?.claudeName).toBeUndefined();
  });

  it('huỷ hộp nhập thì không đổi gì cả', async () => {
    const store: StoreFile = { version: 2, workspaces: [ws('1', 'A', [CLAUDE('a')])] };
    const { manager, daGui } = managerDoiTen(store, true);
    vscodeMock.window.showInputBox = vi.fn(async () => undefined);

    await manager.renameTerminal(U('1'), U('a'));

    expect(store.workspaces[0]?.terminals[0]?.name).toBe('term-a');
    expect(store.workspaces[0]?.terminals[0]?.claudeName).toBe('ten-cu');
    expect(daGui).toEqual([]);
  });
});
