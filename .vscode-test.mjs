import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  // Bộ này đo MÃ NGUỒN (qua extensionDevelopmentPath). Ca đo BẢN ĐÃ CÀI từ VSIX nằm ở
  // `test/vscode-cai/` và chạy bằng `.vscode-test-cai.mjs` — tách thư mục chứ không lọc bằng
  // `!`: mẫu phủ định không được `files` hỗ trợ, và lần đầu tôi tưởng có nên bộ này đỏ.
  files: 'out/test/vscode/**/*.test.js',
  version: 'stable',
  mocha: { timeout: 90000 },
});
