import { describe, expect, it } from 'vitest';
import { StoreFileSchema, emptyStore, type StoreFile, type Workspace } from '../../src/model/schema';
import {
  createWorkspace, deleteShard, findWorkspace, gopShard, loadShards,
  migrateLegacy, removeTerminal, saveShard, upsertTerminal,
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
    expect(r.hong).toEqual([{ id: uuidB, backup: `${D}${SEP}${uuidB}.json.bak-7` }]);
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
    expect(migrateLegacy(fs, P, D, () => 9, SEP)).toEqual({ loai: 'xong', soLuong: 2 });
    expect(loadShards(fs, D, () => 1, SEP).workspaces).toHaveLength(2);
    expect(files.has(P)).toBe(false);
    expect(files.has(`${P}.migrated-9`)).toBe(true);
  });

  it('không có file cũ → không làm gì', () => {
    const { fs } = memFs();
    expect(migrateLegacy(fs, P, D, () => 9, SEP)).toEqual({ loai: 'khong-co' });
  });

  it('chạy lần hai không đè lên shard đã có (bản trên đĩa mới hơn)', () => {
    const store: StoreFile = { version: 2, workspaces: [wsCu(uuidA, 'Tên cũ')] };
    const { fs } = memFs({ [P]: JSON.stringify(store) });
    saveShard(fs, D, wsCu(uuidA, 'Tên mới'), SEP);
    migrateLegacy(fs, P, D, () => 9, SEP);
    expect(loadShards(fs, D, () => 1, SEP).workspaces[0]!.name).toBe('Tên mới');
  });
});

describe('migrateLegacy — ca hỏng và ca hai cửa sổ chạy đua', () => {
  const D = 'C:\\store\\workspaces';
  const SEP = '\\';

  it('file cũ HỎNG → giữ lại bản sao và báo rõ, không im lặng nuốt mất', () => {
    const { fs, files } = memFs({ [P]: '{ hỏng' });
    const r = migrateLegacy(fs, P, D, () => 3, SEP);
    expect(r).toEqual({ loai: 'hong', backup: `${P}.bak-3` });
    expect(files.get(`${P}.bak-3`)).toBe('{ hỏng');
  });

  it('cửa sổ khác đã đổi tên file cũ giữa chừng → vẫn báo XONG, không ném', () => {
    const store: StoreFile = {
      version: 2,
      workspaces: [{ id: uuidA, name: 'A', lastActiveAt: null, activeWindowId: null, terminals: [] }],
    };
    const { fs, files } = memFs({ [P]: JSON.stringify(store) });
    // Mô phỏng: đúng lúc migrate ghi xong shard thì file cũ biến mất (cửa sổ kia rename trước).
    const renameThat = fs.rename;
    fs.rename = (a, b) => {
      if (a === P) { files.delete(P); throw new Error('ENOENT'); }
      renameThat(a, b);
    };
    expect(() => migrateLegacy(fs, P, D, () => 4, SEP)).not.toThrow();
    expect(loadShards(fs, D, () => 1, SEP).workspaces).toHaveLength(1);
  });
});

describe('loadShards — chỉ đọc file .json của workspace', () => {
  const D = 'C:\\store\\workspaces';
  const SEP = '\\';

  it('bỏ qua file tạm, file backup và file đã migrate', () => {
    const { fs, files } = memFs();
    saveShard(fs, D, { id: uuidA, name: 'A', lastActiveAt: null, activeWindowId: null, terminals: [] }, SEP);
    files.set(`${D}${SEP}${uuidB}.json.tmp-abc`, 'rác');
    files.set(`${D}${SEP}${uuidB}.json.bak-1`, 'rác');
    files.set(`${D}${SEP}${uuidB}.json.migrated-1`, 'rác');
    const r = loadShards(fs, D, () => 1, SEP);
    expect(r.workspaces).toHaveLength(1);
    expect(r.hong).toEqual([]);
  });

  it('file hỏng trả về kèm ID để tầng trên biết workspace nào chỉ là ĐỌC KHÔNG ĐƯỢC', () => {
    const { fs, files } = memFs();
    files.set(`${D}${SEP}${uuidA}.json`, '{ hỏng');
    const r = loadShards(fs, D, () => 5, SEP);
    expect(r.hong).toEqual([{ id: uuidA, backup: `${D}${SEP}${uuidA}.json.bak-5` }]);
  });
});

describe('bia mộ terminal đã bỏ', () => {
  const uuidC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const ws = (id: string, terminals: Workspace['terminals']): Workspace =>
    ({ id, name: 'W', lastActiveAt: null, activeWindowId: null, terminals });
  const term = (id: string, name = 't') => ({ id, name, cwd: String.raw`D:\x`, kind: 'plain' as const });

  it('terminal đã bỏ KHÔNG sống lại từ bản trên đĩa', () => {
    const dia = ws(uuidA, [term(uuidB, 'giu'), term(uuidC, 'bo')]);
    const ram = ws(uuidA, [term(uuidB, 'giu'), term(uuidC, 'bo')]);
    removeTerminal(ram, uuidC, 1_000);
    const ra = gopShard(dia, ram, 1_000);
    expect(ra.terminals.map((t) => t.id)).toEqual([uuidB]);
  });

  it('bia mộ đi vào file và không cản terminal cửa sổ khác vừa thêm', () => {
    const ram = ws(uuidA, [term(uuidB)]);
    removeTerminal(ram, uuidB, 1_000);
    const dia = ws(uuidA, [term(uuidB), term(uuidC, 'cua-ho')]);
    const ra = gopShard(dia, ram, 1_000);
    expect(ra.terminals.map((t) => t.name)).toEqual(['cua-ho']);
    const { fs, files } = memFs();
    saveShard(fs, 'C:\\d', ra, '\\');
    expect(JSON.parse(files.get('C:\\d\\' + uuidA + '.json')!).removedTerminals)
      .toEqual([{ id: uuidB, at: 1_000 }]);
  });

  it('thêm lại terminal cùng id thì bia mộ bị xoá', () => {
    const ram = ws(uuidA, []);
    removeTerminal(ram, uuidB, 1_000);
    upsertTerminal(ram, term(uuidB, 'moi'));
    const ra = gopShard(ws(uuidA, [term(uuidB, 'cu')]), ram, 1_000);
    expect(ra.terminals.map((t) => t.name)).toEqual(['moi']);
    expect(ra.removedTerminals ?? []).toEqual([]);
  });

  it('vòng đời thật: lưu → bỏ → lưu → khởi động lại thì terminal KHÔNG quay về', () => {
    const SEP = String.fromCharCode(92);
    const D = 'C:' + SEP + 'd';
    const { fs: mem } = memFs();
    const ram = ws(uuidA, [term(uuidB, 'giu'), term(uuidC, 'bo')]);
    const luu = (now: number) => {
      const raw = mem.readFile(D + SEP + uuidA + '.json');
      const dia = raw === null ? null : (JSON.parse(raw) as Workspace);
      saveShard(mem, D, gopShard(dia, ram, now), SEP);
    };
    luu(1_000);
    removeTerminal(ram, uuidC, 2_000);
    luu(2_000);
    const sauKhoiDongLai = loadShards(mem, D, () => 0, SEP).workspaces;
    expect(sauKhoiDongLai[0]!.terminals.map((t) => t.name)).toEqual(['giu']);
  });

  it('bia mộ quá hạn được dọn để file không phình mãi', () => {
    const ram = ws(uuidA, []);
    removeTerminal(ram, uuidB, 0);
    const ra = gopShard(ws(uuidA, []), ram, 40 * 24 * 3600 * 1000);
    expect(ra.removedTerminals ?? []).toEqual([]);
  });
});

describe('worktree của entry đi qua đĩa', () => {
  const SEP = String.fromCharCode(92);
  const DIR = `C:${SEP}store${SEP}workspaces`;
  const wt = { path: `D:/repo-worktrees/fix-login-claude`, branch: 'fix-login-claude' };

  const ws = (terminals: Workspace['terminals']): Workspace => ({
    id: uuidA, name: 'W', lastActiveAt: null, activeWindowId: null, terminals,
  });
  const term = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: 'fix-login-claude', cwd: wt.path, kind: 'plain' as const, ...extra,
  });

  it('lưu rồi đọc lại giữ nguyên worktree', () => {
    const { fs } = memFs();
    saveShard(fs, DIR, ws([term(uuidB, { worktree: wt })]), SEP);
    const r = loadShards(fs, DIR, () => 1, SEP);
    expect(r.workspaces[0]?.terminals[0]?.worktree).toEqual(wt);
  });

  it('gộp RAM/đĩa giữ worktree của bản RAM', () => {
    const disk = ws([term(uuidB, { worktree: { path: 'D:/cu', branch: 'cu' } })]);
    const ram = ws([term(uuidB, { worktree: wt })]);
    expect(gopShard(disk, ram).terminals[0]?.worktree).toEqual(wt);
  });

  it('bản extension cũ không hiểu worktree cũng KHÔNG xoá nó', () => {
    // `.passthrough()` là thứ giữ lời hứa này; mất nó là mất dữ liệu của bản kia khi chạy lẫn.
    const { fs, files } = memFs();
    saveShard(fs, DIR, ws([term(uuidB, { worktree: wt, truongLaCuaBanMoiHon: 42 })]), SEP);
    const raw = [...files.values()][0] ?? '';
    expect(JSON.parse(raw).terminals[0].truongLaCuaBanMoiHon).toBe(42);
    const r = loadShards(fs, DIR, () => 1, SEP);
    expect((r.workspaces[0]?.terminals[0] as Record<string, unknown>).truongLaCuaBanMoiHon).toBe(42);
  });
});
