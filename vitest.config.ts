import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    environment: 'node',
    // Unit tests must be deterministic: no network access.
    // Live Wikimedia tests live in tests/integration and run via `npm run test:integration`.
  },
});
