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
    try {
      await cho(() => tabTerminal() === 5);

      const kq = await xepLuoiTerminal(ds);

      await cho(() => soNhom() === 5);
      assert.equal(kq.daXep, 5, `phải xếp đủ 5 — thực tế: ${moTaNhom()}`);
      assert.equal(soNhom(), 5, `phải có 5 nhóm — thực tế: ${moTaNhom()}`);
      assert.ok(moiNhomMotTerminal(), `mỗi nhóm đúng một terminal — thực tế: ${moTaNhom()}`);
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

      const kq = await xepLuoiTerminal(trong, undefined, undefined, [ngoai]);

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

      const kq = await xepLuoiTerminal([trong], undefined, undefined, [duoiPanel]);

      assert.equal(kq.daAn, 0, 'không có gì để ẩn: cái kia vốn đã ở panel');
      assert.ok(vscode.window.terminals.includes(duoiPanel));
    } finally {
      await donDep([trong, duoiPanel]);
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
      await xepLuoiTerminal([a, b, d], undefined, (x) => log.push(x), [c]);
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

      const ok = await hienTerminal(panel);

      assert.equal(ok, true, 'terminal panel phải hiện được');
      assert.equal(vscode.window.activeTerminal, panel, 'panel phải thành terminal active');
    } finally {
      await donDep([panel, khac]);
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
