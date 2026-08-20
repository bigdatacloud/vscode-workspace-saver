import * as nodeFs from 'node:fs';
import {
  StoreFileSchema,
  WorkspaceSchema,
  emptyStore,
  type BiaMoTerminal,
  type StoreFile,
  type TerminalEntry,
  type Workspace,
} from './schema';

export interface StoreFs {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
  /** Tên các mục con; thư mục không tồn tại → mảng rỗng, KHÔNG ném. */
  list(dir: string): string[];
  /** Xóa file; không tồn tại → im lặng bỏ qua. */
  remove(path: string): void;
  mkdirp(dir: string): void;
}

/**
 * MỖI WORKSPACE MỘT FILE (`<thư mục>/<id>.json`) thay vì gộp tất cả vào một file.
 *
 * Lý do: cả file dùng chung là nguồn của gần hết lớp lỗi đa cửa sổ. Mỗi lần lưu phải đọc lại
 * cả file rồi gộp bằng heuristic ("cửa sổ này đã đụng workspace nào") — chính đoạn đó đã sinh
 * ra lỗi ghi đè việc của cửa sổ khác, lỗi workspace bị xóa sống lại, và lỗi một workspace sai
 * tên làm CẢ file không ghi được nữa. Tách file thì hai cửa sổ làm việc trên hai workspace
 * khác nhau không bao giờ chạm cùng một file: không cần gộp, không cần bia mộ, và một file
 * hỏng chỉ mất đúng workspace đó chứ không mất cả danh sách.
 */
export interface ShardResult {
  workspaces: Workspace[];
  /**
   * File đọc/parse hỏng, đã được đổi tên để giữ lại. Kèm `id` (lấy từ tên file) vì tầng trên
   * PHẢI phân biệt "workspace này không còn trên đĩa" với "đọc file của nó không được": ca
   * đầu là quên nó đi, ca sau mà quên là bản RAM đang tốt cũng bay theo.
   */
  hong: { id: string; backup: string }[];
}

const DUOI = '.json';

/**
 * Bia mộ sống bao lâu trước khi bị dọn. Nó chỉ cần sống lâu hơn bản RAM cũ trong một cửa sổ
 * VS Code khác đang mở mà không lưu gì; 30 ngày là thừa cho việc đó, và mỗi bia chỉ tốn vài
 * chục byte nên file không phình đáng kể.
 */
export const BIA_MO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function tenFileWorkspace(dir: string, id: string, sep = '/'): string {
  return `${dir}${sep}${id}${DUOI}`;
}

export function loadShards(fs: StoreFs, dir: string, epoch: () => number, sep = '/'): ShardResult {
  const ra: ShardResult = { workspaces: [], hong: [] };
  for (const ten of fs.list(dir)) {
    if (!ten.endsWith(DUOI)) continue;
    const duongDan = `${dir}${sep}${ten}`;
    const raw = fs.readFile(duongDan);
    if (raw === null) continue;
    try {
      ra.workspaces.push(WorkspaceSchema.parse(JSON.parse(raw)));
    } catch {
      // Một file hỏng KHÔNG được kéo cả danh sách xuống: giữ lại bản sao rồi đi tiếp.
      const backup = `${duongDan}.bak-${epoch()}`;
      try {
        fs.rename(duongDan, backup);
      } catch {
        continue; // đổi tên không được (file bị khoá) → cứ để đó, lần sau thử lại
      }
      ra.hong.push({ id: ten.slice(0, -DUOI.length), backup });
    }
  }
  return ra;
}

export function saveShard(fs: StoreFs, dir: string, ws: Workspace, sep = '/'): void {
  // Cửa ghi vẫn là chốt chặn dữ liệu hỏng, nhưng giờ chỉ chặn ĐÚNG workspace này: một
  // workspace sai schema không còn khoá luôn việc lưu của các workspace khác.
  WorkspaceSchema.parse(ws);
  fs.mkdirp(dir);
  const dich = tenFileWorkspace(dir, ws.id, sep);
  // Tên file tạm phải DUY NHẤT cho mỗi lần ghi: dùng chung một tên `.tmp` thì hai cửa sổ ghi
  // cùng lúc sẽ trộn nội dung vào nhau rồi rename ra file thật.
  const tmp = `${dich}.tmp-${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeFile(tmp, JSON.stringify(ws, null, 2));
    fs.rename(tmp, dich);
  } catch (e) {
    fs.remove(tmp);
    throw e;
  }
}

export function deleteShard(fs: StoreFs, dir: string, id: string, sep = '/'): void {
  fs.remove(tenFileWorkspace(dir, id, sep));
}

/** Gom bia mộ của hai bên, mỗi id giữ mốc thời gian mới nhất. */
function gomBiaMo(...nguon: (BiaMoTerminal[] | undefined)[]): Map<string, number> {
  const ra = new Map<string, number>();
  for (const ds of nguon) {
    for (const b of ds ?? []) ra.set(b.id, Math.max(ra.get(b.id) ?? 0, b.at));
  }
  return ra;
}

/**
 * Gộp bản RAM của cửa sổ này với bản trên đĩa của CÙNG workspace trước khi ghi đè.
 *
 * Hai luật, và luật thứ hai là thứ trước đây thiếu:
 *
 * 1. Terminal chỉ có trên đĩa (cửa sổ khác vừa thêm vào chính workspace này) được giữ lại.
 * 2. TRỪ KHI nó nằm trong bia mộ. Không có bia mộ thì phép gộp thuần hợp không có cách nào
 *    phân biệt "cửa sổ khác vừa thêm" với "chính ta vừa bỏ" — nên MỌI lần bỏ terminal đều bị
 *    chính bản trên đĩa dựng dậy ở nhịp ghi kế tiếp, và người dùng thấy lại toàn bộ terminal
 *    từng có sau khi khởi động lại máy.
 *
 * Terminal còn sống trong bản của ta thì xoá bia mộ của nó: nó đã được thêm lại.
 */
export function gopShard(disk: Workspace | null, ram: Workspace, now = Date.now()): Workspace {
  if (disk === null) return ram;
  const bia = gomBiaMo(disk.removedTerminals, ram.removedTerminals);
  for (const t of ram.terminals) bia.delete(t.id);
  for (const [id, at] of bia) {
    if (now - at > BIA_MO_TTL_MS) bia.delete(id);
  }
  const coTrongRam = new Set(ram.terminals.map((t) => t.id));
  const chiCoTrenDia = disk.terminals.filter((t) => !coTrongRam.has(t.id) && !bia.has(t.id));
  const ra: Workspace = { ...ram, terminals: [...ram.terminals, ...chiCoTrenDia] };
  if (bia.size === 0) delete ra.removedTerminals;
  else ra.removedTerminals = [...bia].map(([id, at]) => ({ id, at }));
  return ra;
}

/**
 * Chuyển dữ liệu từ file gộp cũ sang thư mục shard. Chạy đúng một lần: sau khi ghi xong, file
 * cũ được đổi tên (KHÔNG xoá — người dùng còn muốn xem lại thì vẫn còn).
 *
 * @returns số workspace đã chuyển, hoặc null nếu không có gì để chuyển.
 */
export type KetQuaChuyen =
  | { loai: 'khong-co' }
  | { loai: 'xong'; soLuong: number }
  | { loai: 'hong'; backup: string };

export function migrateLegacy(
  fs: StoreFs,
  legacyPath: string,
  dir: string,
  epoch: () => number,
  sep = '/',
): KetQuaChuyen {
  const raw = fs.readFile(legacyPath);
  if (raw === null) return { loai: 'khong-co' };
  let store: StoreFile;
  try {
    store = StoreFileSchema.parse(JSON.parse(raw));
  } catch {
    // File cũ hỏng: đây là BẢN SAO DUY NHẤT dữ liệu của người dùng, phải giữ lại VÀ báo cho
    // họ biết — im lặng thì họ mở lên thấy danh sách trống và tưởng mất trắng.
    const backup = `${legacyPath}.bak-${epoch()}`;
    try {
      fs.rename(legacyPath, backup);
    } catch {
      /* đổi tên không được thì thôi, dữ liệu vẫn nằm nguyên chỗ cũ */
    }
    return { loai: 'hong', backup };
  }
  fs.mkdirp(dir);
  for (const ws of store.workspaces) {
    // File shard đã có (chuyển dở lần trước, hoặc cửa sổ khác vừa chuyển) thì giữ bản trên
    // đĩa, không đè lại.
    if (fs.readFile(tenFileWorkspace(dir, ws.id, sep)) !== null) continue;
    saveShard(fs, dir, ws, sep);
  }
  try {
    fs.rename(legacyPath, `${legacyPath}.migrated-${epoch()}`);
  } catch {
    // Hai cửa sổ VS Code cùng mở và cùng chuyển: cửa sổ kia đổi tên trước nên rename này ném
    // ENOENT. Việc đã xong rồi — ném tiếp là cửa sổ này bỏ luôn bước nạp và hiện danh sách
    // TRỐNG suốt phiên.
  }
  return { loai: 'xong', soLuong: store.workspaces.length };
}

export function createWorkspace(store: StoreFile, name: string, id: string): Workspace {
  const lower = name.toLowerCase();
  if (store.workspaces.some((w) => w.name.toLowerCase() === lower)) {
    throw new Error(`Tên workspace "${name}" đã tồn tại.`);
  }
  const ws: Workspace = { id, name, lastActiveAt: null, activeWindowId: null, terminals: [] };
  store.workspaces.push(ws);
  return ws;
}

export function findWorkspace(store: StoreFile, id: string): Workspace | undefined {
  return store.workspaces.find((w) => w.id === id);
}

export function upsertTerminal(ws: Workspace, entry: TerminalEntry): void {
  const i = ws.terminals.findIndex((t) => t.id === entry.id);
  if (i >= 0) ws.terminals[i] = entry;
  else ws.terminals.push(entry);
  // Thêm lại thì bia mộ cũ phải biến mất, nếu không lần gộp sau lại chôn nó lần nữa.
  const bia = ws.removedTerminals;
  if (bia !== undefined) {
    const con = bia.filter((b) => b.id !== entry.id);
    if (con.length === 0) delete ws.removedTerminals;
    else ws.removedTerminals = con;
  }
}

/**
 * Bỏ terminal khỏi workspace VÀ ghi bia mộ. Bia mộ là phần bắt buộc: xoá suông khỏi mảng thì
 * bản trên đĩa (vẫn còn terminal đó) sẽ dựng nó dậy ở lần gộp kế tiếp — xem `gopShard`.
 */
export function removeTerminal(ws: Workspace, terminalId: string, now = Date.now()): void {
  const i = ws.terminals.findIndex((t) => t.id === terminalId);
  if (i >= 0) ws.terminals.splice(i, 1);
  const bia = (ws.removedTerminals ?? []).filter((b) => b.id !== terminalId);
  bia.push({ id: terminalId, at: now });
  ws.removedTerminals = bia;
}

export const realStoreFs: StoreFs = {
  readFile(p) {
    try {
      return nodeFs.readFileSync(p, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  // fsync trước khi rename: không có nó thì nội dung mới có thể còn nằm trong cache của HĐH
  // lúc mất điện, và cái rename "nguyên tử" chỉ đổi tên một file rỗng ra file thật.
  writeFile(p, c) {
    const fd = nodeFs.openSync(p, 'w');
    try {
      nodeFs.writeFileSync(fd, c, 'utf8');
      nodeFs.fsyncSync(fd);
    } finally {
      nodeFs.closeSync(fd);
    }
  },
  rename(a, b) { nodeFs.renameSync(a, b); },
  list(dir) {
    try {
      return nodeFs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  // KHÔNG nuốt lỗi: xoá thất bại (AV/OneDrive đang khoá file) mà báo thành công thì
  // workspace vừa xoá sẽ được nạp lại ở nhịp đồng bộ sau như "workspace mới của cửa sổ khác".
  // `force: true` đã bỏ qua ENOENT nên chỉ lỗi thật mới ném.
  remove(p) { nodeFs.rmSync(p, { force: true }); },
  mkdirp(dir) { nodeFs.mkdirSync(dir, { recursive: true }); },
};
