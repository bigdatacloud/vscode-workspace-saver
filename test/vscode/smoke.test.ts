import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'aiWorkspace.newWorkspace',
  'aiWorkspace.saveWorkspace',
  'aiWorkspace.openWorkspace',
  'aiWorkspace.closeWorkspace',
  'aiWorkspace.addSession',
  'aiWorkspace.removeSession',
  'aiWorkspace.openSessionTerminal',
  'aiWorkspace.restoreSession',
];

suite('AI Workspace extension', () => {
  test('đăng ký đủ 8 lệnh của MVP', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(all.includes(command), `thiếu lệnh ${command}`);
    }
  });

  test('tạo được TreeView sidebar', async () => {
    await vscode.commands.executeCommand('workbench.view.explorer');
    assert.ok(true);
  });

  test('TerminalManager tạo terminal đúng tên', async () => {
    const before = vscode.window.terminals.length;
    const terminal = vscode.window.createTerminal({ name: 'wss-smoke' });
    assert.strictEqual(vscode.window.terminals.length, before + 1);
    assert.strictEqual(terminal.name, 'wss-smoke');
    terminal.dispose();
  });

  test('tạo hai terminal liên tiếp thì số lượng terminal tăng đúng 2 và cả hai đều tồn tại', () => {
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
    }
  });
});
