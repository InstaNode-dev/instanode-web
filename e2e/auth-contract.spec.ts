// Layer-1 PR-gate smoke test for the AUTH-004 CORS contract + magic-link round-trip.
//
// Background — the 2026-05-29 → 2026-05-30 login regression class:
//   1. instanode-web missing the /auth/exchange cookie-exchange POST.
//   2. instanode-web sending Accept:application/json on /auth/exchange (forced
//      a preflight the api's PreflightAllowlist rejected → 403 → "Failed to fetch").
//   3. api missing access-control-allow-credentials (ACAC) on the preflight
//      response.
//
// Existing gates:
//   - The worker auth-probe catches the regression 5 minutes POST-deploy.
//   - The OpenAPI contract CI catches schema drift at PR time.
//   - NOTHING catches it BEFORE merge end-to-end in a real browser. This spec
//     closes that gap. It runs on every PR and asserts:
//       (1) the api responds to a CORS preflight from the web origin with
//           ACAO=<origin> AND ACAC=true,
//       (2) a real browser-fetched cross-origin POST to /auth/exchange
//           completes the CORS traversal (no "Failed to fetch"),
//       (3) the /auth/email/start magic-link endpoint returns 202 + {ok:true}.
//
// The test runs against PROD by default (E2E_API_URL / E2E_WEB_ORIGIN). Set
// the env vars to point at a staging api+web pair to gate pre-prod deploys.
//
// Layer 2 (docker-compose) is a separate, follow-up spec — see the agent brief.

import { expect, test } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'https://api.instanode.dev'
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'https://instanode.dev'

// Magic-link probe address. The api Start handler:
//   - validates the address via mail.ParseAddress + 254-char cap (400 on fail),
//   - always returns 202 regardless of whether the email exists (defeats
//     enumeration),
//   - logs+drops the send through Brevo (which is currently unvalidated in
//     prod — see CLAUDE.md known design gap), so the address never actually
//     receives anything. That's the point: we test the API leg only, NOT email
//     delivery (which would be flaky and is covered by the worker auth-probe).
const PROBE_EMAIL = 'probe-pr-gate@instanode.dev'

test.describe('AUTH-004 CORS contract — PR-gate smoke', () => {
  test.describe.configure({ mode: 'serial' })

  // Test 1 — CORS preflight contract.
  //
  // If the api returns 4xx, missing access-control-allow-origin, or
  // missing access-control-allow-credentials, the browser-side fetch in
  // LoginCallbackPage.tsx fails with "TypeError: Failed to fetch" and the
  // user is stuck on /login/callback forever. The 2026-05-29 regression
  // shipped a preflight WITHOUT ACAC — this assertion would have caught it
  // before merge.
  test('preflight returns ACAO=<web_origin> and ACAC=true', async ({ request }) => {
    const resp = await request.fetch(`${API_URL}/auth/exchange`, {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
      failOnStatusCode: false,
    })

    // The api uses fiber CORS middleware which replies 204 on a successful
    // preflight; accept 200 too in case the framework changes.
    expect(
      [200, 204].includes(resp.status()),
      `expected 200 or 204 preflight status, got ${resp.status()} — body: ${await resp.text().catch(() => '<unreadable>')}`,
    ).toBe(true)

    const headers = resp.headers()
    const acao = headers['access-control-allow-origin']
    const acac = headers['access-control-allow-credentials']

    expect(
      acao,
      `MISSING access-control-allow-origin on preflight. This breaks the cross-origin POST from ${WEB_ORIGIN}/login/callback to ${API_URL}/auth/exchange — the browser will reject the response and the user will see "Failed to fetch". Restore the CORS allowlist for ${WEB_ORIGIN}.`,
    ).toBe(WEB_ORIGIN)

    expect(
      acac,
      `MISSING access-control-allow-credentials: true on preflight. The web SPA fetches /auth/exchange with credentials:'include' (it needs the instanode_session_exchange cookie). Without ACAC the browser drops the cookie, the api returns 400 cookie_missing_or_expired, and login silently fails. Re-add ACAC to the CORS middleware response.`,
    ).toBe('true')
  })

  // Test 2 — Real browser cross-origin POST completes (no "Failed to fetch").
  //
  // This is the load-bearing test. It mirrors what LoginCallbackPage.tsx
  // does in production: navigate to the web origin, then `fetch()` the api
  // /auth/exchange endpoint from inside the page (so the browser enforces
  // CORS). The CORS-fixed prod returns 400 (no cookie) — that's fine. What
  // we assert is the fetch RESOLVED, not that it succeeded — i.e. the
  // CORS traversal worked and the browser didn't block the response.
  //
  // A regression that strips ACAC, removes ACAO, or otherwise breaks the
  // simple-CORS path would make this fetch throw "TypeError: Failed to
  // fetch" in the page context — exactly the user-visible symptom of the
  // 2026-05-30 outage.
  test('cross-origin POST from web origin completes the CORS traversal', async ({ page }) => {
    // Intercept the navigation to the web origin and serve a minimal stub
    // page. We don't care what's IN the page — we only need the browser to
    // adopt the WEB_ORIGIN as the document's origin so the subsequent
    // fetch(API_URL/...) is genuinely cross-origin (the whole point of this
    // test). Avoiding the real /login download dodges flaky third-party
    // resources (analytics, fonts, etc.) and keeps the test bounded under
    // a second instead of timing out on a slow SSR/redirect.
    await page.route(`${WEB_ORIGIN}/__auth_contract_origin_stub`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body>auth-contract stub origin</body></html>',
      })
    })
    const navResp = await page.goto(`${WEB_ORIGIN}/__auth_contract_origin_stub`, { waitUntil: 'load' })
    expect(
      navResp,
      `failed to navigate to ${WEB_ORIGIN} origin stub — Playwright returned no response.`,
    ).not.toBeNull()
    // Sanity-check the document origin is what we expect — if Playwright
    // ever changes how route-fulfilled navigations are scoped, the test
    // would silently be same-origin (and miss the CORS bug it's meant to
    // catch). Fail loud instead.
    const docOrigin = await page.evaluate(() => window.location.origin)
    expect(
      docOrigin,
      `document origin after navigation was ${docOrigin}, expected ${WEB_ORIGIN}. ` +
        `The fetch below would not be cross-origin and would silently pass even with a broken CORS contract.`,
    ).toBe(WEB_ORIGIN)

    const result = await page.evaluate(
      async ({ apiUrl }) => {
        try {
          // Mirror LoginCallbackPage.tsx exchangeCookieForToken EXACTLY: no
          // custom headers (no Accept, no Content-Type) so the request stays
          // a "simple cross-origin request" per the CORS spec — no preflight.
          // credentials:'include' so the browser would send the bridge cookie
          // if it had one.
          const resp = await fetch(`${apiUrl}/auth/exchange`, {
            method: 'POST',
            credentials: 'include',
          })
          const body = await resp.text().catch(() => '')
          return { ok: true, status: resp.status, bodyLen: body.length }
        } catch (e: any) {
          // The diagnostic the 2026-05-30 users saw. Surface the literal
          // message so a future regression reports it inline in the CI log.
          return { ok: false, error: String(e?.message ?? e) }
        }
      },
      { apiUrl: API_URL },
    )

    expect(
      result.ok,
      `cross-origin POST threw — this is the EXACT user-visible login failure. ` +
        `Browser error: ${'error' in result ? result.error : ''}. ` +
        `Likely cause: api CORS middleware dropped access-control-allow-credentials ` +
        `or access-control-allow-origin for ${WEB_ORIGIN}.`,
    ).toBe(true)

    // 400 (cookie missing) is the expected response on a fresh probe — there
    // is no bridge cookie to exchange. 401 and 410 are also acceptable
    // (cookie semantics may change). Anything outside 4xx is a regression
    // worth investigating.
    if ('status' in result) {
      expect(
        result.status >= 400 && result.status < 500,
        `expected 4xx (cookie missing/expired) on a no-cookie exchange, got ${result.status}. ` +
          `200 would mean the api accepted an exchange with no bridge cookie — a major auth bug. ` +
          `5xx would mean the api is unhealthy.`,
      ).toBe(true)
    }
  })

  // Test 3 — Magic-link start endpoint returns 202 {ok:true}.
  //
  // The api MagicLinkHandler.Start always returns 202 (even when the email
  // doesn't exist, even when downstream email delivery fails) — that's
  // deliberate, it defeats enumeration. So this test is bounded: it asserts
  // the api LEG of the magic-link flow works. Email delivery itself is
  // covered by the Brevo webhook (which writes forwarder_sent.classification
  // — see CLAUDE.md rule 12) and the worker auth-probe, NOT this test.
  test('POST /auth/email/start returns 202 {ok:true}', async ({ request }) => {
    const resp = await request.fetch(`${API_URL}/auth/email/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: WEB_ORIGIN,
      },
      data: JSON.stringify({
        email: PROBE_EMAIL,
        return_to: `${WEB_ORIGIN}/login/callback`,
      }),
      failOnStatusCode: false,
    })

    expect(
      resp.status(),
      `POST /auth/email/start should always return 202 (rejecting any other status would leak whether the email exists). ` +
        `Got ${resp.status()}. Body: ${await resp.text().catch(() => '<unreadable>')}`,
    ).toBe(202)

    const body = await resp.json().catch(() => null)
    expect(body, `/auth/email/start response body was not JSON`).not.toBeNull()
    expect(
      body?.ok,
      `/auth/email/start should return {ok:true}; got ${JSON.stringify(body)}`,
    ).toBe(true)
  })
})
