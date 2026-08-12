import * as assert from 'node:assert';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { TerminalManager } from '../../src/terminal/manager';

const EXPECTED_COMMANDS = [
  'aiWorkspace.createWorkspace',
  'aiWorkspace.activateWorkspace',
  'aiWorkspace.closeActiveWorkspace',
  'aiWorkspace.renameWorkspace',
  'aiWorkspace.deleteWorkspace',
  'aiWorkspace.newClaudeTerminal',
  'aiWorkspace.newPlainTerminal',
  'aiWorkspace.workspaceSettings',
  'aiWorkspace.showTerminalPath',
  'aiWorkspace.showWorkspaceInfo',
  'aiWorkspace.setStartCommand',
  'aiWorkspace.removeTerminal',
  'aiWorkspace.focusTerminal',
  'aiWorkspace.addOpenTerminalToWorkspace',
  'aiWorkspace.assignClaudeSession',
  'aiWorkspace.renameTerminal',
];

/**
 * `vscode.Terminal.dispose()` không đảm bảo phản ánh ngay vào `vscode.window.terminals`
 * (đóng terminal là bất đồng bộ ở phía workbench). Poll có kiểm soát thay vì nới lỏng assert.
 */
async function waitForTerminalCount(expected: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (vscode.window.terminals.length !== expected) {
    if (Date.now() - start > timeoutMs) {
      assert.strictEqual(vscode.window.terminals.length, expected);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

suite('AI Workspace extension', () => {
  // `activationEvents: ["onStartupFinished"]` chạy bất đồng bộ với chính test runner —
  // không có gì đảm bảo activate() đã xong trước khi test đầu tiên chạy. Chờ tường minh
  // ở đây thay vì dựa vào may rủi thời gian khởi động của workbench.
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension('bigdatacloud.ai-workspace-session-manager');
    assert.ok(ext, 'không tìm thấy extension đang phát triển trong Extension Host');
    if (!ext.isActive) await ext.activate();
  });

  test('đăng ký đủ lệnh và activate() đã chạy xong', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(all.includes(command), `thiếu lệnh ${command}`);
    }
    // Khai báo trong package.json thôi chưa đủ: chạy thật một lệnh để chứng minh
    // activate() đã đăng ký handler. Cố tình chỉ dùng lệnh KHÔNG mở hộp thoại nào:
    // mọi showInputBox/showWarningMessage trong Extension Host headless sẽ không có ai
    // bấm, await sẽ treo tới hết timeout. 'closeActiveWorkspace' khi chưa có workspace
    // active thì return ngay TRƯỚC khi mở modal confirm (xem closeActiveConfirmed()).
    await vscode.commands.executeCommand('aiWorkspace.closeActiveWorkspace');
  });

  test('view aiWorkspace.workspaces được đăng ký và focus được', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes('aiWorkspace.workspaces.focus'),
      'VS Code phải tự sinh lệnh focus cho view đã contribute',
    );
    // Focus được mà không ném nghĩa là view tồn tại thật trong workbench.
    await vscode.commands.executeCommand('aiWorkspace.workspaces.focus');
  });

  test('TerminalManager tạo, theo dõi và đóng terminal theo key', async () => {
    const manager = new TerminalManager();
    const truoc = vscode.window.terminals.length;
    try {
      const handle = manager.create('backend', {
        name: 'wss-backend', cwd: tmpdir(), env: {},
      });
      assert.ok(handle, 'create phải trả về handle');
      assert.strictEqual(vscode.window.terminals.length, truoc + 1);
      assert.ok(vscode.window.terminals.some((t) => t.name === 'wss-backend'));
      assert.strictEqual(manager.has('backend'), true);
      assert.strictEqual(manager.focus('backend'), true);
      assert.strictEqual(manager.focus('khong-ton-tai'), false);
    } finally {
      manager.closeAll();
      manager.dispose();
      await waitForTerminalCount(truoc);
    }
  });

  test('TerminalManager tạo lại cùng key thì đóng terminal cũ, không nhân đôi', async () => {
    const manager = new TerminalManager();
    const truoc = vscode.window.terminals.length;
    try {
      manager.create('qc', { name: 'wss-qc-1', cwd: tmpdir(), env: {} });
      assert.strictEqual(vscode.window.terminals.length, truoc + 1);

      // Tạo lại cùng key: terminal cũ phải bị đóng, không được để lại hai cái.
      manager.create('qc', { name: 'wss-qc-2', cwd: tmpdir(), env: {} });
      await waitForTerminalCount(truoc + 1);
      assert.strictEqual(
        vscode.window.terminals.length, truoc + 1,
        'tạo lại cùng key không được làm tăng số terminal',
      );
      assert.ok(vscode.window.terminals.some((t) => t.name === 'wss-qc-2'));
      assert.strictEqual(manager.has('qc'), true);
    } finally {
      manager.closeAll();
      manager.dispose();
      await waitForTerminalCount(truoc);
    }
  });

  test('TerminalManager adopt() nhận nuôi terminal có sẵn, ownsTerminal() nhận diện đúng', async () => {
    const manager = new TerminalManager();
    const truoc = vscode.window.terminals.length;
    // Terminal tạo thẳng bằng API vscode, KHÔNG qua TerminalManager.create — mô phỏng
    // terminal người dùng tự mở tay mà adoption cần nhận nuôi.
    const terminal = vscode.window.createTerminal({ name: 'wss-adopt-target' });
    try {
      assert.strictEqual(vscode.window.terminals.length, truoc + 1);
      // Chưa adopt: manager không nhận đây là của mình.
      assert.strictEqual(manager.ownsTerminal(terminal), null);
      assert.strictEqual(manager.has('adopted'), false);

      manager.adopt('adopted', terminal);

      assert.strictEqual(manager.has('adopted'), true);
      assert.strictEqual(manager.ownsTerminal(terminal), 'adopted');
      assert.strictEqual(manager.get('adopted'), terminal);
      // adopt() không tạo terminal mới, không show lại — số lượng không đổi.
      assert.strictEqual(vscode.window.terminals.length, truoc + 1);
    } finally {
      manager.closeAll();
      manager.dispose();
      await waitForTerminalCount(truoc);
    }
  });

  test('tạo hai terminal liên tiếp thì số lượng terminal tăng đúng 2 và cả hai đều tồn tại', async () => {
    const before = vscode.window.terminals.length;
    const terminalA = vscode.window.createTerminal({ name: 'wss-smoke-a' });
    const terminalB = vscode.window.createTerminal({ name: 'wss-smoke-b' });
    try {
      assert.strictEqual(vscode.window.terminals.length, before + 2);
      assert.ok(vscode.window.terminals.includes(terminalA), 'thiếu terminal A trong danh sách');
      assert.ok(vscode.window.terminals.includes(terminalB), 'thiếu terminal B trong danh sách');
    } finally {
      terminalA.dispose();
      terminalB.dispose();
      await waitForTerminalCount(before);
    }
  });
});
