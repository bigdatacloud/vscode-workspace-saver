import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'test/model/**/*.test.ts', 'test/adopt/**/*.test.ts', 'test/claude/**/*.test.ts', 'test/workspace/**/*.test.ts', 'test/proc/**/*.test.ts', 'test/capture/**/*.test.ts'],
    environment: 'node',
  },
});
