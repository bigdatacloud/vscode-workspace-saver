import { defineConfig } from '@vscode/test-cli';

// Nạp thư mục extensions THẬT của người dùng để cửa sổ test dùng bản đã cài từ VSIX, thay vì
// mã nguồn trong `dist/`. Không truyền `extensionDevelopmentPath` — đó chính là điểm khác.
export default defineConfig({
  files: 'out/test/vscode-cai/**/*.test.js',
  version: 'stable',
  extensionDevelopmentPath: null,
  launchArgs: ['--extensions-dir', process.env.AIWS_EXT_DIR ?? ''],
  mocha: { timeout: 120000 },
});
