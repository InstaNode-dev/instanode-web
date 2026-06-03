// Magic-link / cookie-exchange ROUND-TRIP integration test (P0).
//
// Background — the 2026-05-29 → 2026-05-30 prod-login outage chained THREE
// failures along the AUTH-004 cookie-exchange seam:
//   1. instanode-web missing the /auth/exchange cookie-exchange POST.
//   2. instanode-web sending Accept:application/json on /auth/exchange,
//      forcing a preflight the api's PreflightAllowlist rejected → 403 →
//      "TypeError: Failed to fetch".
//   3. api missing access-control-allow-credentials (ACAC) on the exchange
//      response, so even when the request succeeded the browser dropped the
//      cookie and the api returned 400 cookie_missing_or_expired.
//
// What the EXISTING gates cover (do NOT duplicate them here):
//   - e2e/auth-contract.spec.ts (Layer-1, prod target) and the api repo's
//     e2e/browser/tests/auth-contract-local.spec.ts (Layer-2, compose):
//     the CORS PREFLIGHT headers + a no-cookie cross-origin POST resolving
//     + /auth/email/start returning 202. Those prove the CORS *envelope*.
//   - The worker auth-probe: post-deploy delivery + CORS, 5-min cadence.
//
// THE GAP THIS SPEC CLOSES — the full cookie-exchange ROUND-TRIP, which no
// other test exercises end-to-end in a real browser:
//
//     real session JWT in the bridge cookie  (what /auth/email/callback sets)
//        → browser credentials:'include' POST /auth/exchange  (cross-origin)
//        → cookie is SENT cross-origin AND the ACAC header lets JS read {token}
//        → that token used as Authorization: Bearer on GET /auth/me
//        → /auth/me returns 200 with the claimed user's email + tier
//
// This is the precise seam that broke: a CORS regression that strips ACAC,
// or a cookie-scope/SameSite regression that stops the bridge cookie being
// sent cross-origin, would make the exchange return 400 (no token) — and
// THIS test would red the PR, where the contract-envelope tests (which use
// a no-cookie probe) would still pass.
//
// ── Why it can't drive the literal /auth/email/callback ──────────────────
// The callback consumes a single-use token that lives ONLY in the api's
// magic_links table — it is emailed, never returned by any API (anti-
// enumeration; verified in api/internal/handlers/magic_link.go Start/
// Callback). In prod the Brevo sender is unvalidated so no email arrives;
// in CI there's no inbox. So we reconstruct the EXACT post-callback state
// the browser would be in: a real claimed user (provision → /claim against
// the live api → real user_id/team_id rows) + a session JWT signed with the
// stack's JWT secret, planted in the same instanode_session_exchange cookie
// the callback's Set-Cookie writes. From there the browser drives the real
// SPA exchange→Bearer→/auth/me path unchanged. The JWT claim shape mirrors
// the api e2e helper makeSessionJWTWithUser (HS256 {uid,tid,email,jti,iat,exp}).
//
// ── How it runs / when it's gated ────────────────────────────────────────
// Requires a REACHABLE api AND the stack's JWT signing secret:
//   E2E_API_URL          — api base (e.g. http://localhost:8080 for compose,
//                          or a staging api). Must NOT be prod: planting an
//                          exchange cookie needs the prod JWT_SECRET, which
//                          we never put in CI. Defaults to the compose port.
//   E2E_WEB_ORIGIN       — the cross-origin document origin the SPA runs at
//                          (must be on the api's CORS allowlist; dev unlocks
//                          http://localhost:5173). Defaults to :5173.
//   E2E_JWT_SECRET       — the api's JWT_SECRET (HS256). REQUIRED. Without it
//                          we cannot mint the session JWT, so the test SKIPS
//                          with a loud reason rather than silently passing.
//
// Run it (compose stack up + reachable, secret exported):
//   E2E_API_URL=http://localhost:8080 \
//   E2E_WEB_ORIGIN=http://localhost:5173 \
//   E2E_JWT_SECRET=<api JWT_SECRET> \
//   npx playwright test --config=playwright.auth-roundtrip.config.ts
//
// In PR CI this is wired into the auth-roundtrip job in
// .github/workflows/auth-contract-e2e.yml. That job is best-effort: it runs
// only when an api is reachable + the secret is present; it does NOT red a
// PR for missing infra (a skipped test reports as skipped, not failed). The
// authoritative pre-merge gate for the round-trip is the api repo's Layer-2
// compose workflow path — see the brief. This Layer-1 spec is the
// instanode-web-side companion that runs the SAME assertions from the SPA's
// own tree against a staging/compose api.

import { createHmac, randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:8080').replace(/\/$/, '')
const WEB_ORIGIN = (process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? ''

// The transient bridge cookie /auth/email/callback sets (api auth.go
// exchangeCookieName / exchangeCookiePath). Path-scoped to /auth/exchange,
// HttpOnly, SameSite=Lax. We plant it with the SAME attributes the api does
// so the browser's send-decision (does it attach the cookie to a cross-
// origin credentialed POST?) matches production exactly.
const EXCHANGE_COOKIE_NAME = 'instanode_session_exchange'
const EXCHANGE_COOKIE_PATH = '/auth/exchange'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Mirror api/e2e/journeys_e2e_test.go makeSessionJWTWithUser EXACTLY:
// HS256 over {uid, tid, email, jti, iat, exp}. No `aud` claim — the e2e
// helper omits it and the api accepts HS256 session JWTs without it, so
// matching the helper keeps us aligned with the api's own contract test.
function mintSessionJWT(userID: string, teamID: string, email: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        uid: userID,
        tid: teamID,
        email,
        jti: randomUUID(),
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
  const signingInput = `${header}.${payload}`
  const sig = base64url(createHmac('sha256', JWT_SECRET).update(signingInput).digest())
  return `${signingInput}.${sig}`
}

interface CacheProvision {
  ok: boolean
  token: string
  note: string
}

interface ClaimResult {
  ok: boolean
  team_id: string
  user_id: string
}

function uniqueIP(): string {
  const b = () => Math.floor(Math.random() * 254) + 1
  return `10.${b()}.${b()}.${b()}`
}

function uniqueEmail(): string {
  return `web-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@instanode.dev`
}

// Pull the anon-upgrade JWT out of the `note` field of a /cache/new response
// (the note carries a "/start?t=<jwt>" upgrade link). This is the token the
// /claim endpoint promotes into a real team/user.
function extractUpgradeJWT(note: string): string {
  const marker = '?t='
  const idx = note.indexOf(marker)
  if (idx === -1) throw new Error(`no "?t=" upgrade token in /cache/new note: ${note}`)
  let tok = note.slice(idx + marker.length)
  const stop = tok.search(/[\s)"']/)
  if (stop !== -1) tok = tok.slice(0, stop)
  return tok
}

test.describe('AUTH-004 cookie-exchange round-trip (login-regression class)', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard gate: without the JWT secret we cannot mint the bridge cookie, so
  // the round-trip is impossible. Skip LOUDLY (not silently pass) — a
  // green-but-skipped result must be visible in the CI log so nobody
  // mistakes "skipped for missing infra" for "contract verified".
  test.skip(
    !JWT_SECRET,
    'E2E_JWT_SECRET not set — cannot mint the bridge session JWT. ' +
      'Set E2E_JWT_SECRET (the api JWT_SECRET) + E2E_API_URL to a NON-prod ' +
      'api (compose http://localhost:8080 or staging) to run the round-trip.',
  )

  test('claimed user → bridge cookie → cross-origin exchange → Bearer /auth/me 200', async ({
    page,
    request,
  }) => {
    // ── Step 1: provision an anonymous resource, extract the upgrade JWT ──
    const ip = uniqueIP()
    const cacheResp = await request.fetch(`${API_URL}/cache/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      failOnStatusCode: false,
    })
    test.skip(
      cacheResp.status() === 503,
      `cache service returned 503 at ${API_URL} — provisioning backend not enabled in this stack; ` +
        `cannot mint a real user for the round-trip.`,
    )
    expect(
      cacheResp.status(),
      `POST /cache/new should return 201; got ${cacheResp.status()}. ` +
        `Body: ${await cacheResp.text().catch(() => '<unreadable>')}`,
    ).toBe(201)
    const cache = (await cacheResp.json()) as CacheProvision
    const upgradeJWT = extractUpgradeJWT(cache.note)

    // ── Step 2: claim it → real user_id / team_id rows in the platform DB ─
    const email = uniqueEmail()
    const claimResp = await request.fetch(`${API_URL}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ jwt: upgradeJWT, email }),
      failOnStatusCode: false,
    })
    expect(
      claimResp.status(),
      `POST /claim should return 201; got ${claimResp.status()}. ` +
        `Body: ${await claimResp.text().catch(() => '<unreadable>')}`,
    ).toBe(201)
    const claim = (await claimResp.json()) as ClaimResult
    expect(claim.user_id, 'claim must return a user_id').toBeTruthy()
    expect(claim.team_id, 'claim must return a team_id').toBeTruthy()

    // ── Step 3: mint the session JWT the magic-link callback would have set,
    //            and plant it in the SAME bridge cookie (name/path/attrs)
    //            the api's setExchangeCookie writes. This reconstructs the
    //            EXACT browser state immediately after /auth/email/callback's
    //            302 to /login/callback?signed_in=1. ─────────────────────
    const sessionJWT = mintSessionJWT(claim.user_id, claim.team_id, email)
    const apiURL = new URL(API_URL)
    await page.context().addCookies([
      {
        name: EXCHANGE_COOKIE_NAME,
        value: sessionJWT,
        domain: apiURL.hostname,
        path: EXCHANGE_COOKIE_PATH,
        httpOnly: true,
        // Secure must follow the api scheme: prod/staging is https (Secure),
        // compose is http (must NOT be Secure or the browser drops it).
        secure: apiURL.protocol === 'https:',
        sameSite: 'Lax',
      },
    ])

    // ── Step 4: drive the SPA's REAL cross-origin exchange from a page
    //            rooted at the web origin. Mirrors LoginCallbackPage.tsx
    //            exchangeCookieForToken byte-for-byte: POST /auth/exchange,
    //            credentials:'include', NO custom headers (stays a simple
    //            CORS request, no preflight). ──────────────────────────────
    await page.route(`${WEB_ORIGIN}/__auth_roundtrip_origin_stub`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body>auth round-trip stub origin</body></html>',
      })
    })
    await page.goto(`${WEB_ORIGIN}/__auth_roundtrip_origin_stub`, { waitUntil: 'load' })
    const docOrigin = await page.evaluate(() => window.location.origin)
    expect(
      docOrigin,
      `document origin was ${docOrigin}, expected ${WEB_ORIGIN}; the exchange below ` +
        `would not be cross-origin and the test would miss the CORS/cookie regression.`,
    ).toBe(WEB_ORIGIN)

    const exchange = await page.evaluate(async ({ apiUrl }) => {
      try {
        const resp = await fetch(`${apiUrl}/auth/exchange`, {
          method: 'POST',
          credentials: 'include',
        })
        const body = (await resp.json().catch(() => null)) as { token?: string } | null
        return { threw: false, status: resp.status, token: body?.token ?? '' }
      } catch (e: unknown) {
        return { threw: true, error: String((e as Error)?.message ?? e), status: 0, token: '' }
      }
    }, { apiUrl: API_URL })

    // 4a. The fetch must RESOLVE — a thrown "Failed to fetch" here is the
    //     literal 2026-05-30 user symptom (ACAC/ACAO stripped from the
    //     exchange response).
    expect(
      exchange.threw,
      `cross-origin exchange threw — the EXACT 2026-05-30 login failure. ` +
        `Browser error: ${'error' in exchange ? exchange.error : ''}. ` +
        `Cause: api dropped access-control-allow-credentials/origin on /auth/exchange for ${WEB_ORIGIN}.`,
    ).toBe(false)

    // 4b. With a valid bridge cookie present AND a correct CORS contract,
    //     the exchange returns 200 + a non-empty token. A 400 here (the
    //     no-token path) means the browser did NOT send the bridge cookie
    //     cross-origin — a SameSite/Path/credentials or ACAC regression.
    //     This is the assertion the contract-envelope tests CANNOT make
    //     (they probe with no cookie and accept 4xx).
    expect(
      exchange.status,
      `exchange returned ${exchange.status}, expected 200. A 400 means the bridge cookie ` +
        `was not sent cross-origin (SameSite/Path/credentials regression) OR the api rejected it; ` +
        `a 5xx means the api is unhealthy. The cookie was planted with the same name/path/attrs ` +
        `the api's setExchangeCookie writes.`,
    ).toBe(200)
    expect(
      exchange.token.length,
      `exchange returned 200 but no token in the body — the SPA would throw ` +
        `"Session exchange returned no token" and login would wedge.`,
    ).toBeGreaterThan(0)

    // ── Step 5: use the exchanged token as a Bearer on /auth/me, cross-
    //            origin, exactly as the SPA does post-exchange. 200 + the
    //            claimed email proves the WHOLE seam works end-to-end. ─────
    const meStatus = await page.evaluate(async ({ apiUrl, token }) => {
      try {
        const resp = await fetch(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null
        return { threw: false, status: resp.status, email: (body?.email as string) ?? '' }
      } catch (e: unknown) {
        return { threw: true, error: String((e as Error)?.message ?? e), status: 0, email: '' }
      }
    }, { apiUrl: API_URL, token: exchange.token })

    expect(
      meStatus.threw,
      `cross-origin GET /auth/me threw — CORS regression on the management API surface. ` +
        `Browser error: ${'error' in meStatus ? meStatus.error : ''}.`,
    ).toBe(false)
    expect(
      meStatus.status,
      `GET /auth/me with the exchanged Bearer should return 200; got ${meStatus.status}. ` +
        `A 401 means the exchanged token is not accepted as a session JWT — the exchange handed ` +
        `back something /auth/me rejects, which would leave the user signed-out after a "successful" login.`,
    ).toBe(200)
    expect(
      meStatus.email,
      `GET /auth/me returned 200 but email=${meStatus.email}, expected the claimed ${email}. ` +
        `The exchanged session does not resolve to the user who just signed in.`,
    ).toBe(email)
  })
})
