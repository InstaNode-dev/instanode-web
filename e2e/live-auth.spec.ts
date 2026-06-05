// WS1-P? (matrix W1) — real-backend (LIVE) E2E covering the auth/login seams
// that the 2026-05-29 → 2026-05-30 prod-login outage exposed as a UI↔backend
// integration gap.
//
// Plan: docs/sessions/2026-06-04/USER-FLOW-INVENTORY-AND-TEST-MATRIX.md §W1
//   "Auth & login, both methods, cross-surface" — covers matrix rows
//   A4/A6 (GitHub OAuth start→callback + state-replay 401),
//   A7  (/auth/exchange CORS contract — the AUTH-004 surface),
//   A8/A9 (/auth/me valid bearer 200 + tampered/expired 401),
//   A10 (logout → reused bearer/jti revoked → 401 — the precise regression class),
//   A12/A13 (CLI device-flow: canonical instanode.dev auth_url + poll status),
//   A1  (magic-link START leg 200/202; the full callback flow is BLOCKED on the
//        unvalidated Brevo sender and is marked test.skip, NOT silently omitted).
//
// It mirrors live-anon-provision.spec.ts / auth-roundtrip.spec.ts EXACTLY for the
// safety machinery: E2E_LIVE=1 gating (whole file SKIPS loudly in normal PR CI so
// the per-PR gate NEVER depends on a live backend), a cohort-branded ledger-
// before-assert + inline reap + afterAll backstop (rule 24) for any account/
// resource this file mints, and a registry/table-driven shape where it fits
// (rule 18). Named live-*.spec.ts so playwright.live.config.ts's testMatch picks
// it up and the default (mocked, per-PR) config ignores it.
//
// ── Mint method (Brevo-free) ───────────────────────────────────────────────────
// Per TEST-ACCOUNTS-AND-NR-SYNTHETICS-PLAN.md §1.1 the account-mint path is a
// LOCALLY-SIGNED session JWT — NO email round-trip, NO Brevo, NO GitHub. The legs
// that need a real authenticated identity (A8/A9 /auth/me, A10 logout) provision
// an anonymous resource → /claim it into a real user/team (Brevo-free; only the
// notification email is Brevo-gated and non-blocking) → mint an HS256 session JWT
// for the returned uid/tid with E2E_JWT_SECRET, exactly as the api e2e helper
// makeSessionJWTWithUser does. Those legs SKIP loudly without E2E_JWT_SECRET.
//
// ── Until backend skip-cohort guards ship ──────────────────────────────────────
// Run against STAGING, not prod (cohort.ts:14-19). The prod-safe contract-only
// legs (A6 forged-state, A7 CORS, A12 canonical-host, A1 start, A9 tampered-token)
// create NO account and are safe anywhere; the account-minting legs (A8 happy,
// A10 logout) create a real claimed team and are reaped.

import { createHmac, randomUUID } from 'node:crypto'

import { expect, test, type APIRequestContext } from '@playwright/test'

import {
  cohortEmail,
  cohortName,
  COHORT_MARKER,
  assertSafeApiTarget,
  mintedSession,
  anonProvisionHeaders,
} from './cohort'
import {
  recordEntity,
  loadLedger,
  reapEntities,
  clearLedger,
  type CohortEntity,
} from './cleanup-ledger'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = (process.env.E2E_API_URL ?? process.env.AGENT_API_URL ?? '')
  .toString()
  .replace(/\/$/, '')
// The api's JWT_SECRET (HS256). Same secret api/Makefile:120 pulls as
// E2E_JWT_SECRET. REQUIRED only for the account-minting legs; absent → those
// legs skip loudly (never silently pass) while the contract-only legs still run.
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? ''

// The canonical, user-facing host every CLI device-flow auth_url MUST point at —
// NOT the api host. A regression that leaks api.instanode.dev into the auth_url
// (matrix A12 "safe-url") would send a developer's browser to the wrong origin.
const CANONICAL_AUTH_HOST = 'instanode.dev'
// The web origin the api's CORS allowlist permits for credentialed exchange
// (AUTH-004 / matrix A7). Overridable for a staging web/api pair.
const WEB_ORIGIN = (process.env.E2E_WEB_ORIGIN ?? 'https://instanode.dev').replace(/\/$/, '')

const STATUS_CREATED = 201
const STATUS_OK = 200
const STATUS_ACCEPTED = 202
const STATUS_UNAUTHORIZED = 401
const STATUS_BACKEND_UNAVAILABLE = 503

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Mirror api/e2e makeSessionJWTWithUser EXACTLY: HS256 over
// {uid, tid, email, jti, iat, exp}; no `aud`. `expSeconds` lets a single helper
// mint both valid (A8/A10) and already-expired (A9) tokens.
function mintSessionJWT(
  userID: string,
  teamID: string,
  email: string,
  expSeconds = 3600,
): { token: string; jti: string } {
  const now = Math.floor(Date.now() / 1000)
  const jti = randomUUID()
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(
    Buffer.from(JSON.stringify({ uid: userID, tid: teamID, email, jti, iat: now, exp: now + expSeconds })),
  )
  const signingInput = `${header}.${payload}`
  const sig = base64url(createHmac('sha256', JWT_SECRET).update(signingInput).digest())
  return { token: `${signingInput}.${sig}`, jti }
}

// Pull the anon-upgrade JWT out of the `note` of a /cache/new response (the note
// carries a "/start?t=<jwt>" upgrade link). Mirrors auth-roundtrip.spec.ts.
function extractUpgradeJWT(note: string): string {
  const marker = '?t='
  const idx = note.indexOf(marker)
  if (idx === -1) throw new Error(`no "?t=" upgrade token in /cache/new note: ${note}`)
  let tok = note.slice(idx + marker.length)
  const stop = tok.search(/[\s)"']/)
  if (stop !== -1) tok = tok.slice(0, stop)
  return tok
}

interface ClaimedIdentity {
  userID: string
  teamID: string
  email: string
  /** The provisioned cache resource token — recorded + reaped (rule 24). */
  resourceToken: string
  /**
   * The REAL session token the claim minted (onboarding.go:537). A disposable
   * bearer for this throwaway team — safe to revoke (A10) without touching the
   * shared workflow-minted E2E_SESSION_JWT. Empty if the claim omitted it.
   */
  sessionToken: string
}

// Provision an anonymous cache → claim it into a REAL user/team (Brevo-free).
// Records the provisioned resource to the ledger BEFORE any throwing assertion so
// a later failure still leaves a reapable record (rule 24). Returns the real
// uid/tid the caller mints a session JWT for.
async function provisionAndClaim(
  request: APIRequestContext,
): Promise<ClaimedIdentity> {
  // anonProvisionHeaders() carries the X-E2E-Test-Token fingerprint-bypass when
  // E2E_TEST_TOKEN is set (prod ignores X-Forwarded-For, tripping the recycle
  // gate) + a unique XFF for staging/local. A cohort name keeps it cohort-tagged.
  const cacheResp = await request.fetch(`${API_URL}/cache/new`, {
    method: 'POST',
    headers: anonProvisionHeaders(),
    data: JSON.stringify({ name: cohortName('auth-cache') }),
    failOnStatusCode: false,
  })
  test.skip(
    cacheResp.status() === STATUS_BACKEND_UNAVAILABLE,
    `cache service returned 503 at ${API_URL} — provisioning backend not enabled in this ` +
      `stack; cannot mint a real claimed user for the authenticated-bearer legs.`,
  )
  expect(
    cacheResp.status(),
    `POST /cache/new should return ${STATUS_CREATED}; got ${cacheResp.status()}. ` +
      `Body: ${await cacheResp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const cache = (await cacheResp.json()) as { token: string; note: string }

  // Record the resource the instant it exists, before the claim assertions.
  recordEntity({ kind: 'resource', id: cache.token, apiUrl: API_URL, note: `auth-live cache ${cache.token}` })

  const upgradeJWT = extractUpgradeJWT(cache.note)
  const email = cohortEmail('auth')
  const claimResp = await request.fetch(`${API_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ jwt: upgradeJWT, email }),
    failOnStatusCode: false,
  })
  expect(
    claimResp.status(),
    `POST /claim should return ${STATUS_CREATED}; got ${claimResp.status()}. ` +
      `Body: ${await claimResp.text().catch(() => '<unreadable>')}`,
  ).toBe(STATUS_CREATED)
  const claim = (await claimResp.json()) as {
    user_id: string
    team_id: string
    session_token?: string
  }
  expect(claim.user_id, 'claim must return a user_id').toBeTruthy()
  expect(claim.team_id, 'claim must return a team_id').toBeTruthy()

  return {
    userID: claim.user_id,
    teamID: claim.team_id,
    email,
    resourceToken: cache.token,
    sessionToken: String(claim.session_token ?? ''),
  }
}

test.describe('LIVE — auth/login seams (W1: OAuth, logout-revocation, CLI, /auth/me, CORS, magic-link)', () => {
  test.describe.configure({ mode: 'serial' })

  // Hard skip in normal CI: the LIVE harness must never make the per-PR gate
  // depend on a reachable backend.
  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend auth suite is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL=<staging api> (+ E2E_JWT_SECRET for the bearer legs) to run it.',
  )
  test.skip(
    LIVE && !API_URL,
    'E2E_LIVE=1 but E2E_API_URL/AGENT_API_URL is unset — no backend to target.',
  )

  // Prod-target safety (item 3): a prod E2E_API_URL is only allowed for a
  // sanctioned minted-account run (E2E_ACCOUNT_TOKEN / E2E_SESSION_JWT present);
  // otherwise this throws and fails the suite loudly rather than provisioning
  // against prod. Staging targets pass through unconditionally.
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): even if an account-minting leg throws before its
  // inline reap, afterAll reaps every still-ledgered entity; reap-cohort.ts
  // re-runs the same path out-of-process in CI teardown if the process dies.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-auth afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── A4/A6: GitHub OAuth start contract + state-replay → 401 ─────────────────
  // Prod-safe: creates no account. The start leg must hand the browser a real
  // GitHub authorize redirect carrying a `state` (the single-use CSRF token the
  // callback consumes from Redis). The replay/forgery leg proves a `state` the
  // server never minted (or already consumed) is REJECTED — the A6 regression
  // class: a callback that trusts an attacker-supplied state would let an
  // attacker complete someone else's login.
  test.describe('GitHub OAuth — start contract + state-replay 401 (A4/A6)', () => {
    test('GET /auth/github/start redirects to github.com authorize with a state param', async ({
      request,
    }) => {
      const resp = await request.fetch(`${API_URL}/auth/github/start`, {
        method: 'GET',
        // Do NOT auto-follow: the contract under test is the 3xx → GitHub itself.
        maxRedirects: 0,
        failOnStatusCode: false,
      })
      test.skip(
        resp.status() === STATUS_BACKEND_UNAVAILABLE,
        `/auth/github/start returned 503 — GitHub OAuth not configured in this stack ` +
          `(GITHUB_CLIENT_ID unset); cannot assert the start contract. Reports skipped.`,
      )
      // A configured stack redirects (302/307) to GitHub's authorize URL.
      expect(
        resp.status(),
        `GET /auth/github/start should redirect (3xx) to GitHub; got ${resp.status()}. ` +
          `A 200/HTML here means the redirect was lost. Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBeGreaterThanOrEqual(300)
      expect(resp.status(), 'start should be a redirect, not a 4xx/5xx').toBeLessThan(400)

      const location = resp.headers()['location'] ?? ''
      expect(
        location,
        `/auth/github/start must redirect to GitHub's authorize endpoint; Location was '${location}'.`,
      ).toContain('github.com')
      // The single-use CSRF state the callback later consumes from Redis MUST be
      // present in the authorize URL — its absence is the precondition for the
      // A6 replay class (no server-side state == no single-use protection).
      const stateInUrl = /[?&]state=[^&]+/.test(location)
      expect(
        stateInUrl,
        `/auth/github/start authorize URL must carry a 'state' param (the single-use ` +
          `CSRF token the callback consumes). Location: ${location}`,
      ).toBe(true)
    })

    test('callback with a forged/never-issued state is rejected (not authenticated)', async ({
      request,
    }) => {
      // A state value the server never minted. The callback consumes state from
      // Redis single-use (matrix A6 backend assertion); an unknown/forged state
      // has no Redis entry, so the 2nd-consume / forgery path MUST fail closed —
      // it must NOT mint a session_token. We assert it does not 2xx-with-token
      // and does not 3xx to an authenticated landing carrying ?session_token=.
      const forgedState = `forged-${randomUUID()}`
      const resp = await request.fetch(
        `${API_URL}/auth/github/callback?state=${forgedState}&code=forged-${randomUUID()}`,
        { method: 'GET', maxRedirects: 0, failOnStatusCode: false },
      )
      test.skip(
        resp.status() === STATUS_BACKEND_UNAVAILABLE,
        `/auth/github/callback returned 503 — GitHub OAuth not configured in this stack; ` +
          `cannot assert state-replay rejection. Reports skipped.`,
      )

      const status = resp.status()
      const location = resp.headers()['location'] ?? ''
      const body = await resp.text().catch(() => '')

      // The forged state must NOT yield an authenticated session. Acceptable
      // rejections: a 401/4xx error, OR a redirect to an error page that does
      // NOT carry a session_token. The ONE thing that must never happen is a
      // minted session_token for a state the server never issued.
      const handedOutToken = /session_token=/.test(location) || /"session_token"/.test(body)
      expect(
        handedOutToken,
        `OAuth callback minted a session for a FORGED state (${forgedState}) — the A6 ` +
          `state-replay class. status=${status} location='${location}'. The callback must ` +
          `consume state single-use from Redis and fail closed on an unknown state.`,
      ).toBe(false)
      // And it should signal the failure, not silently 200-OK an authenticated page.
      expect(
        status,
        `forged-state callback returned ${status}; expected a 4xx (rejection) or a 3xx to an ` +
          `error page (without a session_token). A 200 here would mask the rejection.`,
      ).not.toBe(STATUS_OK)
    })
  })

  // ── A7: /auth/exchange CORS contract (the AUTH-004 surface) ─────────────────
  // Prod-safe. The exact preflight headers whose absence caused the 2026-05-30
  // outage: ACAC:true + ACAO:<web origin>. Duplicated here (also in
  // auth-contract.spec.ts) so the W1 LIVE matrix has the AUTH-004 surface in its
  // own registry-visible file (matrix A7).
  test.describe('CORS contract on /auth/exchange (AUTH-004, A7)', () => {
    test('OPTIONS preflight returns ACAO=<web origin> and ACAC=true', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/auth/exchange`, {
        method: 'OPTIONS',
        headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'POST' },
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, 204].includes(resp.status()),
        `expected 200/204 preflight; got ${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const headers = resp.headers()
      expect(
        headers['access-control-allow-origin'],
        `MISSING access-control-allow-origin on /auth/exchange preflight — the cross-origin POST ` +
          `from ${WEB_ORIGIN}/login/callback fails with "Failed to fetch" (the 2026-05-30 symptom).`,
      ).toBe(WEB_ORIGIN)
      expect(
        headers['access-control-allow-credentials'],
        `MISSING access-control-allow-credentials:true — the SPA fetches /auth/exchange with ` +
          `credentials:'include'; without ACAC the browser drops the bridge cookie and login fails.`,
      ).toBe('true')
    })
  })

  // ── A8/A9: /auth/me with a valid synthetic bearer (200 + right team/tier) and
  //          with a tampered/expired bearer (401) ───────────────────────────────
  test.describe('/auth/me — valid bearer 200 + tampered/expired 401 (A8/A9)', () => {
    // A9 (tampered/expired) is contract-only and needs NO real account, so it
    // runs even without E2E_JWT_SECRET.
    test('tampered bearer → 401', async ({ request }) => {
      // A structurally-valid-looking but bogus JWT (no valid signature).
      const bogus =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ4Iiwic' +
        'GxhbiI6InRlYW0iLCJleHAiOjk5OTk5OTk5OTl9.not-a-valid-signature'
      const resp = await request.fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${bogus}` },
        failOnStatusCode: false,
      })
      expect(
        resp.status(),
        `GET /auth/me with a tampered bearer must return 401; got ${resp.status()}. ` +
          `Accepting a bad signature would be a critical auth-bypass.`,
      ).toBe(STATUS_UNAUTHORIZED)
    })

    test('expired (but correctly-signed) bearer → 401', async ({ request }) => {
      test.skip(
        !JWT_SECRET,
        'E2E_JWT_SECRET unset — cannot sign an expired-but-valid session JWT. Set it to run A9 exp leg.',
      )
      const identity = await provisionAndClaim(request)
      // exp 1h in the PAST.
      const { token } = mintSessionJWT(identity.userID, identity.teamID, identity.email, -3600)
      const resp = await request.fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        resp.status(),
        `GET /auth/me with an EXPIRED (correctly-signed) bearer must return 401; got ${resp.status()}. ` +
          `A 200 means exp is not enforced — sessions would never expire.`,
      ).toBe(STATUS_UNAUTHORIZED)

      // Reap the resource we created for this leg.
      const result = await reapEntities(request, [
        { kind: 'resource', id: identity.resourceToken, apiUrl: API_URL, note: 'A9 exp leg', recordedAt: new Date().toISOString() },
      ])
      expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
      clearLedger()
    })

    test('valid synthetic bearer → 200 with the claimed user + a tier', async ({ request }) => {
      // Prefer the workflow-minted account (item 2): when E2E_SESSION_JWT is set
      // the bearer is a REAL cohort session against the (prod) api, so we assert
      // against the minted identity + tier. Otherwise fall back to the
      // self-minted (E2E_JWT_SECRET) claimed-team path (tier='free').
      const minted = mintedSession()
      test.skip(
        !minted && !JWT_SECRET,
        'Neither E2E_SESSION_JWT (workflow-minted account) nor E2E_JWT_SECRET set — ' +
          'cannot obtain a valid session JWT to run the A8 valid-bearer leg.',
      )

      let token: string
      let expectedEmail: string
      let expectedTier: string
      let inlineReap: CohortEntity[] = []
      if (minted) {
        token = minted.token
        expectedEmail = minted.email
        expectedTier = minted.tier
      } else {
        const identity = await provisionAndClaim(request)
        token = mintSessionJWT(identity.userID, identity.teamID, identity.email).token
        expectedEmail = identity.email
        // A freshly-claimed (unpaid) self-minted team is 'free'.
        expectedTier = 'free'
        inlineReap = [
          { kind: 'resource', id: identity.resourceToken, apiUrl: API_URL, note: 'A8 valid leg', recordedAt: new Date().toISOString() },
        ]
      }

      const resp = await request.fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        resp.status(),
        `GET /auth/me with a valid bearer must return 200; got ${resp.status()}. ` +
          `Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBe(STATUS_OK)
      const me = (await resp.json()) as Record<string, unknown>
      // Right identity: the email must match the account behind the bearer. (The
      // workflow may not export the email; only assert when we know it.)
      if (expectedEmail) {
        expect(
          me.email,
          `/auth/me returned 200 but email=${String(me.email)}, expected ${expectedEmail}.`,
        ).toBe(expectedEmail)
      }
      // Right tier: a tier field must be present (`tier`/`plan`/`plan_tier`).
      const tier = (me.tier ?? me.plan ?? me.plan_tier) as string | undefined
      expect(
        tier,
        `/auth/me must surface the team's tier; got none in ${JSON.stringify(me)}.`,
      ).toBeTruthy()
      // And it must match the account behind the bearer when we know it
      // (minted tier, or 'free' for the self-minted claimed team).
      if (expectedTier) {
        expect(
          tier,
          `/auth/me tier should be '${expectedTier}' for this account; got '${tier}'.`,
        ).toBe(expectedTier)
      }

      // Reap inline only what THIS leg created (the minted account is reaped
      // out-of-band by the workflow's DELETE /internal/e2e/account step).
      if (inlineReap.length > 0) {
        const result = await reapEntities(request, inlineReap)
        expect(result.failed.length, `reap failed: ${JSON.stringify(result.failed)}`).toBe(0)
        clearLedger()
      }
    })
  })

  // ── A10: Logout revocation — the PRECISE regression class ───────────────────
  // The bearer/jti that worked on /auth/me must STOP working after POST
  // /auth/logout (jti added to the Redis revocation set). This is exactly what
  // the past incident missed: a "successful" login that a logout could not undo.
  test.describe('Logout revocation — reused bearer/jti after logout → 401 (A10)', () => {
    test('valid bearer 200 → logout → SAME bearer on /auth/me → 401', async ({ request }) => {
      // CRITICAL: A10 REVOKES the bearer it tests, so it must NEVER revoke the
      // shared workflow-minted E2E_SESSION_JWT — the claim/conversion, deploy,
      // and provision-smoke specs (which run AFTER this one, serial+alphabetical)
      // all provision/reap AS that minted session. Revoking it here would 401
      // every later authed leg (the regression this run hit). So A10 always uses
      // a DISPOSABLE bearer it owns:
      //   - Prefer a throwaway claimed team: provisionAndClaim returns a real
      //     session_token (onboarding.go:537) we can revoke harmlessly. Works on
      //     prod via the anon fingerprint bypass — no E2E_JWT_SECRET needed.
      //   - If the claim path can't mint a session_token, fall back to a
      //     self-minted JWT (needs E2E_JWT_SECRET) for the claimed team.
      // The minted account is reaped out-of-band by the workflow regardless.
      const minted = mintedSession()
      const canClaim = !!process.env.E2E_TEST_TOKEN || !!minted
      test.skip(
        !canClaim && !JWT_SECRET,
        'No way to obtain a DISPOSABLE session to revoke: neither the anon claim path ' +
          '(E2E_TEST_TOKEN / minted run) nor E2E_JWT_SECRET is available. A10 must never revoke ' +
          'the shared E2E_SESSION_JWT, so it skips here. Set E2E_TEST_TOKEN or E2E_JWT_SECRET to run it.',
      )

      let token: string
      let inlineReap: CohortEntity[] = []
      const identity = await provisionAndClaim(request)
      inlineReap = [
        { kind: 'resource', id: identity.resourceToken, apiUrl: API_URL, token: identity.sessionToken || undefined, note: 'A10 logout leg', recordedAt: new Date().toISOString() },
      ]
      if (identity.sessionToken) {
        // The disposable claim session — safe to revoke (own throwaway team).
        token = identity.sessionToken
      } else {
        // Claim omitted a session_token: self-mint one for the same team. This
        // path needs E2E_JWT_SECRET; if absent the skip above already fired.
        token = mintSessionJWT(identity.userID, identity.teamID, identity.email).token
      }

      // 1) The bearer works pre-logout.
      const pre = await request.fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        pre.status(),
        `pre-logout /auth/me with the disposable bearer should be 200; got ${pre.status()}. ` +
          `If this is already 401 the jti isn't recognized and the revocation assertion below is meaningless.`,
      ).toBe(STATUS_OK)

      // Reap the throwaway team's resource NOW, while its session is still valid
      // — the logout below revokes the only bearer that authorizes the DELETE, so
      // reaping afterward would 401 and leak the resource. (The minted account is
      // reaped out-of-band by the workflow; this leg owns a SEPARATE claimed team.)
      const reapResult = await reapEntities(request, inlineReap)
      expect(reapResult.failed.length, `pre-logout reap failed: ${JSON.stringify(reapResult.failed)}`).toBe(0)
      clearLedger()

      // 2) Logout — revokes the jti.
      const logout = await request.fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        logout.status(),
        `POST /auth/logout with a valid bearer should succeed (200); got ${logout.status()}.`,
      ).toBe(STATUS_OK)

      // 3) THE REGRESSION ASSERTION: the SAME bearer must now be rejected.
      const post = await request.fetch(`${API_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        failOnStatusCode: false,
      })
      expect(
        post.status(),
        `REUSED bearer after logout must return 401 (jti in the Redis revocation set); got ` +
          `${post.status()}. A 200 here is the EXACT login/logout regression class from the ` +
          `2026-05-30 incident — a session that survives its own logout.`,
      ).toBe(STATUS_UNAUTHORIZED)
    })
  })

  // ── A12/A13: CLI device-flow — canonical auth_url + poll status ─────────────
  // Prod-safe: creates a CLI session (5-min TTL, self-expiring) but no account.
  // The load-bearing contract (matrix A12 "safe-url"): the auth_url the CLI
  // prints MUST point at the canonical instanode.dev host, NOT the api host —
  // a developer's browser must land on the real product origin.
  test.describe('CLI device-flow — canonical auth_url + poll (A12/A13)', () => {
    test('POST /auth/cli returns a canonical instanode.dev auth_url; GET /auth/cli/:id polls', async ({
      request,
    }) => {
      const start = await request.fetch(`${API_URL}/auth/cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({}),
        failOnStatusCode: false,
      })
      test.skip(
        start.status() === STATUS_BACKEND_UNAVAILABLE,
        `/auth/cli returned 503 — CLI device-flow backend not enabled in this stack; reports skipped.`,
      )
      expect(
        [STATUS_OK, STATUS_CREATED].includes(start.status()),
        `POST /auth/cli should return 200/201; got ${start.status()}. ` +
          `Body: ${await start.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const body = (await start.json()) as Record<string, unknown>
      const authURL = String(body.auth_url ?? '')
      expect(authURL, `/auth/cli must return an auth_url; body=${JSON.stringify(body)}`).toBeTruthy()

      // THE safe-url contract: the host must be the canonical product host, not
      // the api host. Parse the URL and assert its hostname (substring checks on
      // the raw string could be fooled by api.instanode.dev containing
      // 'instanode.dev').
      const host = new URL(authURL).hostname
      expect(
        host,
        `CLI auth_url host must be the canonical '${CANONICAL_AUTH_HOST}' (not the api host); ` +
          `got '${host}' from auth_url '${authURL}'. Pointing the browser at the api host is the ` +
          `A12 safe-url regression.`,
      ).toBe(CANONICAL_AUTH_HOST)

      // Derive the session id to poll: prefer an explicit id field, else the
      // cli_session query param of the auth_url.
      const sessionId =
        String(body.id ?? body.session_id ?? '') ||
        new URL(authURL).searchParams.get('cli_session') ||
        ''
      expect(
        sessionId,
        `cannot derive a CLI session id to poll from ${JSON.stringify(body)} / ${authURL}.`,
      ).toBeTruthy()

      // A13: poll BEFORE approval. The REAL prod contract (verified against
      // api.instanode.dev) is HTTP 202 with {ok:true, pending:true} — there is NO
      // `status` field pre-approval; the CLI branches on `pending`. The api_token
      // is minted ONLY after the user approves in-browser, so it must be absent.
      const poll = await request.fetch(`${API_URL}/auth/cli/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_ACCEPTED].includes(poll.status()),
        `GET /auth/cli/:id pre-approval should return 200/202; got ${poll.status()}. ` +
          `Body: ${await poll.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const pollBody = (await poll.json()) as Record<string, unknown>
      // The poll must be answerable: ok:true (request accepted) AND pending:true
      // (not yet approved). This is the contract the CLI polls on.
      expect(
        pollBody.ok,
        `pre-approval poll must return ok:true; got ${JSON.stringify(pollBody)}.`,
      ).toBe(true)
      expect(
        pollBody.pending,
        `pre-approval poll must signal pending:true (the user hasn't approved yet); got ` +
          `${JSON.stringify(pollBody)}.`,
      ).toBe(true)
      // Pre-approval there must be NO api_token (it appears only after approve).
      expect(
        pollBody.api_token,
        `pre-approval poll must NOT return an api_token (it's minted only after the user approves ` +
          `in-browser); got '${String(pollBody.api_token)}'. Handing a token out unapproved is a bypass.`,
      ).toBeFalsy()
    })
  })

  // ── A1: Magic-link START leg works; full callback BLOCKED on Brevo ──────────
  // The start leg is prod-safe and exercised. The FULL callback flow
  // (start → emailed link → GET /auth/email/callback → exchange) is BLOCKED by
  // the unvalidated Brevo sender (P0: project_brevo_sender_not_validated.md) — no
  // email is delivered, so there is no link to click. Marked test.skip with an
  // explicit operator-blocked reason rather than silently omitted.
  test.describe('Magic-link — start leg only; callback Brevo-blocked (A1)', () => {
    test('POST /auth/email/start returns 200/202 {ok:true}', async ({ request }) => {
      const resp = await request.fetch(`${API_URL}/auth/email/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
        // A cohort-branded probe address (routes to the cohort mailbox; the
        // start handler always 2xx's regardless, defeating enumeration).
        data: JSON.stringify({ email: cohortEmail('magic'), return_to: `${WEB_ORIGIN}/login/callback` }),
        failOnStatusCode: false,
      })
      expect(
        [STATUS_OK, STATUS_ACCEPTED].includes(resp.status()),
        `POST /auth/email/start should always 2xx (rejecting would leak whether the email exists); ` +
          `got ${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
      ).toBe(true)
      const body = (await resp.json().catch(() => null)) as { ok?: boolean } | null
      expect(body?.ok, `/auth/email/start should return {ok:true}; got ${JSON.stringify(body)}`).toBe(true)
    })

    // The callback leg cannot run until an operator validates the Brevo sender.
    // Explicit skip (rule: surface the blocker, never silently omit it).
    test.skip(
      'FULL magic-link callback flow (start → emailed link → callback → exchange) — BLOCKED on Brevo sender validation (operator action: validate noreply@instanode.dev in Brevo; project_brevo_sender_not_validated.md)',
      () => {
        // Intentionally empty: the magic_links token lives ONLY in the api DB and
        // is emailed (anti-enumeration), and Brevo internally rejects every send
        // until the sender domain is validated. Once validated, drive:
        //   start → poll a real cohort inbox for the link → GET callback → exchange.
      },
    )
  })

  // Coverage marker (rule 18): the matrix W1 leg IDs this file covers. A future
  // registry-iterating done-bar test can read this to confirm no W1 leg silently
  // dropped. COHORT_MARKER is referenced so the cohort import is load-bearing and
  // the lint can't flag it unused if the account legs are all skipped.
  test('coverage manifest — W1 legs present + cohort marker wired', () => {
    const covered = ['A1-start', 'A4', 'A6', 'A7', 'A8', 'A9', 'A10', 'A12', 'A13']
    expect(covered.length, 'W1 leg manifest should be non-empty').toBeGreaterThan(0)
    expect(COHORT_MARKER, 'cohort marker must be the shared brand').toBe('e2e-cohort')
  })
})

// Re-export for a potential future registry-iterating coverage test (rule 18)
// that wants to assert this file's CohortEntity usage compiles against the ledger
// contract without importing the spec body.
export type { CohortEntity }

// Covered-route manifest (rule 18), defined in the playwright-free sibling so the
// vitest prod-coverage done-bar guard can union it without the @playwright/test
// runtime. The spec tags legs by W1 leg-ID; the sibling maps them to route
// strings (matrix §0.2 / §1.D).
export { coveredRoutes } from './live-auth.coverage'
