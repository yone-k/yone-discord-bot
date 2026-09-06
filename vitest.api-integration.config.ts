import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  environment: 'node', include: ['tests/api-integration/**/*.integration.ts'],
  fileParallelism: false, testTimeout: 15000, hookTimeout: 30000, watch: false
} });
