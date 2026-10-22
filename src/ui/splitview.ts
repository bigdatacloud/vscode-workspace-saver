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
  /** Số terminal KHÔNG thuộc lưới đã được đẩy xuống panel để không chiếm ô. */
  daAn: number;
  /**
   * Vì sao lưới dừng khi chưa đủ ô — `undefined` nghĩa là rải trọn vẹn.
   *
   * Phải đi theo kết quả về tới THÔNG BÁO chứ không chỉ nằm trong Output: bảo người dùng
   * "xem kênh Output" là cách chắc chắn nhất khiến không ai đọc.
   */
  lyDo?: string;
}

/** Bố cục hiện tại dạng `#col:tab1,tab2 | ...` — để log nói được chuyện gì đang xảy ra. */
const moTaBoCuc = (): string =>
  vscode.window.tabGroups.all
    .map((g) => `#${g.viewColumn}:${g.tabs.map((x) => x.label).join(',')}`)
    .join(' | ');

const chay = async (lenh: string, ...args: unknown[]): Promise<void> => {
  await vscode.commands.executeCommand(lenh, ...args);
};

const HAN_CHO_MS = 3000;

/** Chờ một điều kiện về bố cục editor — các lệnh workbench cập nhật UI không đồng bộ. */
async function cho(dieuKien: () => boolean, hanMs = HAN_CHO_MS): Promise<void> {
  const het = Date.now() + hanMs;
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

/** Terminal không khai `location` thì VS Code mở nó ở đâu — theo setting của người dùng. */
function macDinhMoOEditor(): boolean {
  return (
    vscode.workspace
      .getConfiguration('terminal.integrated')
      .get<string>('defaultLocation', 'view') === 'editor'
  );
}

/**
 * Terminal này đang nằm ở panel dưới (chứ không phải vùng editor)?
 *
 * Đọc `creationOptions.location` thay vì dò tab đang active: dò tab chỉ đúng khi terminal
 * đang được focus, mà giữa chừng vòng lặp thì không có gì bảo đảm điều đó.
 *
 * Terminal người dùng tự mở (Ctrl+`) KHÔNG khai `location`. Bản trước coi đó là panel —
 * sai, vì nơi nó rơi vào do setting `terminal.integrated.defaultLocation` quyết định. Máy
 * nào đặt setting đó là `editor` thì mọi terminal tự mở đều nằm trong vùng editor mà hàm này
 * vẫn báo "đang ở panel", nên lệnh ẩn bỏ qua nó và nó chiếm mất một ô của lưới — đúng ca
 * người dùng gặp ngày 22/10/2026 (tab "pwsh" lọt vào lưới của workspace "Working").
 */
function dangOPanel(t: vscode.Terminal): boolean {
  const loc = (t.creationOptions as { location?: unknown }).location;
  if (loc === undefined) return !macDinhMoOEditor();
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

/** Hạn chờ sau `show()`: đây là đường đi của một CÚ BẤM nên không được đứng hình vài giây. */
const HAN_SHOW_MS = 600;
/** Hạn chờ cho MỖI bước xoay tab; `cho()` thoát ngay khi đúng nên đây chỉ là trần. */
const HAN_XOAY_MS = 400;

/**
 * Đưa một terminal lên trước mặt người dùng — bấm vào nó trong cây thì chính nó phải active.
 *
 * `terminal.show()` đủ cho terminal ở panel, nhưng với terminal sống dưới dạng tab editor thì
 * không chắc kéo được tab của nó lên active — đúng cái bẫy đã làm lưới bỏ sót terminal (xem
 * ghi chú 3 ở `xepLuoiTerminal`). Người dùng thấy nó thế này: thoát lưới xong, mọi terminal
 * chồng thành tab trong MỘT nhóm, bấm cái đang hiện thì có phản ứng, bấm cái khác thì im lặng.
 *
 * Nên sau `show()` phải KIỂM lại, chưa tới thì xoay tab trong từng nhóm cho tới khi gặp. Vòng
 * trong chạy đúng bằng số tab của nhóm, nên nhóm nào không chứa nó thì quay về tab cũ.
 *
 * @returns `true` khi terminal đã thật sự thành `window.activeTerminal`.
 */
export async function hienTerminal(
  t: vscode.Terminal,
  ghiLog: (d: string) => void = () => undefined,
): Promise<boolean> {
  if (t.exitStatus !== undefined) return false;
  /**
   * Đã tới nơi chưa?
   *
   * `activeTerminal` là bằng chứng mạnh nhưng KHÔNG đủ: khi panel và vùng editor cùng có
   * terminal, nó báo cái của panel ngay cả lúc tab editor đang hiện cái khác (đo được:
   * tab="doi-d" mà `activeTerminal`="doi-c" nằm dưới panel). Nên nhận thêm bằng chứng từ
   * tab đang hiện. Giá phải trả: nhận diện bằng NHÃN, nên hai terminal trùng tên thì có thể
   * dừng ở nhầm cái — chấp nhận được vì nhánh này chỉ chạy khi `show()` đã thất bại.
   */
  const dungNo = (): boolean => {
    if (vscode.window.activeTerminal === t) return true;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.input instanceof vscode.TabInputTerminal && tab.label === t.name;
  };
  try {
    t.show(false);
  } catch {
    // `window.terminals` còn liệt kê terminal vừa đóng thêm một nhịp; show() lên nó thì ném.
    ghiLog(`[hien] "${t.name}" đã đóng, không hiện được`);
    return false;
  }
  await cho(dungNo, HAN_SHOW_MS);
  if (dungNo()) return true;

  // KHÔNG lọc theo `dangOPanel` ở đây. Đó là ảnh chụp lúc TẠO, mà cả lưới lẫn lệnh ẩn đều
  // dời terminal qua lại panel↔editor sau đó — đúng cái terminal cần xoay tab nhất (sinh ở
  // panel rồi bị kéo vào lưới) lại là cái bị ảnh chụp đó loại ra. Đo được trong Extension
  // Host: với terminal như vậy `show()` KHÔNG kéo nổi tab của nó lên trước.
  // Xoay oan một terminal đang thật sự ở panel thì vô hại: mỗi nhóm quay trọn một vòng nên
  // tab cũ trở lại đúng chỗ, và hàm vẫn trả `false`.
  ghiLog(`[hien] show() chưa kéo "${t.name}" lên active — xoay tab trong vùng editor`);
  const nhom = vscode.window.tabGroups.all.length;
  for (let g = 0; g < nhom; g++) {
    await focusNhom(g);
    await cho(dungNo, HAN_XOAY_MS);
    if (dungNo()) return true;
    const soTab = vscode.window.tabGroups.activeTabGroup.tabs.length;
    for (let i = 0; i < soTab; i++) {
      await chay('workbench.action.nextEditorInGroup');
      // Phải CHỜ chứ không nghỉ một nhịp cố định: `activeTerminal` cập nhật sau khi tab đổi
      // một quãng không đoán được, và kiểm sớm thì đọc phải giá trị cũ — đo được trong
      // Extension Host là 90 ms không đủ, vòng xoay đi lướt qua đúng tab cần tìm.
      await cho(dungNo, HAN_XOAY_MS);
      if (dungNo()) return true;
    }
  }
  const moTa = moTaBoCuc();
  ghiLog(
    `[hien] không tìm thấy tab của "${t.name}" — tab đang hiện: ` +
      `"${vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? 'không có'}", ` +
      `terminal active: "${vscode.window.activeTerminal?.name ?? 'không có'}", bố cục: ${moTa}`,
  );
  return false;
}

/**
 * Thêm MỘT terminal vào lưới đang có, bằng cách dựng thêm một ô cho riêng nó.
 *
 * Vì sao cần: mở một terminal mới trong lúc đang xem song song thì VS Code đặt nó vào nhóm
 * đang active — nó thành tab thứ hai của một ô, nằm đè lên terminal đang ở đó, nên người
 * dùng "không thấy nó đâu". Xếp lại cả lưới chỉ vì thêm một cái là thừa (và làm nhấp nháy
 * mọi ô), nên ở đây chỉ nới lưới ra đúng một ô rồi đẩy nó sang.
 *
 * Trả `false` khi không chắc tab đang active là của terminal này — thà không thêm còn hơn
 * ném nhầm tab khác (kể cả tab file) sang ô mới.
 */
export async function themOVaoLuoi(
  t: vscode.Terminal,
  ghiLog: (d: string) => void = () => undefined,
): Promise<boolean> {
  if (t.exitStatus !== undefined) return false;
  try {
    if (dangOPanel(t)) {
      t.show(true);
      await cho(() => vscode.window.activeTerminal === t);
      await nghi(NHIP_UI_MS);
      await chay('workbench.action.terminal.moveToEditor');
      await nghi(NHIP_UI_MS);
    }
    t.show(true);
    await cho(
      () =>
        vscode.window.activeTerminal === t &&
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal,
    );
    if (
      vscode.window.activeTerminal !== t ||
      !(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal)
    ) {
      ghiLog(`[luoi] không chắc tab đang mở là của "${t.name}", không thêm ô`);
      return false;
    }

    const truoc = soNhom();
    if (truoc >= TOI_DA_O) {
      ghiLog(`[luoi] lưới đã ${truoc} ô, không nới thêm`);
      return false;
    }
    // Nới lưới TRƯỚC rồi mới dời: ô mới phải tồn tại sẵn, vì dời sang "nhóm kế tiếp" khi
    // chưa có nhóm nào ở đó không phải lúc nào cũng tạo ra nhóm (xem ghi chú ở xepLuoiTerminal).
    await chay('vscode.setEditorLayout', boCucLuoi(truoc + 1));
    await cho(() => soNhom() > truoc);
    await nghi(NHIP_UI_MS);
    await chay('workbench.action.moveEditorToLastGroup');
    await cho(() => soNhomCoTerminal() >= Math.min(truoc + 1, soNhom()));
    ghiLog(`[luoi] đã thêm "${t.name}" vào ô thứ ${soNhom()}`);
    return true;
  } catch {
    ghiLog(`[luoi] không thêm được "${t.name}" vào lưới`);
    return false;
  }
}

/**
 * Đẩy mọi terminal KHÔNG thuộc lưới ra khỏi vùng editor, xuống panel dưới.
 *
 * Lưới là của MỘT workspace: terminal của workspace khác (hay cái người dùng tự mở) nằm lẫn
 * trong đó thì mỗi ô một nơi khác nhau, và chính những tab lạ ấy chiếm mất ô của terminal
 * đáng ra phải vào lưới.
 *
 * ẨN, không đóng: `moveToTerminalPanel` dời tiến trình xuống panel, pty giữ nguyên — phiên
 * agent trong đó vẫn chạy, bấm vào panel là thấy lại. Đóng chúng đi là giết phiên của người
 * khác vì một thao tác bố cục của ta.
 *
 * Tab FILE thì không đụng: vùng editor là của chung, và đóng một file chưa lưu thì không có
 * đường lùi. Chúng ở lại ô đầu tiên.
 */
async function anTerminalNgoaiLuoi(
  canAn: readonly vscode.Terminal[],
  trongLuoi: readonly vscode.Terminal[],
  ghiLog: (d: string) => void,
): Promise<number> {
  const giu = new Set(trongLuoi);
  const song = new Set(vscode.window.terminals);
  // Quét cả `window.terminals` chứ không chỉ danh sách bên gọi đưa: terminal người dùng tự
  // mở không thuộc workspace nào nên bên gọi không thể biết nó tồn tại, mà nó vẫn chiếm một
  // ô của lưới. Mối nguy "chạm vào terminal đã chết thì ném" được chặn ngay dưới bằng
  // `exitStatus` và `try` quanh `show()` — hai lớp đó có sau cái ghi chú cũ cấm quét.
  const ungVien = new Set<vscode.Terminal>([...canAn, ...song]);
  let da = 0;
  for (const t of ungVien) {
    if (giu.has(t) || dangOPanel(t)) continue;
    // Tiến trình đã thoát thì không còn gì để ẩn.
    if (t.exitStatus !== undefined || !song.has(t)) continue;
    try {
      // `show()` nằm TRONG try: danh sách terminal của VS Code vẫn liệt kê cái vừa bị đóng
      // (cập nhật bất đồng bộ), và gọi show() lên nó ném "Terminal has already been
      // disposed" — ném ở đây là hỏng cả lượt xếp lưới vì một terminal không liên quan.
      t.show(true);
      await cho(() => vscode.window.activeTerminal === t);
      await nghi(NHIP_UI_MS);
      await chay('workbench.action.terminal.moveToTerminalPanel');
    } catch {
      ghiLog(`[luoi] không ẩn được terminal "${t.name}"`);
      continue;
    }
    await nghi(NHIP_UI_MS);
    da += 1;
  }
  if (da > 0) {
    // Ẩn xong thì focus đang nằm ở PANEL (terminal vừa bị dời xuống đó). Vòng rải bên dưới
    // ra lệnh lên tab đang active của vùng editor, mà khi focus ở panel thì lệnh xoay tab
    // không ăn — hậu quả đo được: tab file bị ném sang ô thứ hai và cả lưới rải hỏng.
    await chay('workbench.action.focusActiveEditorGroup');
    await nghi(NHIP_UI_MS);
    ghiLog(`[luoi] đã ẩn ${da} terminal ngoài lưới xuống panel`);
  }
  return da;
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
  /**
   * Terminal của workspace KHÁC, do bên gọi (manager) đưa vào từ sổ terminal sống của nó.
   *
   * Danh sách này KHÔNG còn là nguồn duy nhất: hàm ẩn quét thêm `window.terminals` để thấy
   * cả terminal người dùng tự mở. Vẫn giữ tham số vì sổ của manager là nguồn sạch nhất (dọn
   * theo `onDidCloseTerminal`), còn danh sách của VS Code thì có lúc liệt kê cả terminal vừa
   * bị đóng — chạm vào một cái đã chết thì ném lỗi, nên mọi lối chạm đều phải có lưới chắn.
   */
  canAn: readonly vscode.Terminal[] = [],
): Promise<KetQuaXepLuoi> {
  if (ds.length === 0) return { daXep: 0, qua: 0, daAn: 0 };
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

  // Ẩn TRƯỚC khi gom nhóm: gom xong mới ẩn thì những tab lạ đã kịp chen vào ô của lưới.
  const daAn = await anTerminalNgoaiLuoi(canAn, ds, ghiLog);

  await gopVeMotNhom();
  await cho(() => soNhom() === 1);

  const bc = yeuCau === undefined ? boCucLuoi(soO) : boCucTuCotDong(yeuCau.cot, yeuCau.dong);
  await chay('vscode.setEditorLayout', bc);
  await cho(() => soNhom() >= soO);
  ghiLog(`[luoi] dựng ${soNhom()} ô cho ${ds.length} terminal`);

  // Mỗi lối thoát dưới đây PHẢI đặt `lyDo`. Trước đây hai lối lặng thinh (`nhom1` rỗng và
  // xoay tab thất bại) nên có lần lưới thiếu ô mà cả Output lẫn thông báo đều không nói được
  // vì sao — người dùng báo đúng chuyện đó ngày 20/10/2026.
  let lyDo: string | undefined;
  for (let k = 1; k < soO; k++) {
    await focusNhom(0);
    await nghi(NHIP_NHO_MS);
    const nhom1 = vscode.window.tabGroups.all[0];
    if (nhom1 === undefined) {
      lyDo = `dừng ở ô ${k + 1}: không đọc được nhóm editor nào`;
      break;
    }
    // Dời nốt tab cuối của nhóm 1 là làm nó rỗng → VS Code đóng nhóm → lưới mất một ô.
    if (nhom1.tabs.length <= 1 || demTermTrongNhom(nhom1) <= 1) {
      lyDo = `dừng ở ô ${k + 1}: hết terminal để rải (nhóm 1 còn ${nhom1.tabs.length} tab)`;
      break;
    }
    if (!(await xoayToiTabTerminal(nhom1))) {
      lyDo = `dừng ở ô ${k + 1}: không xoay được tới tab terminal nào trong nhóm 1`;
      break;
    }
    const truoc = soNhomCoTerminal();
    for (let b = 0; b < k; b++) {
      await chay('workbench.action.moveEditorToNextGroup');
      await nghi(NHIP_NHO_MS);
    }
    await cho(() => soNhomCoTerminal() > truoc);
    if (soNhomCoTerminal() === truoc) {
      lyDo = `dừng ở ô ${k + 1}: VS Code không nhận lệnh dời tab sang ô kế`;
      break;
    }
  }
  if (lyDo !== undefined) ghiLog(`[luoi] ${lyDo}`);

  const coTerm = soNhomCoTerminal();
  ghiLog(`[luoi] kết quả: ${coTerm} ô có terminal / ${soNhom()} ô`);
  const daXep = Math.min(coTerm, ds.length);
  // Rải trọn lượt mà vẫn thiếu: ô đã dựng rồi lại mất terminal. Không `break` nào xảy ra nên
  // không đặt lý do ở đây là lại im lặng như cũ.
  if (lyDo === undefined && daXep < ds.length) {
    lyDo = `rải hết lượt nhưng chỉ ${coTerm} ô giữ được terminal / ${soNhom()} ô`;
    ghiLog(`[luoi] ${lyDo}`);
  }
  if (daXep < ds.length) ghiLog(`[luoi] bố cục lúc dừng: ${moTaBoCuc()}`);
  return { daXep, qua: ds.length - daXep, daAn, lyDo };
}
