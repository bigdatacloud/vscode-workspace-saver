import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

/**
 * Nạp BẢN ĐÃ CÀI từ VSIX (không phải mã trong `dist/`) và kiểm nó chạy được trong một cửa sổ
 * VS Code thật: đúng phiên bản, activate thành công, lệnh đã đăng ký.
 *
 * Vì sao tách khỏi bộ test chính: bộ chính chạy với `--extensionDevelopmentPath`, tức nó đo mã
 * nguồn đang sửa. Ca này đo thứ người dùng thật sự nhận — gói đã đóng, đã cài. Chạy bằng
 * `npx vscode-test --config .vscode-test-cai.mjs`.
 */
suite('bản đã cài từ VSIX', () => {
  test('đúng phiên bản, activate được, lệnh đã đăng ký', async () => {
    const ext = vscode.extensions.getExtension('bigdatacloud.ai-workspaces');
    assert.ok(ext, 'phải thấy extension bigdatacloud.ai-workspaces trong cửa sổ này');

    const mong = process.env.AIWS_BAN_MONG;
    assert.ok(mong, 'thiếu AIWS_BAN_MONG — không biết phải so với phiên bản nào');
    assert.equal(
      (ext.packageJSON as { version: string }).version,
      mong,
      'phiên bản đang nạp phải khớp package.json của repo',
    );

    await ext.activate();
    assert.equal(ext.isActive, true, 'extension phải activate được');

    const lenh = await vscode.commands.getCommands(true);
    for (const c of [
      'aiWorkspace.createWorkspace',
      'aiWorkspace.newClaudeTerminal',
      'aiWorkspace.viewSplit',
      'aiWorkspace.renameTerminal',
    ]) {
      assert.ok(lenh.includes(c), `lệnh ${c} phải được đăng ký`);
    }
  });
});
