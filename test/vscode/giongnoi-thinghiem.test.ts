/**
 * Thí nghiệm có tiếng thật: micro giả của Chromium đọc một file WAV tiếng Việt, dictation của VS
 * Code nghe, ta đọc lại chữ. Ba ca: editor thuần, terminal thuần của VS Code, và `BoNgheGiongNoi`
 * (editor nháp → terminal). Chọn ca bằng `-g`.
 *
 * Chỉ chạy khi đặt AI_WORKSPACE_THI_NGHIEM_GIONG_NOI=1 và dùng `.vscode-test.giongnoi.mjs`
 * (cờ micro giả + AI_WORKSPACE_WAV). Cần model đã tải trong user-data của bản test.
 */
import * as assert from 'node:assert';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { BoNgheGiongNoi } from '../../src/ui/giongnoi';

const BAT = process.env.AI_WORKSPACE_THI_NGHIEM_GIONG_NOI === '1';
const CHO_MODEL_MS = Number(process.env.AI_WORKSPACE_CHO_MODEL_MS ?? '45000');
const KET_QUA = join(tmpdir(), 'ai-workspace-giongnoi-ketqua.txt');
const STDIN_LOG = join(tmpdir(), 'ai-workspace-terminal-stdin.txt');
const STDIN_META = `${STDIN_LOG}.meta`;

const ngu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ghi: string[] = [];
const log = (d: string): void => {
  ghi.push(`${new Date().toISOString()} ${d}`);
  writeFileSync(KET_QUA, ghi.join('\n'), 'utf8');
};
const motDong = (s: string): string => s.replace(/\r?\n/g, '⏎');
const doc = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/**
 * Terminal là một tiến trình node ghi MỌI byte của stdin ra file, kèm file .meta nói stdin có phải
 * TTY và đã vào được raw mode chưa — cooked mode thì chữ chỉ tới khi có Enter, nên test tự gửi
 * Enter SAU khi đọc lần đầu, để vừa thấy chữ vừa chứng minh lớp không tự gửi Enter.
 */
function taoTerminalGhiStdin(): vscode.Terminal {
  for (const f of [STDIN_LOG, STDIN_META]) if (existsSync(f)) unlinkSync(f);
  // PowerShell thật: Console.In dưới conpty là console thật (node chạy trong Electron thì không).
  // Cooked mode: mỗi Enter là một dòng được ghi ra file — test tự gửi Enter sau khi đọc lần đầu.
  const lenh = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Set-Content -LiteralPath '" + STDIN_META + "' -Value ('isTTY=' + [Environment]::UserInteractive); Set-Content -LiteralPath '" + STDIN_LOG + "' -Value ''; while ($true) { $l = [Console]::In.ReadLine(); if ($null -eq $l) { break }; Add-Content -LiteralPath '" + STDIN_LOG + "' -Value $l -Encoding UTF8 }";
  return vscode.window.createTerminal({ name: 'thinghiem', shellPath: 'powershell.exe', shellArgs: ['-NoProfile', '-NoLogo', '-Command', lenh] });
}

/** Chờ tới khi terminal này thật sự là terminal hoạt động — không thì dictation gõ vào terminal khác. */
async function choHoatDong(term: vscode.Terminal): Promise<void> {
  const han = Date.now() + 8_000;
  while (vscode.window.activeTerminal !== term && Date.now() < han) {
    term.show(false);
    await ngu(300);
  }
  await ngu(2_000);
  log(`[terminal] meta: ${doc(STDIN_META)} | các terminal: ${vscode.window.terminals.map((t) => t.name).join(', ')} | hoạt động là terminal thí nghiệm: ${vscode.window.activeTerminal === term}`);
}

suite('dictation tích hợp — thí nghiệm có tiếng thật', () => {
  test('1. editor thuần', async function () {
    if (!BAT) return this.skip();
    this.timeout(240_000);
    if (existsSync(KET_QUA)) unlinkSync(KET_QUA);
    const d = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '' });
    await vscode.window.showTextDocument(d);
    await vscode.commands.executeCommand('workbench.action.editorDictation.start');
    log(`[editor] start; chờ ${CHO_MODEL_MS} ms`);
    await ngu(CHO_MODEL_MS);
    await vscode.commands.executeCommand('workbench.action.editorDictation.stop');
    await ngu(5_000);
    log(`[editor] KẾT QUẢ: "${motDong(d.getText()).slice(0, 200)}"`);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  test('2. terminal thuần của VS Code', async function () {
    if (!BAT) return this.skip();
    this.timeout(240_000);
    const term = taoTerminalGhiStdin();
    await choHoatDong(term);
    await vscode.commands.executeCommand('workbench.action.terminal.startVoice');
    log(`[terminal] startVoice; chờ ${CHO_MODEL_MS} ms`);
    await ngu(CHO_MODEL_MS);
    await vscode.commands.executeCommand('workbench.action.terminal.stopVoice');
    await ngu(6_000);
    log(`[terminal] trước Enter, stdin: "${motDong(doc(STDIN_LOG)).slice(0, 200)}"`);
    term.sendText('', true);
    await ngu(1_500);
    log(`[terminal] KẾT QUẢ stdin: "${motDong(doc(STDIN_LOG)).slice(0, 200)}"`);
    term.dispose();
    await ngu(1_000);
  });

  test('3. BoNgheGiongNoi: editor nháp → terminal', async function () {
    if (!BAT) return this.skip();
    this.timeout(240_000);
    const term = taoTerminalGhiStdin();
    await choHoatDong(term);
    const nghe = new BoNgheGiongNoi();
    try {
      await nghe.toggle();
      log(`[bo-nghe] bật; chờ ${CHO_MODEL_MS} ms`);
      await ngu(CHO_MODEL_MS);
      await nghe.toggle();
      await ngu(3_000);
      const truocEnter = doc(STDIN_LOG);
      log(`[bo-nghe] trước Enter, stdin: "${motDong(truocEnter).slice(0, 200)}"`);
      term.sendText('', true);
      await ngu(1_500);
      const chu = doc(STDIN_LOG);
      log(`[bo-nghe] KẾT QUẢ stdin: "${motDong(chu).slice(0, 200)}"`);
      assert.ok(chu.trim().length > 0, 'terminal phải nhận được chữ');
      // Đầu dò tự ghi một dòng trống lúc khởi động — chỉ nội dung có chữ mới tính.
      assert.strictEqual(truocEnter.trim(), '', 'không được tự gửi Enter');
    } finally {
      nghe.dispose();
      term.dispose();
    }
  });
});
