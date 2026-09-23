import { defineConfig } from 'vitest/config';

// Live tests that hit the real Wikimedia APIs. Run with `npm run test:integration`.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // Run files sequentially to respect Wikimedia request etiquette.
    fileParallelism: false,
  },
});
