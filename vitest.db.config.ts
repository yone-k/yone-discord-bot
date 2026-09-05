import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/db/**/*.test.ts'], watch: false,
    fileParallelism: false, testTimeout: 15000, hookTimeout: 30000,
  },
});
