import * as vscode from 'vscode';
import { boCucLuoi, boCucTuCotDong, TOI_DA_O } from './luoi';

/**
 * Xem nhiều terminal cùng lúc: xếp chúng thành lưới trong vùng editor.
 *
 * Vì sao vùng editor chứ không phải panel: VS Code chỉ cho chia lưới tuỳ ý ở vùng editor
 * (`vscode.setEditorLayout`); panel chỉ split được theo một hàng ngang. Extension này vốn đã
 * mở terminal trong vùng editor (`aiWorkspace.terminalLocation` mặc định `editor`) nên phần
 * lớn trường hợp không phải dời gì cả.
 *
 * Vì sao KHÔNG mở lại terminal: `workbench.action.terminal.moveToEditor` dời tiến trình đang
 * chạy sang vùng editor, giữ nguyên pty. Mở lại là giết phiên agent rồi nạp lại ngữ cảnh —
 * cái giá đó không được phép trả cho một thao tác chỉ để nhìn.
 */

export interface KetQuaXepLuoi {
  /** Số terminal đã vào lưới. */
  daXep: number;
  /** Số terminal bị bỏ lại vì quá `TOI_DA_O`. */
  qua: number;
}

const chay = async (lenh: string, ...args: unknown[]): Promise<void> => {
  await vscode.commands.executeCommand(lenh, ...args);
};

const HAN_CHO_MS = 3000;

/** Chờ một điều kiện về bố cục editor — các lệnh workbench cập nhật UI không đồng bộ. */
async function cho(dieuKien: () => boolean): Promise<void> {
  const het = Date.now() + HAN_CHO_MS;
  while (Date.now() < het) {
    if (dieuKien()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const nghi = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Nhịp để workbench kịp áp một thao tác bố cục trước khi ta ra lệnh tiếp. */
const NHIP_UI_MS = 220;
/** Nhịp giữa hai lệnh liên tiếp trong cùng một bước — ngắn hơn, gọi rất nhiều lần. */
const NHIP_NHO_MS = 90;

const soNhom = (): number => vscode.window.tabGroups.all.length;

const soNhomCoTerminal = (): number =>
  vscode.window.tabGroups.all.filter((g) =>
    g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal),
  ).length;

/**
 * Terminal này đang nằm ở panel dưới (chứ không phải vùng editor)?
 *
 * Đọc `creationOptions.location` thay vì dò tab đang active: dò tab chỉ đúng khi terminal
 * đang được focus, mà giữa chừng vòng lặp thì không có gì bảo đảm điều đó. Terminal do người
 * dùng tự mở rồi được nhận nuôi thường không khai `location` — mặc định của VS Code là panel.
 */
function dangOPanel(t: vscode.Terminal): boolean {
  const loc = (t.creationOptions as { location?: unknown }).location;
  if (loc === undefined) return true;
  if (loc === vscode.TerminalLocation.Panel) return true;
  if (loc === vscode.TerminalLocation.Editor) return false;
  // Dạng object: `{ viewColumn }` là editor, `{ parentTerminal }` là split trong panel.
  return typeof loc === 'object' && loc !== null && !('viewColumn' in loc);
}

/**
 * Dồn mọi tab về một nhóm editor duy nhất. Cũng là lệnh "thôi xem song song".
 *
 * Gọi trước khi dựng lưới để điểm xuất phát luôn giống nhau: nếu còn nhóm cũ do người dùng
 * tự chia (hoặc do lần xem song song trước), số nhóm thực tế không khớp số ô ta vừa tính và
 * terminal sẽ rơi vào ô sai.
 */
export async function gopVeMotNhom(): Promise<void> {
  await chay('workbench.action.editorLayoutSingle');
}

/** Bố cục người dùng chọn; vắng mặt = tự tính theo số terminal. */
export interface YeuCauLuoi {
  cot: number;
  dong: number;
}

/** Số tab terminal trong một nhóm. */
const demTermTrongNhom = (g: vscode.TabGroup): number =>
  g.tabs.filter((t) => t.input instanceof vscode.TabInputTerminal).length;

/** Nhóm đầu tiên còn chứa nhiều hơn một terminal — chính là nhóm cần tách tiếp. */
const nhomConDongTerminal = (): vscode.TabGroup | undefined =>
  vscode.window.tabGroups.all.find((g) => demTermTrongNhom(g) > 1);

/**
 * Đưa focus vào một nhóm theo chỉ số (0-based), bằng cách đi từ nhóm đầu sang phải.
 *
 * Không có lệnh "focus nhóm thứ N" nhận tham số, và `focusFirstEditorGroup` +
 * `focusNextGroup` thì luôn có.
 */
async function focusNhom(i: number): Promise<void> {
  await chay('workbench.action.focusFirstEditorGroup');
  for (let b = 0; b < i; b++) await chay('workbench.action.focusNextGroup');
}

/**
 * Xoay tab đang active trong nhóm cho tới khi gặp một tab TERMINAL.
 *
 * Trả `false` nếu nhóm không có tab terminal nào. Cần bước này vì lệnh dời tab tác động lên
 * tab đang active: nếu nhóm đang hiện một file thì cú dời sẽ ném file của người dùng sang ô
 * khác — chuyện đã xảy ra thật trong test.
 */
async function xoayToiTabTerminal(g: vscode.TabGroup): Promise<boolean> {
  if (demTermTrongNhom(g) === 0) return false;
  for (let i = 0; i < g.tabs.length + 1; i++) {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab?.input instanceof vscode.TabInputTerminal) return true;
    await chay('workbench.action.nextEditorInGroup');
    await nghi(NHIP_NHO_MS);
  }
  return vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal;
}

/**
 * Xếp các terminal thành lưới.
 *
 * Ba điều học được khi chạy thật trên VS Code 1.142, cả ba đều đi ngược trực giác:
 *
 * 1. **Nhóm rỗng chỉ bị đóng khi tab CUỐI CÙNG của nó rời đi.** `setEditorLayout` dựng được
 *    các ô rỗng và chúng tồn tại yên ổn — nên dựng lưới trước rồi rải tab vào là được, miễn
 *    là nhóm nguồn luôn còn ít nhất một tab. Bản trước hiểu nhầm điều này (đo trên một
 *    terminal duy nhất) và đi đường vòng "tạo nhóm mới bằng cách dời sang nhóm kế tiếp", mà
 *    đường đó lại không phải lúc nào cũng tạo được nhóm — đúng lỗi người dùng gặp: ba
 *    terminal đang mở mà chỉ hai cái vào lưới.
 *
 * 2. **Rải từ gần ra xa.** Tab đi tới ô thứ k bằng k lần "sang nhóm kế tiếp"; các ô nó đi
 *    ngang qua đều đã có tab (vì ta điền ô 2 trước ô 3), nên không ô nào rỗng ra giữa chừng.
 *
 * 3. **Chọn tab bằng cách xoay trong nhóm, không bằng `terminal.show()`.** `show()` không
 *    phải lúc nào cũng kéo được tab của nó lên active, và lệnh dời thì tác động vào tab đang
 *    active — dựa vào `show()` là lý do bản trước bỏ sót terminal. Cái giá: thứ tự ô theo
 *    thứ tự tab chứ không chắc theo thứ tự cây.
 *
 * `yeuCau` là lưới người dùng tự khai (3×3…); vắng mặt thì tự tính theo số terminal. Số ô có
 * thể NHIỀU hơn số terminal khi người dùng tự khai — ô trống lúc đó là chủ ý của họ.
 */
export async function xepLuoiTerminal(
  ds: readonly vscode.Terminal[],
  yeuCau?: YeuCauLuoi,
  ghiLog: (d: string) => void = () => undefined,
): Promise<KetQuaXepLuoi> {
  if (ds.length === 0) return { daXep: 0, qua: 0 };
  const soO =
    yeuCau === undefined
      ? Math.max(1, Math.min(ds.length, TOI_DA_O))
      : Math.max(1, yeuCau.cot * yeuCau.dong);

  for (const t of ds) {
    if (!dangOPanel(t)) continue;
    t.show(true);
    await cho(() => vscode.window.activeTerminal === t);
    await nghi(NHIP_UI_MS);
    await chay('workbench.action.terminal.moveToEditor');
    await nghi(NHIP_UI_MS);
  }

  await gopVeMotNhom();
  await cho(() => soNhom() === 1);

  const bc = yeuCau === undefined ? boCucLuoi(soO) : boCucTuCotDong(yeuCau.cot, yeuCau.dong);
  await chay('vscode.setEditorLayout', bc);
  await cho(() => soNhom() >= soO);
  ghiLog(`[luoi] dựng ${soNhom()} ô cho ${ds.length} terminal`);

  for (let k = 1; k < soO; k++) {
    await focusNhom(0);
    await nghi(NHIP_NHO_MS);
    const nhom1 = vscode.window.tabGroups.all[0];
    if (nhom1 === undefined) break;
    // Dời nốt tab cuối của nhóm 1 là làm nó rỗng → VS Code đóng nhóm → lưới mất một ô.
    if (nhom1.tabs.length <= 1 || demTermTrongNhom(nhom1) <= 1) {
      ghiLog(`[luoi] hết terminal để rải ở ô ${k + 1} (nhóm 1 còn ${nhom1.tabs.length} tab)`);
      break;
    }
    if (!(await xoayToiTabTerminal(nhom1))) break;
    const truoc = soNhomCoTerminal();
    for (let b = 0; b < k; b++) {
      await chay('workbench.action.moveEditorToNextGroup');
      await nghi(NHIP_NHO_MS);
    }
    await cho(() => soNhomCoTerminal() > truoc);
    if (soNhomCoTerminal() === truoc) {
      ghiLog(`[luoi] ô ${k + 1}: dời tab không ăn thua, dừng lại`);
      break;
    }
  }

  const coTerm = soNhomCoTerminal();
  ghiLog(`[luoi] kết quả: ${coTerm} ô có terminal / ${soNhom()} ô`);
  const daXep = Math.min(coTerm, ds.length);
  return { daXep, qua: ds.length - daXep };
}
