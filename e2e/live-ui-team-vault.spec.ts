// Wave 3 — real-backend UI journeys #6 (vault add→reveal→delete) and #7 (team
// invite→pending→revoke), driven through the ACTUAL dashboard.
//
// Design ref: docs/ci/01-CI-INTEGRATION-DESIGN.md (Wave 3).
//
// Journey #6 — vault:
//   Mint PRO. The dashboard's vault add/delete are agent-driven (VaultPage
//   ships PromptCards, the only clickable mutation is the AUDITED reveal). So we
//   add a secret via the real api (PUT /api/v1/vault/production/:key), render
//   /app/vault → assert the secret row appears → click reveal → assert the
//   audited reveal returns the value in the UI → delete the secret via the api →
//   assert the row disappears.
//
// Journey #7 — team invite:
//   Mint PRO (primary). Team invite/revoke are agent-driven (TeamPage ships
//   PromptCards, no clickable invite button), so we drive the invite via the
//   real api using a SECONDARY throwaway minted account as the invitee (the
//   primary is never disturbed — matrix isolation rule). Render /app/team →
//   assert the Pending invitation row renders → revoke via the api → assert the
//   pending row clears in the UI. The secondary account is cascade-reaped.
//
// Safety machinery mirrors live-writes.spec.ts (rule 24).

import { test, expect, type APIRequestContext } from '@playwright/test'

import { assertSafeApiTarget } from './cohort'
import { loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import { mintUser, reap, factoryArmed, apiBase, type MintedUser } from './factory'
import { newAuthedContext, appURL } from './ui-helpers'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

const VAULT_ENV = 'production'
const VAULT_KEY = 'E2E_COHORT_SECRET'
const VAULT_VALUE = 'cohort-secret-value-do-not-ship'

test.describe('LIVE-UI — vault reveal + team invite (journeys #6, #7)', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(!LIVE, 'E2E_LIVE!=1 — real-backend vault/team UI journeys are opt-in.')
  test.skip(LIVE && !API_URL, 'E2E_LIVE=1 but E2E_API_URL is unset — no backend to target.')
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-team-vault afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // ── Journey #6 — vault: add (api) → render → reveal (UI) → delete (api) ───────
  test('pro: vault secret renders → UI reveal returns the value → delete clears it', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const user = await mintUser(request, { tier: 'pro' })
    test.skip(user === null, 'mint endpoint not armed (404).')
    const u = user as MintedUser

    // ADD — agent-driven in the UI → seed via the real api.
    const put = await request.fetch(`${API_URL}/api/v1/vault/${VAULT_ENV}/${VAULT_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.sessionJWT}` },
      data: JSON.stringify({ value: VAULT_VALUE }),
      failOnStatusCode: false,
    })
    expect(
      [200, 201].includes(put.status()),
      `vault PUT should be 200/201; got ${put.status()}. Body: ${await put.text().catch(() => '<unreadable>')}`,
    ).toBe(true)

    const { context, page } = await newAuthedContext(browser, { sessionJWT: u.sessionJWT, env: VAULT_ENV })
    try {
      await page.goto(appURL('/app/vault'), { waitUntil: 'domcontentloaded' })

      // RENDER — the secret row appears (listVault maps keys[] → rows).
      const row = page.getByTestId(`vault-row-${VAULT_KEY}`)
      await expect(
        row,
        'the seeded vault secret row must render on /app/vault (proves listVault resolved against prod).',
      ).toBeVisible({ timeout: 30_000 })

      // REVEAL — the audited reveal (the only clickable vault mutation). Clicking
      // it calls revealVaultSecret against the real api (which writes an audit
      // row) and renders the plaintext value in the row.
      await page.getByTestId(`reveal-${VAULT_KEY}`).click()
      await expect(
        row,
        'clicking reveal must render the secret value in the row (proves the audited reveal resolved against prod).',
      ).toContainText(VAULT_VALUE, { timeout: 30_000 })
    } finally {
      await context.close()
    }

    // DELETE — agent-driven in the UI → delete via the real api → assert the row
    // is gone on a fresh render.
    const del = await request.fetch(`${API_URL}/api/v1/vault/${VAULT_ENV}/${VAULT_KEY}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${u.sessionJWT}` },
      failOnStatusCode: false,
    })
    expect(
      [200, 202, 204, 404].includes(del.status()),
      `vault DELETE should be 2xx/404; got ${del.status()}.`,
    ).toBe(true)

    const { context: c2, page: p2 } = await newAuthedContext(browser, {
      sessionJWT: u.sessionJWT,
      env: VAULT_ENV,
    })
    try {
      await p2.goto(appURL('/app/vault'), { waitUntil: 'domcontentloaded' })
      await expect(
        p2.getByTestId(`vault-row-${VAULT_KEY}`),
        'after deletion the vault secret row must NOT render (proves the delete propagated to the UI read).',
      ).toBeHidden({ timeout: 30_000 })
    } finally {
      await c2.close()
    }

    await reapUser(request, u)
  })

  // ── Journey #7 — team: invite (api) → pending row (UI) → revoke (api) ─────────
  test('pro: invited member appears in the Team Pending list → revoke clears it', async ({
    browser,
    request,
  }) => {
    test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
    const primary = await mintUser(request, { tier: 'pro' })
    test.skip(primary === null, 'mint endpoint not armed (404).')
    const p = primary as MintedUser

    // The invitee is a SECONDARY throwaway minted account, so the PRIMARY is
    // never disturbed (member-mgmt isolation rule). Both cascade-reaped.
    const secondary = await mintUser(request, { tier: 'free' })
    test.skip(secondary === null, 'could not mint a SECONDARY account for the invitee.')
    const sec = secondary as MintedUser

    // INVITE — agent-driven in the UI → drive via the real api.
    const invite = await request.fetch(`${API_URL}/api/v1/team/members/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.sessionJWT}` },
      data: JSON.stringify({ email: sec.email, role: 'developer' }),
      failOnStatusCode: false,
    })
    expect(
      invite.status(),
      `team invite should be 201; got ${invite.status()}. Body: ${await invite.text().catch(() => '<unreadable>')}`,
    ).toBe(201)
    const invBody = (await invite.json()) as { invitation?: { id?: string } }
    const invID = String(invBody.invitation?.id ?? '')
    expect(invID, 'the invite must return an invitation id.').toBeTruthy()

    const { context, page } = await newAuthedContext(browser, { sessionJWT: p.sessionJWT })
    try {
      await page.goto(appURL('/app/team'), { waitUntil: 'domcontentloaded' })

      // PENDING ROW — the Team page renders the pending invitation (by email).
      // The Pending column lists invitations; assert the invitee's email shows.
      await expect(
        page.getByText(sec.email, { exact: false }).first(),
        'the pending invitation must render in the Team page Pending list (proves listInvitations resolved against prod).',
      ).toBeVisible({ timeout: 30_000 })
      // The "Pending · N" heading must reflect ≥1 invite.
      await expect(
        page.getByRole('heading', { name: /Pending · [1-9]/ }),
        'the Pending heading must show a non-zero count.',
      ).toBeVisible()
    } finally {
      await context.close()
    }

    // REVOKE — agent-driven in the UI → drive via the real api → assert the
    // pending row clears on a fresh render.
    const revoke = await request.fetch(`${API_URL}/api/v1/team/invitations/${invID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${p.sessionJWT}` },
      failOnStatusCode: false,
    })
    expect(
      [200, 202, 204, 404].includes(revoke.status()),
      `invitation revoke should be 2xx/404; got ${revoke.status()}.`,
    ).toBe(true)

    const { context: c2, page: p2 } = await newAuthedContext(browser, { sessionJWT: p.sessionJWT })
    try {
      await p2.goto(appURL('/app/team'), { waitUntil: 'domcontentloaded' })
      await expect(
        p2.getByText(sec.email, { exact: false }),
        'after revoke the invitee email must NOT render in the Pending list (proves the revoke propagated to the UI).',
      ).toBeHidden({ timeout: 30_000 })
    } finally {
      await c2.close()
    }

    // Reap both accounts (cascade). Order doesn't matter — each is independent.
    await reap(request, sec.teamID)
    await reapUser(request, p)
  })
})

async function reapUser(request: APIRequestContext, u: MintedUser): Promise<void> {
  await reap(request, u.teamID)
  clearLedger()
}
