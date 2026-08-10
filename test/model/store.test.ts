import { describe, expect, it } from 'vitest';
import { StoreFileSchema, emptyStore, type StoreFile, type Workspace } from '../../src/model/schema';
import {
  createWorkspace, findWorkspace, loadStore, mergeForSave, removeTerminal, saveStore, upsertTerminal,
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

  it('workspace có ở RAM thì bản RAM thắng, giữ nguyên object của RAM', () => {
    const ramWs = ws(uuidA, 'ERP mới', '2026-08-10T00:00:00.000Z');
    const merged = mergeForSave(storeOf(ws(uuidA, 'ERP cũ')), storeOf(ramWs), new Set());
    expect(merged.workspaces).toHaveLength(1);
    // Giữ nguyên tham chiếu: manager đang cầm object này trong closure (ports, entry đang mint).
    expect(merged.workspaces[0]).toBe(ramWs);
  });

  it('workspace chỉ có trên đĩa (cửa sổ khác tạo) được giữ lại', () => {
    const merged = mergeForSave(storeOf(ws(uuidB, 'Của cửa sổ khác')), storeOf(ws(uuidA, 'A')), new Set());
    expect(merged.workspaces.map((w) => w.id).sort()).toEqual([uuidA, uuidB].sort());
  });

  it('workspace đã bị cửa sổ này xóa thì KHÔNG sống lại từ đĩa', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidA, 'A'), ws(uuidB, 'Đã xóa')),
      storeOf(ws(uuidA, 'A')),
      new Set([uuidB]),
    );
    expect(merged.workspaces.map((w) => w.id)).toEqual([uuidA]);
  });

  it('trùng tên giữa bản đĩa giữ lại và bản RAM thì ĐỔI TÊN bản đĩa, không đụng tên RAM', () => {
    const merged = mergeForSave(
      storeOf(ws(uuidB, 'erp'), ws(uuidC, 'ERP'), ws(uuidD, 'ERP (2)')),
      storeOf(ws(uuidA, 'ERP')),
      new Set(),
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
