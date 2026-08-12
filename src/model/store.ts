import * as nodeFs from 'node:fs';
import {
  StoreFileSchema,
  WorkspaceSchema,
  emptyStore,
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
  /** File hỏng đã được đổi tên để giữ lại, kèm đường dẫn bản sao lưu. */
  hong: string[];
}

const DUOI = '.json';

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
      fs.rename(duongDan, backup);
      ra.hong.push(backup);
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

/**
 * Gộp bản RAM của cửa sổ này với bản trên đĩa của CÙNG workspace trước khi ghi đè.
 *
 * Chỉ còn một luật, và nó phản ánh đúng thực tế: cửa sổ này là chủ những gì nó đang mở.
 * Terminal chỉ có trên đĩa (cửa sổ khác vừa thêm vào chính workspace này) được giữ lại thay
 * vì bị xoá; mọi thứ còn lại lấy theo bản của ta.
 */
export function gopShard(disk: Workspace | null, ram: Workspace): Workspace {
  if (disk === null) return ram;
  const coTrongRam = new Set(ram.terminals.map((t) => t.id));
  const chiCoTrenDia = disk.terminals.filter((t) => !coTrongRam.has(t.id));
  if (chiCoTrenDia.length === 0) return ram;
  return { ...ram, terminals: [...ram.terminals, ...chiCoTrenDia] };
}

/**
 * Chuyển dữ liệu từ file gộp cũ sang thư mục shard. Chạy đúng một lần: sau khi ghi xong, file
 * cũ được đổi tên (KHÔNG xoá — người dùng còn muốn xem lại thì vẫn còn).
 *
 * @returns số workspace đã chuyển, hoặc null nếu không có gì để chuyển.
 */
export function migrateLegacy(
  fs: StoreFs,
  legacyPath: string,
  dir: string,
  epoch: () => number,
  sep = '/',
): number | null {
  const raw = fs.readFile(legacyPath);
  if (raw === null) return null;
  let store: StoreFile;
  try {
    store = StoreFileSchema.parse(JSON.parse(raw));
  } catch {
    fs.rename(legacyPath, `${legacyPath}.bak-${epoch()}`);
    return null;
  }
  fs.mkdirp(dir);
  for (const ws of store.workspaces) {
    // File shard đã có (chuyển dở lần trước) thì giữ bản mới hơn trên đĩa, không đè lại.
    if (fs.readFile(tenFileWorkspace(dir, ws.id, sep)) !== null) continue;
    saveShard(fs, dir, ws, sep);
  }
  fs.rename(legacyPath, `${legacyPath}.migrated-${epoch()}`);
  return store.workspaces.length;
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
 *  (a) id có trong RAM VÀ cửa sổ này đã đụng tới (`touchedIds`) → bản RAM thắng;
 *  (b) id có trong RAM nhưng cửa sổ này CHƯA đụng tới, mà đĩa cũng có → BẢN ĐĨA thắng. Bản
 *      RAM của workspace ta chưa đụng chỉ là ảnh chụp lúc khởi động (hoặc bản vừa hút vào từ
 *      lần merge trước); ghi đè nó lên đĩa sẽ xóa sessionId mà cửa sổ khác vừa mint và xóa
 *      luôn khóa V5 của họ. Không đụng tới ⇒ không có closure/mint nào đang trỏ vào object
 *      đó, nên thay bằng object của đĩa là an toàn;
 *  (c) id có trong RAM mà đĩa không còn → giữ bản RAM (không bao giờ vứt dữ liệu ta đang cầm);
 *  (d) id chỉ có trên đĩa → giữ lại, TRỪ KHI nằm trong `deletedIds` (bia mộ: workspace mà
 *      chính cửa sổ này vừa xóa, không được sống lại);
 *  (e) tên đụng nhau giữa bản đĩa giữ lại và bản phía RAM → đổi tên BẢN ĐĨA (' (2)', ' (3)'…),
 *      không bao giờ đụng vào tên người dùng đang thấy trong cửa sổ này.
 *
 * Với nhánh (a) trả về object workspace của RAM NGUYÊN TÁC THAM CHIẾU: manager giữ tham chiếu
 * tới chúng trong closure (ports, entry đang mint), thay bằng bản sao sẽ làm các mutation sau
 * đó rơi vào object mồ côi. KHÔNG mutate `disk`: bản đĩa phải đổi tên thì clone rồi mới sửa.
 */
export function mergeForSave(
  disk: StoreFile,
  ram: StoreFile,
  deletedIds: ReadonlySet<string>,
  touchedIds: ReadonlySet<string>,
): StoreFile {
  const diskById = new Map(disk.workspaces.map((w) => [w.id, w]));
  const winners = ram.workspaces.map((ramWs) =>
    touchedIds.has(ramWs.id) ? ramWs : diskById.get(ramWs.id) ?? ramWs,
  );

  const ramIds = new Set(ram.workspaces.map((w) => w.id));
  const takenNames = new Set(winners.map((w) => w.name.toLowerCase()));
  const candidates = disk.workspaces.filter((w) => !ramIds.has(w.id) && !deletedIds.has(w.id));

  // Hai lượt: giữ chỗ cho mọi tên đĩa KHÔNG đụng độ trước, rồi mới rải hậu tố cho tên đụng
  // độ thật. Một lượt sẽ đổi tên cả workspace vô can chỉ vì trùng với hậu tố ta vừa bịa ra.
  const conflicting = new Set(candidates.filter((w) => takenNames.has(w.name.toLowerCase())));
  for (const w of candidates) {
    if (!conflicting.has(w)) takenNames.add(w.name.toLowerCase());
  }
  const kept = candidates.map((w) => {
    if (!conflicting.has(w)) return w;
    const name = uniqueName(w.name, takenNames);
    takenNames.add(name.toLowerCase());
    return { ...w, name };
  });
  return { version: 2, workspaces: khuTrungSession([...winners, ...kept], touchedIds) };
}

/**
 * Một hội thoại chỉ được thuộc MỘT entry. Trong phạm vi một cửa sổ, `claimSession` giữ bất
 * biến đó; nhưng hai cửa sổ VS Code có thể cùng gắn một sessionId trước khi kịp thấy nhau
 * (bản RAM chỉ được nạp lại từ đĩa lúc save), và merge là nơi DUY NHẤT nhìn thấy cả hai bản.
 * Giữ id ở entry thuộc workspace trong `touchedIds` rồi gỡ ở chỗ còn lại — để cả hai là lần
 * khôi phục sau `--resume` một hội thoại hai lần. Lưu ý `touchedIds` chỉ nghĩa là "cửa sổ này
 * có sửa workspace đó" (kể cả đổi tên), KHÔNG hàm ý claim của ta mới hơn hay có bằng chứng
 * hơn — tie-break chuẩn cần dấu thời điểm claim trong schema. KHÔNG mutate object phía đĩa:
 * clone rồi mới sửa.
 */
function khuTrungSession(list: Workspace[], touchedIds: ReadonlySet<string>): Workspace[] {
  // Hai loại id, khử độc lập nhau: Claude (`claudeSessionId`) và agent khác (`agentSessionId`).
  const daGiu = { claude: new Set<string>(), agent: new Set<string>() };
  for (const w of list) {
    if (!touchedIds.has(w.id)) continue;
    for (const t of w.terminals) {
      if (t.claudeSessionId !== undefined) daGiu.claude.add(t.claudeSessionId);
      if (t.agentSessionId !== undefined) daGiu.agent.add(t.agentSessionId);
    }
  }
  return list.map((w) => {
    if (touchedIds.has(w.id)) return w;
    let coTrung = false;
    const terminals = w.terminals.map((t) => {
      let ban = t;
      if (t.claudeSessionId !== undefined) {
        if (daGiu.claude.has(t.claudeSessionId)) {
          coTrung = true;
          ban = { ...ban };
          delete ban.claudeSessionId;
        } else daGiu.claude.add(t.claudeSessionId);
      }
      if (t.agentSessionId !== undefined) {
        if (daGiu.agent.has(t.agentSessionId)) {
          coTrung = true;
          ban = { ...ban };
          delete ban.agentSessionId;
        } else daGiu.agent.add(t.agentSessionId);
      }
      return ban;
    });
    return coTrung ? { ...w, terminals } : w;
  });
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
  list(dir) {
    try {
      return nodeFs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  remove(p) {
    try {
      nodeFs.rmSync(p, { force: true });
    } catch {
      // Xoá không được (file đang bị khoá) thì thôi — caller không có gì làm thêm.
    }
  },
  mkdirp(dir) { nodeFs.mkdirSync(dir, { recursive: true }); },
};
