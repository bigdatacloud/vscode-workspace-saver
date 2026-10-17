import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { gopVeMotNhom, xepLuoiTerminal } from '../../src/ui/splitview';

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

/** Vùng editor sạch trước mỗi ca: tab sót lại của ca khác làm số nhóm lệch. */
async function donBanLamViec(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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
    assert.deepEqual(kq, { daXep: 0, qua: 0 });
    assert.equal(soNhom(), truoc);
  });
});
