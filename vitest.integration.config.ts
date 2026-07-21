import { defineConfig } from 'vitest/config'

/**
 * Integration tests: real disk, real processes, real OS windows.
 *
 * Kept apart from the fast suite because they are slow, they touch the machine,
 * and some of them need a graphical Windows session. `npm test` must stay in
 * the hundreds of milliseconds so the red-green loop is worth running.
 */
export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.integration.test.ts'],
    environment: 'node',
    // Real processes and shared temp state do not tolerate parallel runs.
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
