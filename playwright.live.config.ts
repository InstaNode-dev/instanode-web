// WS1-P1 — dedicated Playwright config for the real-backend (LIVE) E2E harness.
//
// Plan: docs/sessions/2026-06-04/OBSERVABILITY-AND-INTELLIGENCE-PLAN.md, WS1.
//
// Distinct from the default playwright.config.ts (mocked, per-PR, boots the
// Vite dev server) and from playwright.auth-roundtrip.config.ts (the auth seam
// only). This config runs the cohort-safe LIVE specs that create REAL backend
// resources and reap them (rule 24).
//
// WS1-P1 ships exactly one spec under it — live-provision-smoke.spec.ts — which
// drives the api directly via the `request` fixture (no SPA needed yet). Wave 3
// (live-ui-*.spec.ts) adds UI-driven LIVE specs that render the ACTUAL dashboard
// in the browser against the real api; those need the SPA served, so a
// `vite preview` webServer is wired below (gated on E2E_LIVE so the api-direct
// specs still run with no server when E2E_LIVE is unset).
//
// Gating: the specs themselves self-skip (loudly) when E2E_LIVE!=1 or
// E2E_API_URL is unset / returns 503, so this config is safe to wire into a
// best-effort, manual/scheduled CI job that never reds a PR for missing infra.
//
// Invoke:
//   E2E_LIVE=1 E2E_API_URL=https://staging-api.instanode.dev \
//   npx playwright test --config=playwright.live.config.ts
// then, in teardown (even on failure):
//   E2E_API_URL=https://staging-api.instanode.dev npm run reap:live

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Only the LIVE specs — never the mocked suite.
  testMatch: ['live-*.spec.ts'],

  // Real network round-trips against a (staging) api. Serial + single worker:
  // these create real resources; keeping them serial avoids fingerprint-dedup
  // contention and keeps the ledger writes race-free.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // 120s per test (was 90s). Secondary guard only: the PRIMARY fix is pinning
  // every dedicated-backing-DB provision (db/vector/nosql) to the fast anon
  // hot-pool via forceAnon (see e2e/cohort.ts + live-anon-provision.spec.ts) so
  // no test depends on a slow authed-dedicated-provision finishing in time. The
  // modest bump gives extra headroom for a cold hot-pool / network slowness.
  timeout: 120_000,
  expect: { timeout: 20_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]]
    : [['list']],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // baseURL serves the UI journeys' page.goto('/app/...') against the
    // preview origin (the SPA). The api-direct specs ignore it and use the
    // absolute E2E_API_URL via the `request` fixture, so it's harmless there.
    baseURL: process.env.E2E_WEB_ORIGIN || 'http://localhost:4173',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // webServer — only for the UI-driven LIVE journeys (live-ui-*.spec.ts), which
  // render the real dashboard against the real api. Gated on E2E_LIVE so the
  // api-direct LIVE specs (live-provision-smoke etc.) still run with NO server
  // when E2E_LIVE is unset. `vite preview` serves the production SPA bundle on
  // :4173 and PROXIES api paths to the real prod api (E2E_LIVE_PROXY_TARGET →
  // vite.config.ts preview.proxy). The SPA's api base is pinned per-context to
  // the SAME-ORIGIN preview origin (e2e/ui-helpers.ts), so every browser request
  // is same-origin and forwarded to prod by the proxy — exercising the REAL
  // backend WITHOUT the CORS wall a direct cross-origin fetch from the preview
  // origin would hit (the prod api allows only https://instanode.dev as origin).
  // When E2E_WEB_ORIGIN is set (a dev server is already up), the server is reused.
  webServer: process.env.E2E_LIVE === '1'
    ? {
        command: `E2E_LIVE_PROXY_TARGET=${process.env.E2E_API_URL || 'https://api.instanode.dev'} npm run build && E2E_LIVE_PROXY_TARGET=${process.env.E2E_API_URL || 'https://api.instanode.dev'} npm run preview -- --port 4173 --strictPort`,
        url: process.env.E2E_WEB_ORIGIN || 'http://localhost:4173',
        reuseExistingServer: !process.env.CI || !!process.env.E2E_WEB_ORIGIN,
        timeout: 240_000,
      }
    : undefined,
})
