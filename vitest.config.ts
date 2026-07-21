import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Tests live next to the code they test (*.test.ts beside the source).
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests (real processes, real windows, real disk) are slow and
    // need a graphical session. They get their own command, not this one.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    environment: 'node',
  },
})
