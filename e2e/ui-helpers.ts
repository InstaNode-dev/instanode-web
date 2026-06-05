// e2e/ui-helpers.ts — browser-driving helpers for the real-backend UI journeys.
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md (Wave 3). The existing live
// specs are API-contract tests (they call the api via the `request` fixture).
// THIS wave is different: it renders the ACTUAL dashboard in the browser with a
// minted cohort session and clicks real buttons, so we catch UI-against-real-
// backend breakage (the login-broke class). These helpers wire the browser to
// the minted account + the prod api:
//
//   1. SAME-ORIGIN api base. The SPA is built with VITE_API_URL='' (relative
//      base, src/api/index.ts getAPIBaseURL), and the preview server proxies api
//      paths to the real prod api (vite.config.ts preview.proxy, gated on
//      E2E_LIVE_PROXY_TARGET). So every browser fetch — including the SSE log
//      streams (src/lib/sseStream.ts uses getAPIBaseURL + a Bearer header) — is
//      SAME-ORIGIN and proxied to prod. This is REQUIRED, not a convenience: the
//      prod api's CORS allowlist returns access-control-allow-origin ONLY for
//      https://instanode.dev (AUTH-004), so a direct cross-origin fetch from the
//      preview origin would be CORS-blocked ("Failed to fetch"). The proxy makes
//      the harness exercise the REAL backend without the CORS wall a real user on
//      instanode.dev never hits. (Discovered live 2026-06-06: the magic-link form,
//      which uses a raw cross-origin fetch, failed with "Failed to fetch" until
//      the same-origin proxy landed.)
//   2. The SPA authenticates from localStorage['instanode.token'] (TOKEN_KEY in
//      src/api/index.ts). We seed it with the minted session JWT so /app renders
//      authed (not the /login redirect) — the AuthGate is pure token-presence
//      (App.tsx), then the page calls /auth/me against the real api (proxied).
//   3. The dashboard env tab reads localStorage['instanode.env']
//      (useDashboardCtx ENV_KEY); we pin it to 'production' (the api seeds
//      resources/vault at the team's default env) so the UI reads line up with
//      what the factory created.

import type { Browser, BrowserContext, Page } from '@playwright/test'

// localStorage keys the SPA reads. Named consts (no-hardcoded-strings rule),
// kept in sync with src/api/index.ts (TOKEN_KEY) + src/hooks/useDashboardCtx.ts
// (ENV_KEY). A drift here would make the seeded session invisible to the app.
export const TOKEN_LS_KEY = 'instanode.token'
export const ENV_LS_KEY = 'instanode.env'

// The api-base override the SPA honours first — read by BOTH src/api/index.ts
// getAPIBaseURL() (the call() wrapper + SSE) AND src/pages/LoginPage.tsx
// resolveApiBase() (the magic-link raw fetch). We set it to the SAME-ORIGIN
// preview origin so every request the page issues stays same-origin and is
// proxied to prod (vite.config.ts preview.proxy) — sidestepping the CORS wall a
// direct cross-origin fetch from the preview origin would hit (AUTH-004 limits
// allow-origin to https://instanode.dev). Both code paths use `value || default`,
// so a non-empty same-origin value is what routes them through the proxy.
export const API_URL_WINDOW_KEY = '__INSTANODE_API_URL__'

/**
 * The web origin the preview server serves the SPA on. The live config's
 * webServer boots `vite preview` here; baseURL in the config points at it so
 * page.goto('/app') resolves against it. Overridable for a local run that
 * already has a dev server up.
 */
export function uiWebOrigin(): string {
  return (process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4173').replace(/\/$/, '')
}

interface AuthedPageOpts {
  /** The minted session JWT to seed as the SPA bearer. */
  sessionJWT: string
  /** Dashboard env tab to pin (default 'production' — the api's seed default). */
  env?: string
}

/**
 * Open a fresh browser context whose pages boot the SPA already (a) pointed at
 * the real prod api and (b) authenticated as the minted cohort session. The
 * init script runs BEFORE any app code on every navigation, so the very first
 * /app render is authed (no /login flash) and every fetch/SSE targets prod.
 *
 * Returns the context + a ready page. The caller disposes the context in a
 * finally (we keep one context per journey so localStorage is isolated).
 */
export async function newAuthedContext(
  browser: Browser,
  opts: AuthedPageOpts,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const env = opts.env ?? 'production'
  // addInitScript runs in page context before the app bundle — pin the
  // same-origin api base (→ proxied to prod) + seed the auth token + env tab so
  // the first paint is authed and every fetch/SSE stays same-origin.
  await context.addInitScript(
    ([apiKey, apiVal, tokKey, tokVal, envKey, envVal]) => {
      try {
        ;(window as unknown as Record<string, unknown>)[apiKey] = apiVal
        window.localStorage.setItem(tokKey, tokVal)
        window.localStorage.setItem(envKey, envVal)
      } catch {
        /* storage unavailable — the spec's first assertion will surface it */
      }
    },
    [API_URL_WINDOW_KEY, uiWebOrigin(), TOKEN_LS_KEY, opts.sessionJWT, ENV_LS_KEY, env] as const,
  )
  const page = await context.newPage()
  return { context, page }
}

/**
 * Open an UNAUTHENTICATED context (NO token) — used by the login-form leg (#1)
 * so the magic-link form submits against the real api (same-origin via the
 * preview proxy). Pins the same-origin api base so LoginPage's raw fetch routes
 * through the proxy rather than direct-to-prod (which would hit the CORS wall).
 */
export async function newAnonContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await context.addInitScript(
    ([apiKey, apiVal]) => {
      try {
        ;(window as unknown as Record<string, unknown>)[apiKey] = apiVal
      } catch {
        /* ignore */
      }
    },
    [API_URL_WINDOW_KEY, uiWebOrigin()] as const,
  )
  const page = await context.newPage()
  return { context, page }
}

/** Navigate to a dashboard path on the preview origin (e.g. '/app/resources'). */
export function appURL(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${uiWebOrigin()}${p}`
}
