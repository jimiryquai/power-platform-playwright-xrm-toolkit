import { defineConfig } from 'vitest/config';

/**
 * Unit tests for pure-logic pieces of the toolkit — no browser, no live tenant.
 *
 * Anything needing a real Power Platform environment belongs in the e2e-tests
 * package and runs under Playwright instead.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
