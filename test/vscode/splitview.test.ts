import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { gopVeMotNhom, hienTerminal, themOVaoLuoi, xepLuoiTerminal } from '../../src/ui/splitview';

/**
 * Chạy thật trong Extension Host: ba lệnh workbench mà `splitview.ts` dựa vào
 * (`vscode.setEditorLayout`, `moveEditorToNextGroup`, `terminal.moveToEditor`) đều là lệnh
 * nội bộ của VS Code, không nằm trong API có kiểu — nếu bản VS Code nào đổi tên hoặc đổi
 * hành vi thì phải vỡ ở đây, chứ không phải lúc người dùng bấm.
 */

const doi = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng (bố cục editor cập nhật không đồng bộ) hoặc hết hạn. */
async function cho(dieuKien: () => boolean, hanMs = 6000): Promise<void> {
  const het = Date.now() + hanMs;
  while (Date.now() < het) {
    if (dieuKien()) return;
    await doi(100);
  }
}

const soNhom = (): number => vscode.window.tabGroups.all.length;

const soNhomCoTerminal = (): number =>
  vscode.window.tabGroups.all.filter((g) =>
    g.tabs.some((t) => t.input instanceof vscode.TabInputTerminal),
  ).length;

const tabTerminal = (): number =>
  vscode.window.tabGroups.all.reduce(
    (t, g) => t + g.tabs.filter((x) => x.input instanceof vscode.TabInputTerminal).length,
    0,
  );

/**
 * Mỗi nhóm chứa đúng MỘT tab terminal.
 *
 * Không đòi mỗi nhóm đúng một tab: tab file đang mở ở lại nhóm 1 theo đúng thiết kế — vùng
 * editor là của chung, extension không có quyền đuổi tab của người dùng đi đâu cả.
 */
const moiNhomMotTerminal = (): boolean =>
  vscode.window.tabGroups.all.every(
    (g) => g.tabs.filter((t) => t.input instanceof vscode.TabInputTerminal).length === 1,
  );

/**
 * Mọi ô ĐANG HIỆN một tab terminal.
 *
 * Khác `moiNhomMotTerminal` ở chỗ nó hỏi ô đang hiện CÁI GÌ, không phải ô có chứa gì. Ô vừa
 * chứa terminal vừa chứa tab file mà đang hiện tab file thì người dùng nhìn thấy một ô rỗng —
 * đúng cái họ báo 26/10/2026. Ô không có tab nào (lưới tự khai thừa ô) không tính.
 */
const moiOHienTerminal = (): boolean =>
  vscode.window.tabGroups.all
    .filter((g) => g.tabs.length > 0)
    .every((g) => g.activeTab?.input instanceof vscode.TabInputTerminal);

/** Mỗi ô đang hiện tab nào — để thông báo lỗi chỉ thẳng ra ô sai. */
const moTaHien = (): string =>
  JSON.stringify(
    vscode.window.tabGroups.all.map((g) => ({
      col: g.viewColumn,
      hien: `${g.activeTab?.label ?? 'trống'}|${
        g.activeTab?.input instanceof vscode.TabInputTerminal ? 'term' : 'khac'
      }`,
    })),
  );

/** Mô tả bố cục để thông báo lỗi nói được chuyện gì đã xảy ra. */
const moTaNhom = (): string =>
  JSON.stringify(
    vscode.window.tabGroups.all.map((g) => ({
      col: g.viewColumn,
      tabs: g.tabs.map((t) => `${t.label}|${t.input instanceof vscode.TabInputTerminal ? 'term' : 'khac'}`),
    })),
  );

/**
 * Vùng editor sạch trước mỗi ca: tab sót lại của ca khác làm số nhóm lệch.
 *
 * KHÔNG dùng `closeAllEditors`: VS Code khôi phục một tab Untitled CHƯA LƯU giữa các lần
 * chạy (state nằm trong `.vscode-test/user-data`), và lệnh đó mở hộp thoại "Save?" — trong
 * Extension Host không ai bấm, hộp thoại chặn mọi lệnh editor sau đó, nên ca test kế tiếp
 * thấy các lệnh dời tab "không có tác dụng". `revertAndCloseActiveEditor` bỏ nội dung chưa
 * lưu và đóng, không hỏi gì.
 */
async function donBanLamViec(): Promise<void> {
  // Dọn MỌI terminal, không chỉ tab trong editor. Ca trước để sót terminal dưới panel thì ca
  // sau bắt đầu từ trạng thái bẩn: lệnh dời của VS Code làm việc trên "terminal active của
  // panel", nên một cái sót lại có thể bị kéo lên thay cho cái cần kéo. Đo được 25/10/2026:
  // cùng một mã mà bộ test dao động 30/0 ↔ 25/5 giữa các lượt, dấu hiệu luôn là một tab
  // "pwsh" lạ trong lưới.
  for (const t of vscode.window.terminals) t.dispose();
  await cho(() => vscode.window.terminals.length === 0, 8000);

  for (let i = 0; i < 20; i++) {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (tabs.length === 0) break;
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await new Promise((r) => setTimeout(r, 80));
  }
  await gopVeMotNhom();
  await cho(() => tabTerminal() === 0 && vscode.window.tabGroups.all.length === 1);
}

async function donDep(ds: vscode.Terminal[]): Promise<void> {
  for (const t of ds) t.dispose();
  await cho(() => tabTerminal() === 0);
  await gopVeMotNhom();
}

suite('xem song song — xếp terminal thành lưới', () => {
  setup(async () => {
    await donBanLamViec();
  });

  test('bốn terminal trong vùng editor → bốn nhóm, mỗi nhóm một terminal', async () => {
    const ds = [0, 1, 2, 3].map((i) =>
      vscode.window.createTerminal({ name: `luoi-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    try {
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal(ds);

      assert.equal(kq.daXep, 4);
      assert.equal(kq.qua, 0);
      await cho(() => soNhom() === 4);
      assert.equal(soNhom(), 4, 'phải có đúng 4 nhóm editor');
      assert.ok(moiNhomMotTerminal(), `mỗi nhóm phải chứa đúng một tab terminal — thực tế: ${moTaNhom()}`);
    } finally {
      await donDep(ds);
    }
  });

  test('năm terminal → năm nhóm: KHÔNG được bỏ sót cái nào', async () => {
    // Ca này tái hiện lỗi người dùng gặp thật: ba terminal đang mở mà chỉ hai cái vào lưới.
    const ds = [0, 1, 2, 3, 4].map((i) =>
      vscode.window.createTerminal({ name: `nam-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 5);

      const kq = await xepLuoiTerminal(ds, undefined, (x) => log.push(x));

      await cho(() => soNhom() === 5);
      assert.equal(kq.daXep, 5, `phải xếp đủ 5 — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`);
      assert.equal(soNhom(), 5, `phải có 5 nhóm — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`);
      assert.ok(
        moiNhomMotTerminal(),
        `mỗi nhóm đúng một terminal — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
    } finally {
      await donDep(ds);
    }
  });

  /**
   * Ca gác cho rủi ro của việc THU PANEL (0.2.2).
   *
   * Giả thuyết còn treo từ 25/10/2026, chưa ai xác nhận: cơ chế lưới dựa vào bất biến
   * "terminal đang active CỦA PANEL phải xác định" — `moveToEditor`, `moveToTerminalPanel` và
   * cách nhận diện cái vừa bị đẩy đều dựa vào nó — và đóng panel ở cuối lượt có thể phá đúng
   * bất biến đó, làm hỏng LƯỢT SAU. Đó là lý do hai bản thử trước bị gỡ.
   *
   * Không API nào đọc được panel đang mở hay đóng, nên không test được "panel có thu không".
   * Nhưng cái đáng sợ thì test được: xếp lưới hai lượt liên tiếp, lượt thứ hai vẫn phải đủ ô.
   */
  test('xếp lưới HAI lượt liên tiếp: lượt sau vẫn đủ ô (thu panel không phá lượt kế)', async () => {
    const ds = [0, 1, 2].map((i) =>
      vscode.window.createTerminal({ name: `hai-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 3);
      await xepLuoiTerminal(ds, { cot: 3, dong: 1 }, (x) => log.push(`L1 ${x}`));
      await cho(() => soNhomCoTerminal() === 3);

      // Lượt hai ngay sau lượt một — panel lúc này đã bị thu.
      await xepLuoiTerminal(ds, { cot: 3, dong: 1 }, (x) => log.push(`L2 ${x}`));

      await cho(() => soNhomCoTerminal() === 3);
      assert.equal(
        soNhomCoTerminal(),
        3,
        `lượt hai vẫn phải đủ ba ô có terminal — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
      assert.ok(
        moiOHienTerminal(),
        `lượt hai: mọi ô phải hiện terminal — thực tế: ${moTaHien()} — log: ${log.join(' | ')}`,
      );
    } finally {
      await donDep(ds);
    }
  });

  test('bố cục tự khai 3x3 với 4 terminal → chín ô, bốn ô có terminal và năm ô để trống', async () => {
    // Ô trống ở đây KHÔNG phải lỗi: người dùng tự khai 3x3 thì năm ô trống là chủ ý của họ
    // (chừa chỗ kéo thêm vào), khác hẳn chế độ tự tính vốn luôn khớp số terminal.
    const ds = [0, 1, 2, 3].map((i) =>
      vscode.window.createTerminal({ name: `ba-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    try {
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal(ds, { cot: 3, dong: 3 });

      await cho(() => soNhom() === 9);
      assert.equal(soNhom(), 9, `phải có 9 ô — thực tế: ${moTaNhom()}`);
      assert.equal(kq.daXep, 4);
      assert.equal(soNhomCoTerminal(), 4, `bốn ô có terminal — thực tế: ${moTaNhom()}`);
      // Dừng rải vì hết terminal là một lý do CÓ THẬT và phải nói ra được: thông báo cho
      // người dùng chỉ trỏ sang Output thì họ vẫn không biết vì sao thiếu ô.
      assert.ok(
        kq.lyDo !== undefined && kq.lyDo.includes('hết terminal để rải'),
        `phải trả về lý do dừng rải — thực tế: ${String(kq.lyDo)}`,
      );
    } finally {
      await donDep(ds);
    }
  });

  test('bố cục 4 cột 1 dòng với 4 terminal → bốn ô, mỗi ô một terminal', async () => {
    // Ca người dùng báo 20/10/2026: chọn 4 cột cho workspace 4 terminal, chỉ 2 cái vào được
    // ô riêng. Log được gom lại để khi đỏ thì đọc ra lý do ngay trong thông báo lỗi.
    const ds = [0, 1, 2, 3].map((i) =>
      vscode.window.createTerminal({ name: `bon-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal(ds, { cot: 4, dong: 1 }, (x) => log.push(x));

      await cho(() => soNhom() === 4);
      assert.equal(soNhom(), 4, `phải có 4 ô — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`);
      assert.equal(
        soNhomCoTerminal(),
        4,
        `bốn ô đều phải có terminal — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
      assert.equal(kq.daXep, 4, `phải xếp đủ 4 — log: ${log.join(' | ')}`);
      assert.equal(kq.qua, 0, `không được bỏ sót cái nào — log: ${log.join(' | ')}`);
    } finally {
      await donDep(ds);
    }
  });

  test('4 cột, một terminal ở panel + một terminal workspace khác phải ẩn → vẫn đủ bốn ô', async () => {
    // Trạng thái thật trên máy người dùng: không phải cả bốn đều sinh sẵn trong vùng editor,
    // và còn terminal của workspace khác chen trong vùng editor phải đẩy xuống panel trước.
    const a = vscode.window.createTerminal({ name: 'tron-a', location: vscode.TerminalLocation.Editor });
    const b = vscode.window.createTerminal({ name: 'tron-b', location: vscode.TerminalLocation.Editor });
    const c = vscode.window.createTerminal({ name: 'tron-c', location: vscode.TerminalLocation.Editor });
    const d = vscode.window.createTerminal({ name: 'tron-d', location: vscode.TerminalLocation.Panel });
    const la = vscode.window.createTerminal({ name: 'tron-la', location: vscode.TerminalLocation.Editor });
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal([a, b, c, d], { cot: 4, dong: 1 }, (x) => log.push(x));

      await cho(() => soNhomCoTerminal() === 4);
      assert.equal(
        soNhomCoTerminal(),
        4,
        `bốn ô đều phải có terminal — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
      assert.equal(kq.daXep, 4, `phải xếp đủ 4 — log: ${log.join(' | ')}`);
    } finally {
      await donDep([a, b, c, d, la]);
    }
  });

  test('có tab FILE đang hiện trong nhóm: vẫn rải đủ terminal, không ném tab file đi', async () => {
    // Tái hiện ca đỏ quan sát được 20/10/2026: nhóm 1 có một tab KHÔNG phải terminal và nó
    // đang là tab hiện. Vòng xoay nghỉ một nhịp cố định rồi đọc tab đang hiện → đọc phải giá
    // trị cũ → lệnh dời ném chính tab file sang ô kế, lưới đứng lại ở một ô.
    const ds = [0, 1, 2].map((i) =>
      vscode.window.createTerminal({ name: `file-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 3);
      const doc = await vscode.workspace.openTextDocument({ content: 'xin chào', language: 'plaintext' });
      await vscode.window.showTextDocument(doc, { preview: false });
      await cho(
        () =>
          !(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal),
      );

      const kq = await xepLuoiTerminal(ds, { cot: 3, dong: 1 }, (x) => log.push(x));

      await cho(() => soNhomCoTerminal() === 3);
      assert.equal(
        soNhomCoTerminal(),
        3,
        `ba ô đều phải có terminal — thực tế: ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
      assert.equal(kq.daXep, 3, `phải xếp đủ 3 — log: ${log.join(' | ')}`);
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await donDep(ds);
    }
  });

  /**
   * Hỏi "ô đang HIỆN cái gì", trong khi ca ngay trên chỉ hỏi "ô có CHỨA terminal không" —
   * người dùng nhìn thấy cái đang hiện, nên đây mới là câu hỏi khớp với trải nghiệm.
   *
   * Viết ra khi điều tra ảnh chụp 26/10/2026 (lưới 2x2 đủ bốn terminal nhưng ô 1 hiện tab
   * `Untitled-1`). Ca này KHÔNG tái hiện được lỗi đó — thử cả hai thứ tự tab đều xanh với mã
   * hiện có, tức vòng rải vẫn để lại tab terminal ở trước mặt. Kết luận rút ra: tab nháp đó
   * xuất hiện SAU khi lưới đã xếp xong (làm nóng giọng nói chạy ở giây thứ 4 mỗi lần mở hoặc
   * reload cửa sổ, và `showTextDocument` ném tab vào đúng nhóm đang active), nên không có
   * thay đổi nào trong `xepLuoiTerminal` chạm tới được. Cái chạm tới được là tắt làm nóng.
   *
   * Giữ lại làm hàng rào: bỏ bước xoay tab trong vòng rải thì ca này đỏ.
   */
  test('tab FILE còn trong nhóm: mọi ô phải HIỆN tab terminal, không phải tab file', async () => {
    const log: string[] = [];
    // Khai ngoài `try` để bước dọn dẹp còn đóng được nó theo danh tính.
    let doc: vscode.TextDocument | undefined;
    let ds: vscode.Terminal[] = [];
    try {
      // THỨ TỰ quan trọng, và phải giống đời thật: tab nháp sinh ra lúc cửa sổ vừa mở (làm
      // nóng giọng nói chạy ở giây thứ 4), nên nó là tab ĐẦU của nhóm — các terminal mở sau
      // đứng bên phải nó. Mở nháp sau cùng thì nó nằm cuối và ca này xanh oan.
      doc = await vscode.workspace.openTextDocument({ content: '', language: 'plaintext' });
      await vscode.window.showTextDocument(doc, { preview: false });
      await cho(() => vscode.window.tabGroups.all.some((g) => g.tabs.length === 1));

      ds = [0, 1, 2, 3].map((i) =>
        vscode.window.createTerminal({ name: `hien-${i}`, location: vscode.TerminalLocation.Editor }),
      );
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal(ds, { cot: 2, dong: 2 }, (x) => log.push(x));

      await cho(() => moiOHienTerminal());
      // CỐ Ý không đòi `kq.daXep === 4`: con số đó báo "kéo lên được mấy cái", tụt xuống khi
      // pha vét trượt lúc máy tải nặng — đã có ca riêng cho nó. Ca này chỉ hỏi một điều:
      // người dùng nhìn vào lưới thì thấy terminal hay thấy tab file.
      void kq;
      assert.ok(
        moiOHienTerminal(),
        `mọi ô phải đang hiện tab terminal — thực tế: ${moTaHien()} — log: ${log.join(' | ')}`,
      );
    } finally {
      // Đóng tab nháp theo DANH TÍNH, không bằng `revertAndCloseActiveEditor`: sau khi vá thì
      // tab đang hiện là terminal, nên lệnh theo-focus sẽ ăn nhầm tab terminal và để tab nháp
      // lọt sang ca sau.
      for (const g of vscode.window.tabGroups.all) {
        for (const tab of g.tabs) {
          if (
            doc !== undefined &&
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === doc.uri.toString()
          ) {
            await vscode.window.tabGroups.close(tab, false);
          }
        }
      }
      await donDep(ds);
    }
  });

  /**
   * Ca người dùng gặp 24/10/2026: "Đã xếp 2 terminal ... 3 cái VS Code không tách ra được ô
   * riêng — dừng ở ô 3: hết terminal để rải (nhóm 1 còn 1 tab)". Ba terminal kia nằm ở PANEL
   * vì một lượt xếp lưới TRƯỚC (của workspace khác) đã đẩy chúng xuống, và vòng kéo lên chỉ
   * đọc `creationOptions.location` — ảnh chụp lúc tạo, vẫn khai "editor" — nên bỏ qua chúng.
   */
  test('terminal bị lượt lưới trước đẩy xuống panel: lượt sau phải kéo lên lại', async () => {
    const moi = (ten: string): vscode.Terminal =>
      vscode.window.createTerminal({ name: ten, location: vscode.TerminalLocation.Editor });
    const bịĐẩy = moi('lai-2');
    const ds = [moi('lai-0'), moi('lai-1'), bịĐẩy];
    try {
      await cho(() => tabTerminal() === 3);
      // Đúng việc `anTerminalNgoaiLuoi` làm khi một workspace khác xếp lưới.
      bịĐẩy.show(true);
      await cho(() => vscode.window.activeTerminal === bịĐẩy);
      await doi(200);
      await vscode.commands.executeCommand('workbench.action.terminal.moveToTerminalPanel');
      await cho(() => tabTerminal() === 2);
      assert.equal(tabTerminal(), 2, `tiền đề: một terminal phải đang ở panel — ${moTaNhom()}`);

      const kq = await xepLuoiTerminal(ds);

      await cho(() => soNhomCoTerminal() === 3);
      assert.equal(kq.daXep, 3, `cả ba phải vào lưới — ${moTaNhom()}`);
      assert.ok(moiNhomMotTerminal(), `mỗi ô đúng một terminal — ${moTaNhom()}`);
    } finally {
      await donDep(ds);
    }
  });

  test('bố cục nhỏ hơn số terminal: 2 cột 1 dòng với 4 terminal → chỉ 2 cái vào ô riêng', async () => {
    const ds = [0, 1, 2, 3].map((i) =>
      vscode.window.createTerminal({ name: `hep-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    try {
      await cho(() => tabTerminal() === 4);

      const kq = await xepLuoiTerminal(ds, { cot: 2, dong: 1 });

      await cho(() => soNhom() === 2);
      assert.equal(soNhom(), 2, `phải có 2 ô — thực tế: ${moTaNhom()}`);
      assert.equal(kq.daXep, 2);
      assert.equal(kq.qua, 2, 'hai cái không có ô riêng phải được báo lại');
      assert.equal(tabTerminal(), 4, 'không terminal nào bị mất, chỉ là nằm chồng tab');
    } finally {
      await donDep(ds);
    }
  });

  test('terminal đang ở PANEL cũng được kéo vào lưới, không phải mở lại', async () => {
    const panel = vscode.window.createTerminal({
      name: 'luoi-panel',
      location: vscode.TerminalLocation.Panel,
    });
    const editor = vscode.window.createTerminal({
      name: 'luoi-editor',
      location: vscode.TerminalLocation.Editor,
    });
    try {
      await cho(() => tabTerminal() === 1); // mới chỉ cái ở editor có tab

      const kq = await xepLuoiTerminal([panel, editor]);

      assert.equal(kq.daXep, 2);
      await cho(() => tabTerminal() === 2 && soNhom() === 2);
      assert.equal(tabTerminal(), 2, 'terminal ở panel phải thành tab trong vùng editor');
      assert.equal(soNhom(), 2);
      // Cùng một đối tượng Terminal, không phải cái mới: phiên không bị giết và mở lại.
      assert.ok(vscode.window.terminals.includes(panel));
    } finally {
      await donDep([panel, editor]);
    }
  });

  test('thôi xem song song thì dồn hết về một nhóm, không đóng terminal nào', async () => {
    const ds = [0, 1, 2].map((i) =>
      vscode.window.createTerminal({ name: `gop-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    try {
      await cho(() => tabTerminal() === 3);
      await xepLuoiTerminal(ds);
      await cho(() => soNhom() === 3);

      await gopVeMotNhom();

      await cho(() => soNhom() === 1);
      assert.equal(soNhom(), 1);
      assert.equal(tabTerminal(), 3, 'không được mất terminal nào khi gộp');
    } finally {
      await donDep(ds);
    }
  });

  test('một terminal thì chỉ hiện nó, không chia nhóm', async () => {
    const t = vscode.window.createTerminal({ name: 'mot', location: vscode.TerminalLocation.Editor });
    try {
      await cho(() => tabTerminal() === 1);

      const kq = await xepLuoiTerminal([t]);

      assert.equal(kq.daXep, 1);
      await cho(() => soNhom() === 1);
      assert.equal(soNhom(), 1);
    } finally {
      await donDep([t]);
    }
  });

  test('danh sách rỗng: không ném, không đụng bố cục', async () => {
    const truoc = soNhom();
    const kq = await xepLuoiTerminal([]);
    assert.deepEqual(kq, { daXep: 0, qua: 0, daAn: 0 });
    assert.equal(soNhom(), truoc);
  });
});

suite('xem song song — terminal ngoài lưới', () => {
  setup(async () => {
    await donBanLamViec();
  });

  test('terminal KHÔNG thuộc danh sách bị đẩy khỏi vùng editor, nhưng vẫn sống', async () => {
    const trong = [0, 1].map((i) =>
      vscode.window.createTerminal({ name: `trong-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const ngoai = vscode.window.createTerminal({
      name: 'ngoai-luoi',
      location: vscode.TerminalLocation.Editor,
    });
    try {
      await cho(() => tabTerminal() === 3);

      const kq = await xepLuoiTerminal(trong);

      // Lưới chỉ còn hai terminal của workspace; cái thứ ba không còn tab nào trong editor.
      await cho(() => tabTerminal() === 2);
      assert.equal(tabTerminal(), 2, `vùng editor phải chỉ còn terminal trong lưới — ${moTaNhom()}`);
      assert.equal(kq.daAn, 1, 'phải báo đã ẩn đúng một terminal');
      assert.equal(kq.daXep, 2);
      // Ẩn, KHÔNG giết: phiên agent trong đó phải còn nguyên.
      assert.ok(vscode.window.terminals.includes(ngoai), 'terminal ngoài lưới không được bị đóng');
    } finally {
      await donDep([...trong, ngoai]);
    }
  });

  test('terminal đang ở panel thì để yên — nó vốn đã không chiếm chỗ trong lưới', async () => {
    const trong = vscode.window.createTerminal({
      name: 'trong-luoi',
      location: vscode.TerminalLocation.Editor,
    });
    const duoiPanel = vscode.window.createTerminal({
      name: 'duoi-panel',
      location: vscode.TerminalLocation.Panel,
    });
    try {
      await cho(() => tabTerminal() === 1);

      const kq = await xepLuoiTerminal([trong]);

      assert.equal(kq.daAn, 0, 'không có gì để ẩn: cái kia vốn đã ở panel');
      assert.ok(vscode.window.terminals.includes(duoiPanel));
    } finally {
      await donDep([trong, duoiPanel]);
    }
  });

  /**
   * Ca người dùng gặp 22/10/2026: tab "pwsh" họ tự mở bằng Ctrl+` nằm lẫn trong lưới của
   * workspace "Working" và chiếm mất một ô. Bên gọi không thể kể tên nó vì extension không
   * hề biết nó tồn tại — nên chính `xepLuoiTerminal` phải tự dọn.
   */
  test('terminal người dùng tự mở (không workspace nào quản) cũng phải rời vùng editor', async () => {
    const trong = [0, 1].map((i) =>
      vscode.window.createTerminal({ name: `trong-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const la = vscode.window.createTerminal({
      name: 'la-editor',
      location: vscode.TerminalLocation.Editor,
    });
    try {
      await cho(() => tabTerminal() === 3);
      assert.equal(tabTerminal(), 3, `tiền đề: cả ba terminal phải ở vùng editor — ${moTaNhom()}`);

      const kq = await xepLuoiTerminal(trong);

      await cho(() => tabTerminal() === trong.length);
      assert.equal(
        tabTerminal(),
        trong.length,
        `terminal lạ phải xuống panel, không chiếm ô — ${moTaNhom()}`,
      );
      assert.equal(kq.daAn, 1, 'phải báo đã ẩn đúng một terminal lạ');
      assert.ok(vscode.window.terminals.includes(la), 'ẩn chứ không được giết');
    } finally {
      await donDep([...trong, la]);
    }
  });

  /**
   * Cùng ca trên nhưng terminal lạ KHÔNG khai `location` — đúng dạng Ctrl+` sinh ra. Máy
   * người dùng đặt `terminal.integrated.defaultLocation: "editor"`, nên nó nằm ở vùng editor
   * dù `creationOptions.location` rỗng.
   */
  test('terminal lạ không khai location, mặc định là "editor": vẫn phải rời vùng editor', async () => {
    const cfg = vscode.workspace.getConfiguration('terminal.integrated');
    const cu = cfg.inspect<string>('defaultLocation')?.globalValue;
    await cfg.update('defaultLocation', 'editor', vscode.ConfigurationTarget.Global);
    await doi(300);
    const trong = [0, 1].map((i) =>
      vscode.window.createTerminal({ name: `trong-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const la = vscode.window.createTerminal({ name: 'la-mac-dinh' });
    try {
      await cho(() => tabTerminal() === 3);
      assert.equal(
        tabTerminal(),
        3,
        `tiền đề: terminal không khai location phải nằm ở vùng editor — ${moTaNhom()}`,
      );

      const kq = await xepLuoiTerminal(trong);

      await cho(() => tabTerminal() === trong.length);
      assert.equal(
        tabTerminal(),
        trong.length,
        `terminal lạ phải xuống panel, không chiếm ô — ${moTaNhom()}`,
      );
      assert.equal(kq.daAn, 1, 'phải báo đã ẩn đúng một terminal lạ');
    } finally {
      await donDep([...trong, la]);
      await cfg.update('defaultLocation', cu, vscode.ConfigurationTarget.Global);
    }
  });
});

suite('xem song song — thêm ô vào lưới đang có', () => {
  setup(async () => {
    await donBanLamViec();
  });

  test('terminal mở sau khi đã xếp lưới: thêm được một ô riêng cho nó', async () => {
    const dau = [0, 1].map((i) =>
      vscode.window.createTerminal({ name: `dau-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    let them: vscode.Terminal | undefined;
    try {
      await cho(() => tabTerminal() === 2);
      await xepLuoiTerminal(dau);
      await cho(() => soNhom() === 2);

      // Đây là tình huống thật: đang xem song song thì mở thêm một terminal — nó chui vào
      // chung ô với cái khác nên người dùng "không thấy nó đâu".
      them = vscode.window.createTerminal({ name: 'mo-sau', location: vscode.TerminalLocation.Editor });
      await cho(() => tabTerminal() === 3);

      const ok = await themOVaoLuoi(them);

      assert.equal(ok, true);
      await cho(() => soNhom() === 3 && moiNhomMotTerminal());
      assert.equal(soNhom(), 3, `phải có ba ô — ${moTaNhom()}`);
      assert.ok(moiNhomMotTerminal(), `mỗi ô đúng một terminal — ${moTaNhom()}`);
    } finally {
      await donDep(them === undefined ? dau : [...dau, them]);
    }
  });

  /**
   * Nhánh "lôi nhầm rồi trả về panel" — ghi nợ 24/10/2026 là chưa ca nào chạy qua.
   *
   * Dựng đúng điều kiện kích hoạt nó: `t` ĐÃ ở vùng editor, và panel đang giữ một terminal
   * khác. `moveToEditor` làm việc trên terminal active CỦA PANEL nên nó sẽ lôi cái dưới
   * panel lên; phần phòng thủ phải nhận ra và trả cái đó về chỗ cũ.
   */
  test('thêm vào lưới một terminal VỐN ĐÃ ở editor: không được lôi terminal panel lên theo', async () => {
    const trong = vscode.window.createTerminal({
      name: 'da-o-editor',
      location: vscode.TerminalLocation.Editor,
    });
    const duoiPanel = vscode.window.createTerminal({
      name: 'yen-duoi-panel',
      location: vscode.TerminalLocation.Panel,
    });
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 1);
      await xepLuoiTerminal([trong]);
      await cho(() => tabTerminal() === 1);
      assert.equal(tabTerminal(), 1, `tiền đề: chỉ "da-o-editor" ở vùng editor — ${moTaNhom()}`);

      await themOVaoLuoi(trong, (x) => log.push(x));

      // Điều phải giữ: terminal dưới panel KHÔNG được trồi lên vùng editor.
      await doi(400);
      assert.equal(
        tabTerminal(),
        1,
        `panel phải ở yên dưới panel — ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
      assert.ok(vscode.window.terminals.includes(duoiPanel), 'không được đóng terminal nào');
    } finally {
      await donDep([trong, duoiPanel]);
    }
  });

  test('terminal đang ở panel cũng thêm vào lưới được, không mở lại', async () => {
    const trong = vscode.window.createTerminal({
      name: 'da-trong-luoi',
      location: vscode.TerminalLocation.Editor,
    });
    const panel = vscode.window.createTerminal({
      name: 'tu-panel',
      location: vscode.TerminalLocation.Panel,
    });
    try {
      await cho(() => tabTerminal() === 1);
      await xepLuoiTerminal([trong]);

      const ok = await themOVaoLuoi(panel);

      assert.equal(ok, true);
      await cho(() => tabTerminal() === 2 && soNhom() === 2);
      assert.equal(tabTerminal(), 2, `terminal từ panel phải thành tab trong lưới — ${moTaNhom()}`);
      assert.ok(vscode.window.terminals.includes(panel), 'không được mở lại terminal');
    } finally {
      await donDep([trong, panel]);
    }
  });
});

suite('bấm vào terminal trong cây — đúng cái đó phải lên active', () => {
  setup(async () => {
    await donBanLamViec();
  });

  test('thoát lưới xong, terminal KHÔNG phải tab đang hiện vẫn lên active', async () => {
    // Lỗi người dùng gặp thật: "thôi xem song song" chỉ gộp nhóm, mọi terminal chồng thành
    // tab trong MỘT nhóm. Bấm cái đang hiện thì thấy có phản ứng, bấm cái khác thì im lặng,
    // vì `terminal.show()` không chắc kéo được tab của nó lên active.
    const ds = [0, 1, 2].map((i) =>
      vscode.window.createTerminal({ name: `cay-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 3);
      await xepLuoiTerminal(ds);
      await cho(() => soNhom() === 3);

      await gopVeMotNhom();
      await cho(() => soNhom() === 1);
      // Đặt con trỏ ở một terminal KHÁC để cú bấm sắp tới phải đổi tab thật sự.
      ds[2]?.show(false);
      await cho(() => vscode.window.activeTerminal === ds[2]);

      const ok = await hienTerminal(ds[0] as vscode.Terminal, (d) => log.push(d));

      assert.equal(ok, true, `phải hiện được cay-0 — log: ${log.join(' | ')} — ${moTaNhom()}`);
      assert.equal(
        vscode.window.activeTerminal,
        ds[0],
        `terminal active phải là cay-0 — log: ${log.join(' | ')} — ${moTaNhom()}`,
      );
      assert.ok(
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTerminal,
        `tab đang hiện phải là tab terminal — ${moTaNhom()}`,
      );
    } finally {
      await donDep(ds);
    }
  });

  test('terminal ĐÃ BỊ DỜI chỗ (panel↔editor) vẫn hiện được', async () => {
    // Ca sát với máy người dùng nhất: sau khi xếp lưới, `creationOptions.location` không còn
    // nói đúng terminal đang nằm đâu — cái sinh ở panel đã bị kéo vào editor, cái sinh ở
    // editor đã bị đẩy xuống panel. Mọi suy luận theo location lúc tạo đều sai từ đây.
    const a = vscode.window.createTerminal({ name: 'doi-a', location: vscode.TerminalLocation.Editor });
    const b = vscode.window.createTerminal({ name: 'doi-b', location: vscode.TerminalLocation.Editor });
    // d sinh ở PANEL rồi bị kéo vào lưới; c sinh ở EDITOR rồi bị đẩy xuống panel.
    const d = vscode.window.createTerminal({ name: 'doi-d', location: vscode.TerminalLocation.Panel });
    const c = vscode.window.createTerminal({ name: 'doi-c', location: vscode.TerminalLocation.Editor });
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 3);
      await xepLuoiTerminal([a, b, d], undefined, (x) => log.push(x));
      await gopVeMotNhom();
      await cho(() => soNhom() === 1);

      a.show(false);
      await cho(() => vscode.window.activeTerminal === a);
      const okC = await hienTerminal(c, (x) => log.push(x));
      assert.equal(okC, true, `terminal bị đẩy xuống panel phải hiện được — log: ${log.join(' | ')}`);
      assert.equal(vscode.window.activeTerminal, c, `active phải là doi-c — log: ${log.join(' | ')}`);

      a.show(false);
      await cho(() => vscode.window.activeTerminal === a);
      const okD = await hienTerminal(d, (x) => log.push(x));

      // KHÔNG đòi `activeTerminal === d`: khi panel còn giữ doi-c thì VS Code vẫn báo
      // `activeTerminal` là cái dưới panel, kể cả lúc tab editor đang hiện doi-d (đo được
      // trong chính ca này). Thứ người dùng nhìn thấy — và thứ phải đúng — là TAB đang hiện.
      assert.equal(okD, true, `terminal sinh ở panel đã vào lưới phải hiện được — log: ${log.join(' | ')}`);
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(
        tab?.input instanceof vscode.TabInputTerminal && tab.label === 'doi-d',
        `tab đang hiện phải là doi-d — thực tế "${tab?.label}" — log: ${log.join(' | ')}`,
      );
    } finally {
      await donDep([a, b, c, d]);
    }
  });

  test('terminal ở panel cũng hiện được', async () => {
    const panel = vscode.window.createTerminal({
      name: 'hien-panel',
      location: vscode.TerminalLocation.Panel,
    });
    const khac = vscode.window.createTerminal({
      name: 'hien-editor',
      location: vscode.TerminalLocation.Editor,
    });
    try {
      await cho(() => vscode.window.activeTerminal === khac);

      const log: string[] = [];
      const ok = await hienTerminal(panel, (x) => log.push(x));

      assert.equal(ok, true, `terminal panel phải hiện được — log: ${log.join(' | ')}`);
      assert.equal(
        vscode.window.activeTerminal,
        panel,
        `panel phải thành terminal active — thực tế "${vscode.window.activeTerminal?.name}" ` +
          `— tab đang hiện "${vscode.window.tabGroups.activeTabGroup.activeTab?.label}" ` +
          `— log: ${log.join(' | ')}`,
      );
    } finally {
      await donDep([panel, khac]);
    }
  });

  /**
   * Nợ ghi 24/10/2026: nhánh dự phòng của `hienTerminal` nhận diện tab bằng
   * `tab.label === t.name`. Đo 25/10 cho thấy cách đó hỏng từ gốc:
   *
   * - Tab terminal CHƯA từng được hiện có `label` là chuỗi RỖNG, và nó rỗng vĩnh viễn
   *   (đo 4 giây vẫn rỗng) — mà đó đúng là loại tab nhánh dự phòng phải tìm.
   * - Nhãn có lúc là tên tiến trình (`pwsh`) chứ không phải tên lúc tạo.
   * - Ngược lại, `window.activeTerminal` gọi ĐÚNG tên ngay cả khi nhãn rỗng, miễn là vùng
   *   editor đang giữ focus — kể cả khi panel cũng có terminal.
   *
   * Ca này dựng đúng tình huống đó: nhiều terminal trong editor (nhãn rỗng) + một terminal
   * dưới panel đang giữ focus, rồi bấm vào một cái KHÔNG phải tab đang hiện.
   */
  test('tab chưa có nhãn + panel đang giữ focus: vẫn hiện đúng terminal', async () => {
    const ds = [0, 1, 2].map((i) =>
      vscode.window.createTerminal({ name: `nhan-${i}`, location: vscode.TerminalLocation.Editor }),
    );
    const duoiPanel = vscode.window.createTerminal({
      name: 'nhan-panel',
      location: vscode.TerminalLocation.Panel,
    });
    const log: string[] = [];
    try {
      await cho(() => tabTerminal() === 3);
      await gopVeMotNhom();
      await cho(() => soNhom() === 1);
      // Panel giữ focus → `activeTerminal` báo cái dưới panel, đúng ca mà nhánh dự phòng sinh ra để lo.
      duoiPanel.show(true);
      await cho(() => vscode.window.activeTerminal === duoiPanel);
      await doi(300);

      const dich = ds[0]!;
      const ok = await hienTerminal(dich, (x) => log.push(x));

      assert.equal(ok, true, `phải hiện được dù nhãn tab rỗng — log: ${log.join(' | ')}`);
      // Chờ focus lắng rồi mới đọc: hàm trả về ngay khi điều kiện đúng, nhưng VS Code còn
      // chuyển focus thêm một nhịp — đọc tức thì có lúc vớ phải terminal của panel.
      await cho(() => vscode.window.activeTerminal === dich);
      assert.equal(
        vscode.window.activeTerminal,
        dich,
        `active phải là nhan-0 — ${moTaNhom()} — log: ${log.join(' | ')}`,
      );
    } finally {
      await donDep([...ds, duoiPanel]);
    }
  });

  test('terminal đã đóng: trả false chứ không ném', async () => {
    // `window.terminals` còn liệt kê terminal vừa đóng một nhịp, nên ca này canh đúng chỗ
    // `show()` ném "Terminal has already been disposed" và làm hỏng cú bấm.
    const chet = vscode.window.createTerminal({ name: 'da-dong', location: vscode.TerminalLocation.Editor });
    await cho(() => tabTerminal() === 1);
    chet.dispose();
    await cho(() => tabTerminal() === 0);

    const ok = await hienTerminal(chet);

    assert.equal(ok, false, 'terminal đã đóng thì không hiện được, và không được ném');
  });
});
