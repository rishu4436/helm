import { defineConfig } from '@playwright/test'

/** Runs against an already-running stack (scripts/dev-up.sh, or `next start` on :3000) and the local API on :4000. */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: '../../evidence/companion/playwright-report.json' }]],
  use: { baseURL: process.env.HELM_COMPANION_URL ?? 'http://localhost:3000', viewport: { width: 1440, height: 900 }, actionTimeout: 20_000, navigationTimeout: 60_000 },
})
