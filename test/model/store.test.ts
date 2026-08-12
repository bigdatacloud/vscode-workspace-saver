import { describe, expect, it } from 'vitest';
import { StoreFileSchema, emptyStore, type StoreFile, type Workspace } from '../../src/model/schema';
import {
  createWorkspace, deleteShard, findWorkspace, gopShard, loadShards, loadStore, mergeForSave,
  migrateLegacy, removeTerminal, saveShard, saveStore, upsertTerminal,
  type StoreFs,
} from '../../src/model/store';

function memFs(init: Record<string, string> = {}) {
  const files = new Map(Object.entries(init));
  const ops: string[] = [];
  const fs: StoreFs = {
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeFile: (p, c) => { ops.push(`write:${p}`); files.set(p, c); },
    rename: (a, b) => {
      ops.push(`rename:${a}->${b}`);
      if (!files.has(a)) throw new Error(`ENOENT: ${a}`);
      files.set(b, files.get(a)!); files.delete(a);
    },
    list: (dir) => {
      const tien = `${dir}\\`;
      return [...files.keys()].filter((p) => p.startsWith(tien)).map((p) => p.slice(tien.length));
    },
    remove: (p) => { ops.push(`remove:${p}`); files.delete(p); },
    mkdirp: () => { /* thư mục là ảo trong bộ nhớ */ },
  };
  return { fs, files, ops };
}
const P = 'C:\\store\\workspaces.json';
const uuidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('loadStore', () => {
  it('file vắng mặt → store rỗng, không recovered', () => {
    const { fs } = memFs();
    expect(loadStore(fs, P, () => 1)).toEqual({ store: emptyStore(), recoveredFrom: null });
  });

  it('file hợp lệ → parse đúng', () => {
    const { fs } = memFs({ [P]: JSON.stringify(emptyStore()) });
    expect(loadStore(fs, P, () => 1).store).toEqual(emptyStore());
  });

  it('file hỏng → backup sang .bak-<epoch>, store rỗng, recoveredFrom trỏ backup', () => {
    const { fs, files } = memFs({ [P]: '{hỏng' });
    const r = loadStore(fs, P, () => 777);
    expect(r.store).toEqual(emptyStore());
    expect(r.recoveredFrom).toBe(`${P}.bak-777`);
    expect(files.get(`${P}.bak-777`)).toBe('{hỏng');
    expect(files.has(P)).toBe(false);
  });

  it('JSON hợp lệ nhưng sai schema (version 1) cũng bị backup', () => {
    const { fs } = memFs({ [P]: JSON.stringify({ version: 1, workspaces: [] }) });
    expect(loadStore(fs, P, () => 5).recoveredFrom).toBe(`${P}.bak-5`);
  });
});

describe('saveStore', () => {
  it('ghi qua temp rồi rename (atomic), nội dung parse lại được', () => {
    const { fs, files, ops } = memFs();
    saveStore(fs, P, emptyStore());
    expect(ops).toEqual([`write:${P}.tmp`, `rename:${P}.tmp->${P}`]);
    expect(JSON.parse(files.get(P)!)).toEqual(emptyStore());
  });

  // Store sai schema mà lọt xuống đĩa là mất dữ liệu thật: lần nạp sau loadStore parse hỏng
  // → backup + danh sách workspace rỗng. Chặn ngay tại cửa ghi, đừng tin caller.
  it('store sai schema thì ném lỗi và KHÔNG đụng vào đĩa', () => {
    const { fs, files, ops } = memFs();
    const store = emptyStore();
    const ws = createWorkspace(store, 'X', uuidA);
    upsertTerminal(ws, {
      id: uuidB, name: 'a', cwd: 'C:\\x', kind: 'claude', claudeName: '',
    });

    expect(() => saveStore(fs, P, store)).toThrow();
    expect(ops).toEqual([]);
    expect(files.size).toBe(0);
  });
});

describe('mergeForSave', () => {
  const uuidC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const uuidD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const ws = (id: string, name: string, lastActiveAt: string | null = null): Workspace =>
    ({ id, name, lastActiveAt, activeWindowId: null, terminals: [] });
  const storeOf = (...list: Workspace[]): StoreFile => ({ version: 2, workspaces: list });

  it('workspace cửa sổ này ĐÃ ĐỤNG TỚI thì bản RAM thắng, giữ nguyên object của RAM', () => {
    const ramWs = ws(uuidA, 'ERP mới', '2026-08-10T00:00:00.000Z');
    const merged = mergeForSave(
      storeOf(ws(uuidA, 'ERP cũ')), storeOf(ramWs), new Set(), new Set([uuidA]),
    );
    expect(merged.workspaces).toHaveLength(1);
    // Giữ nguyên tham chiếu: manager đang cầm object này trong closure (ports, entry đang mint).
    expect(merged.workspaces[0]).toBe(ramWs);
    expect(merged.workspaces[0]!.name).toBe('ERP mới');
  });

  it('workspace cửa sổ này KHÔNG đụng tới thì bản đĩa (mới hơn) thắng', () => {
    // Cửa sổ khác vừa mint sessionId / vừa đặt khóa V5 cho workspace này. Bản RAM của ta chỉ
    // là ảnh chụp lúc khởi động — ghi đè nó lên đĩa là xóa mất việc của cửa sổ kia.
    const diskWs = ws(uuidA, 'ERP đã đổi tên ở cửa sổ khác', '2026-08-10T09:00:00.000Z');
    diskWs.activeWindowId = 'cua-so-khac';
    const merged = mergeForSave(
      storeOf(diskWs), storeOf(ws(uuidA, 'ERP cũ')), new Set(), new Set(),
    );
    expect(merged.workspaces[0]).toBe(diskWs);
    expect(merged.workspaces[0]!.activeWindowId).toBe('cua-so-khac');
  });

  it('workspace không đụng tới nhưng đĩa không còn thì vẫn giữ bản RAM', () => {
    // Không bao giờ vứt dữ liệu ta đang cầm chỉ vì đĩa mất nó.
    const ramWs = ws(uuidA, 'Chỉ còn trong RAM');
    const merged = mergeForSave(storeOf(), storeOf(ramWs), new Set(), new Set());
    expect(merged.workspaces).toEqual([ramWs]);
  });

  it('khử trùng sessionId khi gộp: workspace ta đã đụng giữ id, bản đĩa bị gỡ (không double --resume)', () => {
    // Hai cửa sổ VS Code cùng gắn một hội thoại trước khi kịp thấy nhau — merge là nơi duy
    // nhất nhìn thấy cả hai bản.
    const sid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const ramWs = ws(uuidA, 'Của ta');
    ramWs.terminals = [{ id: uuidC, name: 'a', cwd: 'D:\\x', kind: 'claude', claudeSessionId: sid }];
    const diskWs = ws(uuidB, 'Của cửa sổ khác');
    diskWs.terminals = [{ id: uuidD, name: 'b', cwd: 'D:\\y', kind: 'claude', claudeSessionId: sid }];

    const merged = mergeForSave(
      storeOf(diskWs), storeOf(ramWs), new Set(), new Set([uuidA]),
    );

    const ids = merged.workspaces.flatMap((w) => w.terminals.map((t) => t.claudeSessionId));
    expect(ids.filter((x) => x === sid)).toHaveLength(1);
    expect(merged.workspaces.find((w) => w.id === uuidA)!.terminals[0]!.claudeSessionId).toBe(sid);
    // Không mutate object của đĩa: bản gốc vẫn còn id, chỉ bản gộp bị gỡ.
    expect(diskWs.terminals[0]!.claudeSessionId).toBe(sid);
    expect(merged.workspaces.find((w) => w.id === uuidB)!.terminals[0]!.claudeSessionId)
      .toBeUndefined();
  });

  it('không mutate object của store đĩa khi phải đổi tên', () => {
    const diskWs = ws(uuidB, 'ERP');
    const merged = mergeForSave(
      storeOf(diskWs), storeOf(ws(uuidA, 'ERP')), new Set(), new Set([uuidA]),
    );
    expect(diskWs.name).toBe('ERP');
    expect(merged.workspaces.find((w) => w.id === uuidB)!.name).toBe('ERP (2)');
  });

  it('workspace chỉ có trên đĩa (cửa sổ khác tạo) được giữ lại', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidB, 'Của cửa sổ khác')), storeOf(ws(uuidA, 'A')), new Set(), new Set([uuidA]),
    );
    expect(merged.workspaces.map((w) => w.id).sort()).toEqual([uuidA, uuidB].sort());
  });

  it('workspace đã bị cửa sổ này xóa thì KHÔNG sống lại từ đĩa', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidA, 'A'), ws(uuidB, 'Đã xóa')),
      storeOf(ws(uuidA, 'A')),
      new Set([uuidB]),
      new Set([uuidA]),
    );
    expect(merged.workspaces.map((w) => w.id)).toEqual([uuidA]);
  });

  it('trùng tên giữa bản đĩa giữ lại và bản RAM thì ĐỔI TÊN bản đĩa, không đụng tên RAM', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidB, 'erp'), ws(uuidC, 'ERP'), ws(uuidD, 'ERP (2)')),
      storeOf(ws(uuidA, 'ERP')),
      new Set(),
      new Set([uuidA]),
    );
    const byId = new Map(merged.workspaces.map((w) => [w.id, w.name]));
    expect(byId.get(uuidA)).toBe('ERP');
    expect(byId.get(uuidD)).toBe('ERP (2)');
    // uuidB và uuidC phải nhận hậu tố khác nhau và khác 'ERP (2)' đã bị chiếm.
    const names = merged.workspaces.map((w) => w.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('kết quả merge luôn hợp lệ với StoreFileSchema', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidB, 'ERP'), ws(uuidC, 'ERP')),
      storeOf(ws(uuidA, 'ERP')),
      new Set(),
      new Set([uuidA]),
    );
    expect(() => StoreFileSchema.parse(merged)).not.toThrow();
  });
});

describe('CRUD', () => {
  it('createWorkspace thêm và trả workspace; trùng tên case-insensitive thì throw', () => {
    const store = emptyStore();
    const ws = createWorkspace(store, 'ERP', uuidA);
    expect(store.workspaces).toHaveLength(1);
    expect(ws.terminals).toEqual([]);
    expect(() => createWorkspace(store, 'erp', uuidB)).toThrow(/đã tồn tại/);
  });

  it('upsertTerminal thay theo id, removeTerminal gỡ đúng phần tử', () => {
    const store = emptyStore();
    const ws = createWorkspace(store, 'X', uuidA);
    const t = { id: uuidB, name: 'a', cwd: 'C:\\x', kind: 'plain' as const };
    upsertTerminal(ws, t);
    upsertTerminal(ws, { ...t, name: 'b' });
    expect(ws.terminals).toEqual([{ ...t, name: 'b' }]);
    removeTerminal(ws, uuidB);
    expect(ws.terminals).toEqual([]);
    expect(findWorkspace(store, uuidA)).toBe(ws);
  });
});

describe('lưu trữ tách file (mỗi workspace một file)', () => {
  const D = 'C:\\store\\workspaces';
  const SEP = '\\';
  const ws = (id: string, name: string, terminals: Workspace['terminals'] = []): Workspace =>
    ({ id, name, lastActiveAt: null, activeWindowId: null, terminals });

  it('ghi rồi đọc lại đúng workspace, tên file theo id', () => {
    const { fs, files } = memFs();
    saveShard(fs, D, ws(uuidA, 'ERP'), SEP);
    expect([...files.keys()]).toEqual([`${D}${SEP}${uuidA}.json`]);
    expect(loadShards(fs, D, () => 1, SEP).workspaces).toEqual([ws(uuidA, 'ERP')]);
  });

  it('file tạm mang hậu tố ngẫu nhiên — hai cửa sổ ghi cùng lúc không trộn nội dung', () => {
    const { fs, ops } = memFs();
    saveShard(fs, D, ws(uuidA, 'A'), SEP);
    saveShard(fs, D, ws(uuidB, 'B'), SEP);
    const tmp = ops.filter((o) => o.startsWith('write:')).map((o) => o.slice(6));
    expect(new Set(tmp).size).toBe(2);
    for (const t of tmp) expect(t).toMatch(/\.tmp-[a-z0-9]+$/);
  });

  it('MỘT file hỏng chỉ mất workspace đó, phần còn lại vẫn nạp được', () => {
    const { fs, files } = memFs();
    saveShard(fs, D, ws(uuidA, 'Tốt'), SEP);
    files.set(`${D}${SEP}${uuidB}.json`, '{ hỏng');
    const r = loadShards(fs, D, () => 7, SEP);
    expect(r.workspaces.map((w) => w.name)).toEqual(['Tốt']);
    expect(r.hong).toEqual([`${D}${SEP}${uuidB}.json.bak-7`]);
    expect(files.get(`${D}${SEP}${uuidB}.json.bak-7`)).toBe('{ hỏng');
  });

  it('workspace sai schema thì ném và KHÔNG để lại file tạm', () => {
    const { fs, files } = memFs();
    const xau = {
      ...ws(uuidA, 'X'),
      terminals: [{ id: uuidB, name: '', cwd: 'D:\\x', kind: 'plain' as const }],
    } as unknown as Workspace;
    expect(() => saveShard(fs, D, xau, SEP)).toThrow();
    expect([...files.keys()]).toEqual([]);
  });

  it('xóa workspace = xóa file, không cần bia mộ', () => {
    const { fs, files } = memFs();
    saveShard(fs, D, ws(uuidA, 'X'), SEP);
    deleteShard(fs, D, uuidA, SEP);
    expect(loadShards(fs, D, () => 1, SEP).workspaces).toEqual([]);
    expect([...files.keys()]).toEqual([]);
  });
});

describe('gopShard', () => {
  const ws = (id: string, terminals: Workspace['terminals']): Workspace =>
    ({ id, name: 'W', lastActiveAt: null, activeWindowId: null, terminals });
  const term = (id: string, name = 't') => ({ id, name, cwd: 'D:\\x', kind: 'plain' as const });

  it('giữ terminal mà cửa sổ khác vừa thêm vào cùng workspace', () => {
    const ra = gopShard(ws(uuidA, [term(uuidB, 'cua-ho')]), ws(uuidA, []));
    expect(ra.terminals.map((t) => t.name)).toEqual(['cua-ho']);
  });

  it('trùng id thì bản của ta thắng (ta đang mở terminal đó)', () => {
    const ra = gopShard(ws(uuidA, [term(uuidB, 'cu')]), ws(uuidA, [term(uuidB, 'moi')]));
    expect(ra.terminals).toEqual([term(uuidB, 'moi')]);
  });

  it('chưa có file trên đĩa → dùng nguyên bản của ta', () => {
    const ram = ws(uuidA, [term(uuidB)]);
    expect(gopShard(null, ram)).toBe(ram);
  });
});

describe('migrateLegacy', () => {
  const D = 'C:\\store\\workspaces';
  const SEP = '\\';
  const wsCu = (id: string, name: string): Workspace =>
    ({ id, name, lastActiveAt: null, activeWindowId: null, terminals: [] });

  it('chuyển từng workspace thành một file rồi ĐỔI TÊN file cũ (không xoá)', () => {
    const store: StoreFile = { version: 2, workspaces: [wsCu(uuidA, 'A'), wsCu(uuidB, 'B')] };
    const { fs, files } = memFs({ [P]: JSON.stringify(store) });
    expect(migrateLegacy(fs, P, D, () => 9, SEP)).toBe(2);
    expect(loadShards(fs, D, () => 1, SEP).workspaces).toHaveLength(2);
    expect(files.has(P)).toBe(false);
    expect(files.has(`${P}.migrated-9`)).toBe(true);
  });

  it('không có file cũ → không làm gì', () => {
    const { fs } = memFs();
    expect(migrateLegacy(fs, P, D, () => 9, SEP)).toBeNull();
  });

  it('chạy lần hai không đè lên shard đã có (bản trên đĩa mới hơn)', () => {
    const store: StoreFile = { version: 2, workspaces: [wsCu(uuidA, 'Tên cũ')] };
    const { fs } = memFs({ [P]: JSON.stringify(store) });
    saveShard(fs, D, wsCu(uuidA, 'Tên mới'), SEP);
    migrateLegacy(fs, P, D, () => 9, SEP);
    expect(loadShards(fs, D, () => 1, SEP).workspaces[0]!.name).toBe('Tên mới');
  });
});
