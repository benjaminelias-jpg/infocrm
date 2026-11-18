import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    teardownTimeout: 20_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
  },
});
