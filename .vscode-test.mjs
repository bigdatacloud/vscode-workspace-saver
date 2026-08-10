import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/vscode/**/*.test.js',
  version: 'stable',
  mocha: { timeout: 30000 },
});
