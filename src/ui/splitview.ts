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

/**
 * Số tab terminal đang nằm trong vùng editor.
 *
 * Đây là thước đo DUY NHẤT đáng tin cho câu hỏi "terminal đang ở đâu". Bản trước hỏi
 * `creationOptions.location` — ảnh chụp lúc TẠO — rồi quyết định có dời hay không. Sai, vì
 * chính extension này dời terminal qua lại panel↔editor sau đó: lệnh ẩn đẩy terminal của
 * workspace khác xuống panel, nên lần sau xếp lưới cho chính workspace đó thì nó vẫn khai
 * "editor" trong khi đang nằm dưới panel, và không bao giờ được kéo lên nữa. Đo được
 * 24/10/2026: 5 terminal mà chỉ 2 cái vào lưới, ba ô còn lại rỗng với lý do "hết terminal
 * để rải".
 */
const soTabTerminal = (): number =>
  vscode.window.tabGroups.all.reduce(
    (n, g) => n + g.tabs.filter((t) => t.input instanceof vscode.TabInputTerminal).length,
    0,
  );

/** Hạn chờ cho thao tác CÓ THỂ không xảy ra (dời một terminal vốn đã đúng chỗ là lệnh rỗng). */
const HAN_CHO_NGAN_MS = 700;

/**
 * Vét MỌI tab terminal khỏi vùng editor xuống panel; trả về đúng những cái đã bị đẩy.
 *
 * Vì sao phải vét sạch rồi kéo lại, thay vì chỉ kéo cái còn thiếu lên:
 * `workbench.action.terminal.moveToEditor` KHÔNG làm việc trên `window.activeTerminal` mà
 * trên terminal đang active CỦA PANEL — đo được 24/10/2026: `show()` một terminal đang ở
 * vùng editor rồi gọi lệnh đó thì VS Code lôi nhầm một terminal khác dưới panel lên. Nên
 * không có cách nào an toàn để "kéo lên nếu nó đang ở dưới" khi chưa biết chắc nó ở đâu —
 * mà không API nào nói điều đó: `creationOptions.location` chỉ là ảnh chụp lúc TẠO, sai
 * ngay khi chính extension dời terminal qua lại (lệnh ẩn của lưới làm đúng việc đó).
 *
 * Vét xong thì vùng editor sạch bóng terminal, nên `show()` + `moveToEditor` cho từng cái
 * là xác định. Được thêm hai thứ: thứ tự ô bám đúng thứ tự cây, và mọi tab terminal còn lại
 * trong editor chắc chắn thuộc về lưới — hết cửa ném nhầm tab của người khác.
 *
 * Nhận diện cái vừa bị đẩy bằng `window.activeTerminal` NGAY SAU lệnh (đo được: VS Code để
 * chính nó làm active). KHÔNG dùng nhãn tab — nhãn có lúc là tên tiến trình, có lúc rỗng.
 */
/**
 * Đẩy MỘT tab terminal của vùng editor xuống panel. Thử lại tối đa ba lần, nghỉ dài dần.
 *
 * Vì sao phải thử lại: `moveToTerminalPanel` chỉ ăn khi vùng EDITOR đang giữ focus, mà focus
 * chuyển không đồng bộ và không API nào cho đọc trạng thái đó. Ngay sau một lần đẩy thành
 * công thì focus đang nằm ở panel (terminal vừa rơi xuống đó), nên lượt kế tiếp dễ ra lệnh
 * vào quãng trống — đo được trong bộ test: vét dừng giữa chừng dù tab đang hiện đúng là tab
 * terminal. Mỗi lần thử đều tự kiểm bằng số tab nên thử lại không bao giờ đẩy dư.
 */
async function dayMotTabXuongPanel(truoc: number, ghiLog: (d: string) => void): Promise<boolean> {
  for (let lan = 0; lan < 3; lan++) {
    await chay('workbench.action.focusActiveEditorGroup');
    await nghi(NHIP_UI_MS * (lan + 1));
    if (!(await xoayToiTabTerminal(vscode.window.tabGroups.activeTabGroup))) {
      ghiLog(`[luoi] còn ${truoc} tab terminal trong editor nhưng không xoay tới được`);
      return false;
    }
    await chay('workbench.action.terminal.moveToTerminalPanel');
    await cho(() => soTabTerminal() < truoc, lan === 2 ? HAN_CHO_MS : HAN_CHO_NGAN_MS);
    if (soTabTerminal() < truoc) return true;
    // Lần sau thử một tab terminal KHÁC: cố mãi vào đúng một tab là cách chắc chắn nhất để
    // kẹt vĩnh viễn nếu riêng nó không chịu dời (tiến trình đã chết, tab hỏng…).
    await chay('workbench.action.nextEditorInGroup');
    await nghi(NHIP_NHO_MS);
  }
  ghiLog(`[luoi] không đẩy được tab terminal xuống panel (còn ${truoc} tab)`);
  return false;
}

async function donTerminalKhoiEditor(ghiLog: (d: string) => void): Promise<vscode.Terminal[]> {
  const daDay: vscode.Terminal[] = [];
  const toiDa = soTabTerminal() + 1;
  for (let i = 0; i < toiDa; i++) {
    const truoc = soTabTerminal();
    if (truoc === 0) break;
    if (!(await dayMotTabXuongPanel(truoc, ghiLog))) break;
    await nghi(NHIP_UI_MS);

    const vua = vscode.window.activeTerminal;
    if (vua !== undefined) daDay.push(vua);
  }
  return daDay;
}

/**
 * Kéo đúng những terminal này lên vùng editor, THEO ĐÚNG THỨ TỰ truyền vào.
 *
 * Chỉ đúng khi vùng editor đã sạch terminal (xem `donTerminalKhoiEditor`) — bên gọi phải
 * bảo đảm điều đó. Mỗi bước tự xác nhận: số tab tăng VÀ `window.activeTerminal` chính là nó.
 * Trả về lý do đầu tiên khiến một cái không lên được, `undefined` nếu trọn vẹn.
 */
async function keoLenTheoThuTu(
  ds: readonly vscode.Terminal[],
  ghiLog: (d: string) => void,
): Promise<string | undefined> {
  let lyDo: string | undefined;
  const ghiMot = (d: string): void => {
    lyDo ??= d;
    ghiLog(`[luoi] ${d}`);
  };
  for (const t of ds) {
    if (t.exitStatus !== undefined) {
      ghiMot(`"${t.name}" đã thoát nên không kéo lên được`);
      continue;
    }
    // Thử lại như bên vét, và vì cùng một lý do: lệnh workbench chỉ ăn khi đúng vùng đang
    // giữ focus, mà focus thì chuyển không đồng bộ. Mỗi lần thử tự kiểm bằng số tab nên thử
    // lại không kéo dư cái nào.
    let len = false;
    for (let lan = 0; lan < 3 && !len; lan++) {
      const truoc = soTabTerminal();
      try {
        t.show(true);
        await cho(() => vscode.window.activeTerminal === t);
        await nghi(NHIP_UI_MS * (lan + 1));
        await chay('workbench.action.terminal.moveToEditor');
      } catch {
        ghiMot(`không kéo được "${t.name}" lên vùng editor`);
        break;
      }
      await cho(() => soTabTerminal() > truoc, lan === 2 ? HAN_CHO_MS : HAN_CHO_NGAN_MS);
      len = soTabTerminal() > truoc;
    }
    if (!len) {
      ghiMot(`"${t.name}" không lên được vùng editor`);
    }
    await nghi(NHIP_UI_MS);
    // Đối chiếu danh tính CHỈ để ghi log, không coi là lý do hỏng: ngay sau khi một terminal
    // rời panel thì `window.activeTerminal` còn bám theo panel một nhịp, nên nó hay báo cái
    // kế tiếp (đo được: kéo "nam-0" mà đọc ra "nam-1" trong khi cả 5 cái vẫn lên đúng thứ
    // tự). Bằng chứng thật là số tab tăng — vùng editor đã sạch nên cái lên chỉ có thể là nó.
    if (vscode.window.activeTerminal !== t) {
      ghiLog(
        `[luoi] kéo "${t.name}", active ngay sau đó là ` +
          `"${vscode.window.activeTerminal?.name ?? 'không có'}"`,
      );
    }
  }
  return lyDo;
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
    // Chờ trên ĐÚNG ĐIỀU KIỆN mình cần, không nghỉ một nhịp cố định rồi đọc: máy đang tải thì
    // đọc phải giá trị cũ, hàm trả `true` nhầm và lệnh dời ngay sau đó tác động lên tab FILE.
    // Cũng KHÔNG so định danh object tab — `activeTabGroup` có thể trả object mới mỗi lần
    // đọc, khi đó điều kiện đúng tức thì và nhịp chờ coi như bị bỏ.
    await cho(
      () =>
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal,
      HAN_XOAY_MS,
    );
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

  // KHÔNG đoán trước terminal đang ở panel hay editor rồi bỏ qua. Mọi nguồn đoán đều là
  // ảnh chụp lúc TẠO, mà cả lưới lẫn lệnh ẩn đều dời terminal qua lại panel↔editor sau đó —
  // đúng cái terminal cần xoay tab nhất (sinh ở panel rồi bị kéo vào lưới) lại là cái bị
  // ảnh chụp đó loại ra. Đo được trong Extension Host: với terminal như vậy `show()` KHÔNG
  // kéo nổi tab của nó lên trước.
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
    // Không đoán `t` đang ở đâu: cứ ra lệnh kéo lên rồi kiểm. Lệnh này làm việc trên
    // terminal active CỦA PANEL, nên khi `t` vốn đã ở vùng editor nó sẽ lôi nhầm một cái
    // dưới panel lên — thấy vậy thì trả ngay cái đó về panel.
    const truocTab = soTabTerminal();
    t.show(true);
    await cho(() => vscode.window.activeTerminal === t);
    await nghi(NHIP_UI_MS);
    await chay('workbench.action.terminal.moveToEditor');
    await cho(() => soTabTerminal() > truocTab, HAN_CHO_NGAN_MS);
    if (soTabTerminal() > truocTab && vscode.window.activeTerminal !== t) {
      ghiLog(`[luoi] lôi nhầm "${vscode.window.activeTerminal?.name ?? '?'}" lên, trả về panel`);
      await chay('workbench.action.terminal.moveToTerminalPanel');
      await cho(() => soTabTerminal() <= truocTab, HAN_CHO_NGAN_MS);
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
  if (ds.length === 0) return { daXep: 0, qua: 0, daAn: 0 };
  const soO =
    yeuCau === undefined
      ? Math.max(1, Math.min(ds.length, TOI_DA_O))
      : Math.max(1, yeuCau.cot * yeuCau.dong);

  // Gom về một nhóm TRƯỚC mọi thứ: cả vét lẫn kéo lên đều làm việc trên nhóm đang focus.
  await gopVeMotNhom();
  await cho(() => soNhom() === 1);

  // Vét sạch rồi kéo lại đúng cái mình cần — xem `donTerminalKhoiEditor` để biết vì sao
  // không thể chỉ "kéo cái còn thiếu lên".
  let lyDo: string | undefined;
  const giu = new Set(ds);
  const daAn = (await donTerminalKhoiEditor(ghiLog)).filter((t) => !giu.has(t)).length;
  if (daAn > 0) ghiLog(`[luoi] đã đưa ${daAn} terminal không thuộc lưới xuống panel`);
  if (soTabTerminal() > 0) {
    lyDo = `vùng editor còn ${soTabTerminal()} tab terminal không dọn được`;
    ghiLog(`[luoi] ${lyDo}`);
  } else {
    lyDo = await keoLenTheoThuTu(ds, ghiLog);
  }
  // Gom LẠI: vét có thể đóng nhóm rỗng, kéo lên có thể mở nhóm mới — đo được 24/10/2026 là
  // sau hai pha đó tab nằm ở nhóm 2,3,4 còn nhóm 1 rỗng, nên vòng rải thấy "nhóm 1 còn 0
  // tab" rồi dừng ngay. Pha rải chỉ đúng khi xuất phát từ ĐÚNG MỘT nhóm giữ mọi tab.
  await gopVeMotNhom();
  await cho(() => soNhom() === 1);
  ghiLog(`[luoi] trước khi dựng ô: ${moTaBoCuc()}`);

  const bc = yeuCau === undefined ? boCucLuoi(soO) : boCucTuCotDong(yeuCau.cot, yeuCau.dong);
  await chay('vscode.setEditorLayout', bc);
  await cho(() => soNhom() >= soO);
  ghiLog(`[luoi] dựng ${soNhom()} ô cho ${ds.length} terminal`);

  // Mỗi lối thoát dưới đây PHẢI đặt `lyDo`. Trước đây hai lối lặng thinh (`nhom1` rỗng và
  // xoay tab thất bại) nên có lần lưới thiếu ô mà cả Output lẫn thông báo đều không nói được
  // vì sao — người dùng báo đúng chuyện đó ngày 20/10/2026.
  let lyDoRai: string | undefined;
  for (let k = 1; k < soO; k++) {
    await focusNhom(0);
    await nghi(NHIP_NHO_MS);
    const nhom1 = vscode.window.tabGroups.all[0];
    if (nhom1 === undefined) {
      lyDoRai = `dừng ở ô ${k + 1}: không đọc được nhóm editor nào`;
      break;
    }
    // Dời nốt tab cuối của nhóm 1 là làm nó rỗng → VS Code đóng nhóm → lưới mất một ô.
    if (nhom1.tabs.length <= 1 || demTermTrongNhom(nhom1) <= 1) {
      lyDoRai = `dừng ở ô ${k + 1}: hết terminal để rải (nhóm 1 còn ${nhom1.tabs.length} tab)`;
      break;
    }
    if (!(await xoayToiTabTerminal(nhom1))) {
      lyDoRai = `dừng ở ô ${k + 1}: không xoay được tới tab terminal nào trong nhóm 1`;
      break;
    }
    const truoc = soNhomCoTerminal();
    for (let b = 0; b < k; b++) {
      await chay('workbench.action.moveEditorToNextGroup');
      await nghi(NHIP_NHO_MS);
    }
    await cho(() => soNhomCoTerminal() > truoc);
    if (soNhomCoTerminal() === truoc) {
      lyDoRai = `dừng ở ô ${k + 1}: VS Code không nhận lệnh dời tab sang ô kế`;
      break;
    }
  }
  if (lyDoRai !== undefined) ghiLog(`[luoi] ${lyDoRai}`);
  lyDo ??= lyDoRai;

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
