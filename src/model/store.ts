import * as nodeFs from 'node:fs';
import { StoreFileSchema, emptyStore, type StoreFile, type TerminalEntry, type Workspace } from './schema';

export interface StoreFs {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
}

export interface LoadResult { store: StoreFile; recoveredFrom: string | null; }

export function loadStore(fs: StoreFs, filePath: string, epoch: () => number): LoadResult {
  const raw = fs.readFile(filePath);
  if (raw === null) return { store: emptyStore(), recoveredFrom: null };
  try {
    return { store: StoreFileSchema.parse(JSON.parse(raw)), recoveredFrom: null };
  } catch {
    const backup = `${filePath}.bak-${epoch()}`;
    fs.rename(filePath, backup);
    return { store: emptyStore(), recoveredFrom: backup };
  }
}

export function saveStore(fs: StoreFs, filePath: string, store: StoreFile): void {
  // Cửa ghi là nơi cuối cùng chặn được dữ liệu hỏng: một entry sai schema lọt xuống đĩa sẽ
  // làm loadStore lần sau parse hỏng → backup + danh sách workspace rỗng (mất dữ liệu thật).
  // Ném TRƯỚC khi đụng vào đĩa, để caller giữ nguyên file cũ và thử lại ở lần save sau.
  StoreFileSchema.parse(store);
  const tmp = `${filePath}.tmp`;
  fs.writeFile(tmp, JSON.stringify(store, null, 2));
  fs.rename(tmp, filePath);
}

/**
 * Gộp trạng thái trong RAM của cửa sổ này với trạng thái đang nằm trên đĩa trước khi ghi đè.
 *
 * Mỗi cửa sổ VS Code chạy một instance extension riêng, nạp store một lần lúc khởi động rồi
 * ghi đè cả file mỗi lần lưu. Không gộp thì cửa sổ lưu sau xóa sạch workspace mà cửa sổ kia
 * vừa tạo. Luật:
 *  (a) id có trong RAM  → bản RAM thắng (cửa sổ này mới là chủ của những workspace đó);
 *  (b) id chỉ có trên đĩa → giữ lại, TRỪ KHI nằm trong `deletedIds` (bia mộ: workspace mà
 *      chính cửa sổ này vừa xóa, không được sống lại);
 *  (c) tên đụng nhau giữa bản đĩa giữ lại và bản RAM → đổi tên BẢN ĐĨA (' (2)', ' (3)'…),
 *      không bao giờ đụng vào tên người dùng đang thấy trong cửa sổ này.
 *
 * Trả về object workspace của RAM NGUYÊN TÁC THAM CHIẾU: manager giữ tham chiếu tới chúng
 * trong closure (ports, entry đang mint), thay bằng bản sao sẽ làm các mutation sau đó rơi
 * vào object mồ côi.
 */
export function mergeForSave(
  disk: StoreFile,
  ram: StoreFile,
  deletedIds: ReadonlySet<string>,
): StoreFile {
  const ramIds = new Set(ram.workspaces.map((w) => w.id));
  const takenNames = new Set(ram.workspaces.map((w) => w.name.toLowerCase()));
  const kept = disk.workspaces.filter((w) => !ramIds.has(w.id) && !deletedIds.has(w.id));

  // Hai lượt: giữ chỗ cho mọi tên đĩa KHÔNG đụng độ trước, rồi mới rải hậu tố cho tên đụng
  // độ thật. Một lượt sẽ đổi tên cả workspace vô can chỉ vì trùng với hậu tố ta vừa bịa ra.
  const conflicting = kept.filter((w) => takenNames.has(w.name.toLowerCase()));
  for (const w of kept) {
    if (!takenNames.has(w.name.toLowerCase())) takenNames.add(w.name.toLowerCase());
  }
  for (const w of conflicting) {
    w.name = uniqueName(w.name, takenNames);
    takenNames.add(w.name.toLowerCase());
  }
  return { version: 2, workspaces: [...ram.workspaces, ...kept] };
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
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
}

export function removeTerminal(ws: Workspace, terminalId: string): void {
  const i = ws.terminals.findIndex((t) => t.id === terminalId);
  if (i >= 0) ws.terminals.splice(i, 1);
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
  writeFile(p, c) { nodeFs.writeFileSync(p, c, 'utf8'); },
  rename(a, b) { nodeFs.renameSync(a, b); },
};
