import * as vscode from 'vscode';
import { boCucLuoi, TOI_DA_O } from './luoi';

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

/**
 * Tab đang active có đúng là tab của terminal này không.
 *
 * Phải kiểm tới mức TAB chứ không dừng ở `activeTerminal`: lệnh dời tab tác động lên tab
 * đang active, nên nếu nhóm đó đang hiện một file thì cú dời ném file của người dùng sang ô
 * khác. Đúng chuyện này đã xảy ra trong test — một tab Untitled bị kéo vào lưới.
 *
 * KHÔNG so tên tab: nhãn tab terminal do VS Code tự đặt (có thể kèm tên shell, hoặc còn rỗng
 * khi terminal chưa khởi động xong), nên so tên sinh ra toàn báo động giả và terminal bị bỏ
 * qua oan. Cặp "terminal đang focus là `t`" + "tab đang active là MỘT tab terminal" đã đủ:
 * VS Code đồng bộ hai thứ đó với nhau. Nếu lệch, cái giá là ô trong lưới xếp sai thứ tự —
 * còn thứ phải chặn bằng mọi giá, là dời nhầm tab KHÔNG PHẢI terminal, thì vẫn chặn được.
 */
function tabDungLaCua(t: vscode.Terminal): boolean {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return vscode.window.activeTerminal === t && tab?.input instanceof vscode.TabInputTerminal;
}

/**
 * Hiện terminal rồi CHỜ tới khi tab của nó thật sự là tab đang active.
 *
 * Bắt buộc phải chờ: `show()` chỉ gửi yêu cầu, còn các lệnh dời tab bên dưới tác động lên
 * tab ĐANG active — bắn lệnh ngay sau `show()` là dời nhầm tab.
 *
 * Trả `false` nếu chờ mãi không được; bên gọi phải bỏ qua terminal đó. Thiếu một ô trong
 * lưới là chuyện nhìn thấy ngay và bấm lại được; dời nhầm tab của người dùng thì không.
 */
async function hienVaCho(t: vscode.Terminal): Promise<boolean> {
  t.show(true);
  await cho(() => vscode.window.activeTerminal === t);
  // `activeTerminal` đổi sớm hơn tab trong vùng editor: đo được cảnh focus đã sang terminal
  // mới mà `activeTabGroup` vẫn còn trỏ nhóm cũ, và lệnh dời tab ngay lúc đó dời nhầm tab.
  await nghi(NHIP_UI_MS);
  if (tabDungLaCua(t)) return true;
  // Gọi lại show(): lần đầu có thể rơi trúng lúc VS Code đang dở một thao tác bố cục khác.
  await cho(() => {
    t.show(true);
    return tabDungLaCua(t);
  });
  return tabDungLaCua(t);
}

const nghi = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const NHIP_UI_MS = 300;

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

/**
 * Xếp các terminal thành lưới, theo đúng thứ tự truyền vào: ô 1 là cái đầu tiên, rồi xuống
 * dưới trong cùng cột, hết cột mới sang cột phải.
 *
 * Thứ tự thao tác là điều quan trọng nhất ở đây, và nó đi ngược trực giác: **rải ra từng
 * nhóm trước, dựng lưới sau**. Cách thuận tay hơn — dựng sẵn N ô rồi dời tab vào — không
 * chạy được: đo trên VS Code 1.142 thì mỗi lần dời tab, một ô RỖNG lại bị đóng, nên lưới cứ
 * teo dần trong lúc ta đang rải (4 ô → 3 → 2). Ngược lại, dời tab sang "nhóm kế tiếp" khi
 * đang ở nhóm cuối thì VS Code TẠO nhóm mới — xây dần theo cách đó thì mọi nhóm luôn có tab
 * nên không cái nào bị đóng, và `setEditorLayout` ở bước cuối chỉ việc sắp N nhóm sẵn có
 * thành lưới.
 *
 * Terminal đầu tiên ở lại nhóm 1 cùng mọi tab file đang mở — chừa lại ít nhất một tab ở đó
 * vì cùng lý do trên.
 */
export async function xepLuoiTerminal(ds: readonly vscode.Terminal[]): Promise<KetQuaXepLuoi> {
  const lay = ds.slice(0, TOI_DA_O);
  if (lay.length === 0) return { daXep: 0, qua: ds.length };

  for (const t of lay) {
    if (!dangOPanel(t)) continue;
    // Ở panel thì chưa có tab nào để so, chỉ cần nó là terminal đang focus.
    t.show(true);
    await cho(() => vscode.window.activeTerminal === t);
    await nghi(NHIP_UI_MS);
    await chay('workbench.action.terminal.moveToEditor');
  }

  await gopVeMotNhom();
  await cho(() => soNhom() === 1);
  if (lay.length === 1) {
    await hienVaCho(lay[0] as vscode.Terminal);
    return { daXep: 1, qua: ds.length - 1 };
  }

  let daRa = 1; // terminal đầu tiên ở lại nhóm 1
  for (let i = 1; i < lay.length; i++) {
    // Kéo focus về nhóm 1 TRƯỚC: mọi tab chưa rải đều nằm ở đó, và `show()` của một terminal
    // ở nhóm khác với nhóm đang focus không phải lúc nào cũng kéo được focus sang.
    await chay('workbench.action.focusFirstEditorGroup');
    await nghi(NHIP_UI_MS);
    // Không chắc tab đang active là của nó thì BỎ QUA: dời đại là ném tab file của người
    // dùng sang ô khác.
    if (!(await hienVaCho(lay[i] as vscode.Terminal))) continue;
    // Sang nhóm cuối rồi "sang nhóm kế tiếp" một lần nữa: bước thứ hai là bước tạo ra nhóm
    // mới. Không gộp được thành một lệnh vì không có lệnh "dời sang nhóm mới ở cuối".
    const truoc = soNhom();
    await chay('workbench.action.moveEditorToLastGroup');
    await nghi(NHIP_UI_MS);
    await chay('workbench.action.moveEditorToNextGroup');
    await cho(() => soNhom() > truoc);
    daRa += 1;
  }

  // Đếm ô THẬT SỰ có terminal thay vì tin vào số lần đã dời: bố cục cập nhật không đồng bộ,
  // và một ô trống trong lưới là chỗ người dùng tưởng có terminal mà không có.
  await cho(() => soNhomCoTerminal() >= daRa);
  const soO = Math.max(1, Math.min(lay.length, soNhomCoTerminal()));
  await chay('vscode.setEditorLayout', boCucLuoi(soO));
  await hienVaCho(lay[0] as vscode.Terminal);
  return { daXep: soO, qua: ds.length - soO };
}
