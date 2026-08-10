import { describe, expect, it } from 'vitest';
import { emptyStore } from '../../src/model/schema';
import {
  createWorkspace, findWorkspace, loadStore, removeTerminal, saveStore, upsertTerminal, type StoreFs,
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
