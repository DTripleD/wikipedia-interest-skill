import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Unit tests must be deterministic: no network access.
    // Live Wikimedia integration tests (added in later stages) are opt-in via RUN_INTEGRATION=1.
  },
});
