// Dedicated Playwright config for the magic-link cookie-exchange ROUND-TRIP
// integration spec (e2e/auth-roundtrip.spec.ts).
//
// Distinct from playwright.auth-contract.config.ts (which probes the CORS
// envelope against PROD with no cookie): this one drives the FULL exchange
// round-trip and therefore needs a NON-prod api it can mint a bridge cookie
// for (E2E_JWT_SECRET) + provision against. It runs no webServer — the SPA
// origin is a route-fulfilled stub; the api is external (compose/staging).
//
// Invoked by:
//   E2E_API_URL=http://localhost:8080 \
//   E2E_WEB_ORIGIN=http://localhost:5173 \
//   E2E_JWT_SECRET=<api JWT_SECRET> \
//   npx playwright test --config=playwright.auth-roundtrip.config.ts
//
// The spec self-skips (loudly) when E2E_JWT_SECRET is unset or the
// provisioning backend returns 503, so this config is safe to wire into a
// best-effort CI job without redding PRs that lack the infra.

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['auth-roundtrip.spec.ts'],

  // One serial test; bounded. Provision + claim + exchange + /auth/me is a
  // handful of round-trips against a local/staging api.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-auth-roundtrip' }]]
    : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // No baseURL — the spec uses absolute E2E_API_URL / E2E_WEB_ORIGIN so
    // every fetch is explicit about which origin it targets (the whole point
    // of a cross-origin contract test).
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // No webServer: the api is external; the web origin is a stub page.
})
