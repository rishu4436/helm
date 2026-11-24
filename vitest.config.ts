import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/glasses/src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // API suites share one Postgres test DB and TRUNCATE between tests → run files serially.
    fileParallelism: false,
    reporters: ['default'],
  },
})
