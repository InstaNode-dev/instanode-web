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
