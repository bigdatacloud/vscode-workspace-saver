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
  const daGiu = new Set<string>();
  for (const w of list) {
    if (!touchedIds.has(w.id)) continue;
    for (const t of w.terminals) if (t.claudeSessionId !== undefined) daGiu.add(t.claudeSessionId);
  }
  return list.map((w) => {
    if (touchedIds.has(w.id)) return w;
    let coTrung = false;
    const terminals = w.terminals.map((t) => {
      const id = t.claudeSessionId;
      if (id === undefined) return t;
      if (!daGiu.has(id)) {
        daGiu.add(id);
        return t;
      }
      coTrung = true;
      const ban = { ...t };
      delete ban.claudeSessionId;
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
};
