// Dedicated Playwright config for the Layer-1 PR-gate auth-contract smoke.
//
// Why a separate config: the default playwright.config.ts boots a local Vite
// dev server (webServer) and runs the whole e2e/ suite (which uses Vite-served
// mocks). This spec is fundamentally different — it talks to PROD api +
// web origin directly. No webServer needed; no other specs in scope.
//
// Invoked by:
//   npx playwright test --config=playwright.auth-contract.config.ts
//
// Env knobs (default to prod):
//   E2E_API_URL=https://api.instanode.dev
//   E2E_WEB_ORIGIN=https://instanode.dev

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['auth-contract.spec.ts'],

  // Smoke test — bounded run. The whole suite is 3 fast tests against live
  // prod; nothing should take more than a few seconds.
  timeout: 30_000,
  expect: { timeout: 10_000 },

  fullyParallel: false, // 3 serial tests; parallelism not worth the noise.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-auth-contract' }]]
    : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // No baseURL — the spec uses absolute URLs (E2E_WEB_ORIGIN / E2E_API_URL)
    // so tests must be explicit about which origin they're hitting.
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Deliberately no `webServer` — this spec hits prod, not a local Vite dev
  // server. Adding one here would slow CI by ~30s for no benefit.
})
