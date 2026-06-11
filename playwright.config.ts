import { defineConfig, devices } from '@playwright/test';

// LIVE mode (E2E_LIVE=1): Vite proxy forwards /api, /auth, /claim, /db, etc.
// to the upstream agent API. Mocked routes in the test files are skipped.
// Set AGENT_API_URL to override the upstream (default: http://api.instanode.dev).
//
// MOCKED mode (default): VITE_NO_PROXY=1 keeps the dashboard same-origin so
// every page.route() glob in the test files intercepts the fetch.
const live = process.env.E2E_LIVE === '1';

export default defineConfig({
  testDir: './e2e',
  // Playwright owns *.spec.ts only. Vitest-only guards live as e2e/*.test.ts
  // (e.g. prod-coverage-donebar.test.ts) and must NOT be picked up by the
  // Playwright runner — they use vitest's describe/it and crash under the
  // Playwright runtime. The default testMatch also globs *.test.ts, so we pin it
  // to *.spec.ts here.
  testMatch: ['**/*.spec.ts'],
  // The mocked per-PR suite excludes the LIVE real-backend specs — those run
  // only under playwright.live.config.ts (E2E_LIVE=1, manual/scheduled). They
  // self-skip anyway, but keeping them out of the default config means the
  // per-PR gate never boots a browser for a spec that always skips here, and
  // the two suites stay cleanly separated.
  //
  // auth-contract.spec.ts is ALSO excluded here: it makes UNCONDITIONAL real
  // fetches to PROD (api.instanode.dev) to assert the AUTH-004 CORS envelope,
  // so it does NOT belong in this mocked, same-origin (VITE_NO_PROXY=1) gate —
  // it has its own dedicated config (playwright.auth-contract.config.ts) and
  // workflow (auth-contract-e2e.yml) that run it against prod. Leaving it in
  // the default glob made the required `playwright` job depend on prod being
  // reachable: when the prod cluster is down/paused the fetch times out and
  // the mocked gate fails for a reason that has nothing to do with the PR.
  // The prod-targeting assertion still runs (and is allowed to go red while
  // prod is down) in its own non-required workflow.
  testIgnore: ['live-*.spec.ts', 'auth-contract.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: live
      ? `AGENT_API_URL=${process.env.AGENT_API_URL ?? 'http://api.instanode.dev'} npm run dev -- --port 5173`
      : 'VITE_NO_PROXY=1 npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
