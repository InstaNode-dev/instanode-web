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
// drives the api directly via the `request` fixture (no SPA needed yet), so no
// webServer is started. Later WS1 PRs (P2..P6) add UI-driven LIVE specs; when
// the first of those lands it will add a webServer block here gated on E2E_LIVE.
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
    // No baseURL — specs use absolute E2E_API_URL so every request is explicit
    // about which (staging) backend it targets.
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // No webServer in WS1-P1 (smoke is api-direct). Added by the first
  // UI-driven LIVE spec in a later WS1 PR.
})
