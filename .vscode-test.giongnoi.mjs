import { defineConfig } from '@vscode/test-cli';

// Cấu hình RIÊNG cho thí nghiệm giọng nói: Chromium cấp một micro giả đọc từ file WAV, nên
// không cần loa, không dính khử tiếng vọng của micro thật. Không dùng cho test hồi quy.
const wav = process.env.AI_WORKSPACE_WAV ?? '';

export default defineConfig({
  files: 'out/test/vscode/giongnoi-thinghiem.test.js',
  version: 'stable',
  mocha: { timeout: 240000 },
  launchArgs: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`],
});
