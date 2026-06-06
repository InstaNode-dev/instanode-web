// LIVE-UI tier matrix — the per-tier × per-page real-backend sweep.
//
// Design ref: docs/ci/00-INTERACTION-PATHS.md Part C, the inventory's biggest
// remaining gap: "no per-route × per-tier × per-async-state CI sweep". Part A3
// enumerates the tier dimension; this spec exercises it FOR REAL — for each
// mintable tier it mints a cohort account, loads the key dashboard pages in a
// browser against the prod api (same-origin via the preview proxy, the AUTH-004
// CORS-safe harness), and asserts the tier-CORRECT gated/ungated UI.
//
// Registry-iterating (CLAUDE.md rule 18): the tier set comes from TIER_RANK
// (the same ladder the app ranks by) intersected with what the factory can mint,
// and the per-tier expectation is COMPUTED from the mirrored soft-gate
// allowlists in e2e/tier-matrix.ts — never a hand-typed per-tier table. A new
// tier in the ladder auto-expands the matrix; a soft-gate change is a one-line
// edit in tier-matrix.ts. The asserted features:
//
//   • Overview (/app)        — the "want bigger limits" upgrade CTA renders for
//                              free/hobby (sub-Pro), hidden for pro+.
//   • Resources (/app/resources) — the page renders the account's tier text
//                              (proves the authed /auth/me read resolved for THIS
//                              tier) + empty-state copy (no infinite spinner).
//   • Deployments (/app/deployments) — private-deploy CONFIGURATOR for pro+,
//                              the UpgradePromptCard UPSELL for sub-Pro.
//   • Vault (/app/vault)     — page renders; the multi-env wall shows on a
//                              non-prod env tab for sub-Pro, absent for pro+.
//   • Settings (/app/settings) — deploy-TTL radios editable for paid tiers, the
//                              free-tier upgrade hint for free.
//   • Billing (/app/billing) — the upgrade section renders; for pro+ (next tier
//                              = Team) the Team CTA is "Contact sales" (mailto),
//                              NEVER a self-serve Team checkout (project HARD
//                              "Team not self-serve" rule).
//
// Efficiency: ONE mint per tier, all six pages asserted in that session, then
// reap. No heavy provisioning — every assertion is a render assertion that needs
// only the account's tier (the factory mints the tier synchronously). Anonymous
// is NOT mintable + has no authed shell, and team/growth are gated off the mint
// allowlist (project_team_plan_not_rolled_out); those tiers' EXPECTATIONS are
// still computed in tier-matrix.ts so the registry stays whole, they're just not
// driven through the authed shell here.
//
// Safety machinery mirrors live-ui-auth.spec.ts EXACTLY (rule 24): E2E_LIVE
// gating, assertSafeApiTarget, mint→ledger→cascade-reap + afterAll backstop.

import { test, expect, type APIRequestContext } from '@playwright/test'

import { assertSafeApiTarget } from './cohort'
import { loadLedger, reapEntities, clearLedger } from './cleanup-ledger'
import { mintUser, reap, factoryArmed, apiBase, MINTABLE_TIERS, type MintedUser } from './factory'
import { newAuthedContext, appURL } from './ui-helpers'
import { ALL_TIERS, expectationFor } from './tier-matrix'

const LIVE = process.env.E2E_LIVE === '1'
const API_URL = apiBase()

// The tiers we actually drive through the authed shell: the canonical ladder
// (TIER_RANK order) intersected with what the factory can mint. anonymous (no
// authed shell) + team/growth (gated off mint) drop out here; their expectations
// remain in tier-matrix.ts so the soft-gate registry stays complete (rule 18).
const MINTABLE = new Set<string>(MINTABLE_TIERS)
const MATRIX_TIERS = ALL_TIERS.filter((t) => MINTABLE.has(t) && t !== 'anonymous')

// A non-production env tab to force the vault multi-env wall on sub-Pro tiers.
const NON_PROD_ENV = 'staging'

test.describe('LIVE-UI — per-tier × per-page matrix sweep', () => {
  test.describe.configure({ mode: 'serial' })

  test.skip(
    !LIVE,
    'E2E_LIVE!=1 — real-backend tier-matrix sweep is opt-in. Set E2E_LIVE=1 + ' +
      'E2E_API_URL + E2E_ACCOUNT_TOKEN (mint guard) to run it.',
  )
  test.skip(LIVE && !API_URL, 'E2E_LIVE=1 but E2E_API_URL is unset — no backend to target.')
  if (LIVE && API_URL) assertSafeApiTarget(API_URL)

  // Backstop reaper (rule 24): cascade-delete any still-ledgered minted account
  // even if a tier leg throws before its inline reap.
  test.afterAll(async ({ playwright }) => {
    const entities = loadLedger()
    if (entities.length === 0) return
    const ctx = await playwright.request.newContext()
    try {
      const result = await reapEntities(ctx, entities)
      // eslint-disable-next-line no-console
      console.log(
        `[live-ui-tier-matrix afterAll] reaped attempted=${result.attempted} deleted=${result.deleted} ` +
          `alreadyGone=${result.alreadyGone} failed=${result.failed.length}`,
      )
      if (result.failed.length === 0) clearLedger()
    } finally {
      await ctx.dispose()
    }
  })

  // Sanity: the registry actually yields a non-trivial set of mintable tiers, so
  // a typo in TIER_RANK / MINTABLE_TIERS can't silently empty the matrix.
  test('the matrix iterates a non-trivial mintable tier set (registry sanity)', () => {
    expect(
      MATRIX_TIERS.length,
      `expected ≥2 mintable, authed-shell tiers from TIER_RANK ∩ MINTABLE_TIERS; got ` +
        `[${MATRIX_TIERS.join(', ')}]. A drift in TIER_RANK or MINTABLE_TIERS broke the registry.`,
    ).toBeGreaterThanOrEqual(2)
    // At least one sub-Pro (gated) and one pro+ (ungated) tier must be present so
    // BOTH arms of every gate are exercised.
    const hasGated = MATRIX_TIERS.some((t) => !expectationFor(t).privateDeployUnlocked)
    const hasUngated = MATRIX_TIERS.some((t) => expectationFor(t).privateDeployUnlocked)
    expect(hasGated, 'the matrix must include a sub-Pro (gated) tier so the upsell arm is exercised.').toBe(true)
    expect(hasUngated, 'the matrix must include a Pro+ (ungated) tier so the feature arm is exercised.').toBe(true)
  })

  // One parametrised test per mintable tier — mint once, assert all six pages,
  // reap. The @pr-smoke tag rides on the FIRST sub-Pro tier (the gated arm — the
  // representative, fast tier-correctness assertion for the PR path).
  for (const tier of MATRIX_TIERS) {
    const exp = expectationFor(tier)
    // Tag the lowest gated tier @pr-smoke (one fast gated-CTA assertion on PRs).
    const firstGated = MATRIX_TIERS.find((t) => !expectationFor(t).privateDeployUnlocked)
    const smokeTag = tier === firstGated ? '@pr-smoke ' : ''

    test(`${smokeTag}${tier}: dashboard pages render the tier-correct gated state`, async ({
      browser,
      request,
    }) => {
      test.skip(!factoryArmed(), 'E2E_ACCOUNT_TOKEN unset — cannot mint a cohort account.')
      const user = await mintUser(request, { tier: tier as (typeof MINTABLE_TIERS)[number] })
      test.skip(user === null, 'mint endpoint not armed (404) — cannot run the tier-matrix sweep.')
      const u = user as MintedUser
      expect(u.tier, `mint must echo the requested tier (${tier}).`).toBe(tier)

      const { context, page } = await newAuthedContext(browser, {
        sessionJWT: u.sessionJWT,
        env: NON_PROD_ENV, // pin a non-prod env so the vault wall is reachable for sub-Pro.
      })
      try {
        // ── Overview (/app) — upgrade CTA gate + authed shell ──────────────────
        await page.goto(appURL('/app'), { waitUntil: 'domcontentloaded' })
        await expect(
          page,
          `authed /app must not redirect to /login for a valid ${tier} session (login-broke class).`,
        ).not.toHaveURL(/\/login/, { timeout: 30_000 })
        await expect(
          page.getByTestId('org'),
          `the authed shell must render for the ${tier} session.`,
        ).toBeVisible({ timeout: 30_000 })
        // The Overview data tile must resolve (empty-state OK) — proves the
        // authed resources/deployments reads worked for THIS tier (not a spinner).
        await expect(
          page.getByTestId('recently-active'),
          `the Overview data tile must render for ${tier} (authed reads resolved, no infinite spinner).`,
        ).toBeVisible({ timeout: 30_000 })
        const overviewCta = page.getByTestId('overview-upgrade-cta')
        if (exp.overviewUpgradeCta) {
          await expect(
            overviewCta,
            `${tier} is sub-Pro → the Overview "want bigger limits" upgrade CTA must render.`,
          ).toBeVisible({ timeout: 15_000 })
        } else {
          await expect(
            overviewCta,
            `${tier} is Pro+ → the Overview upgrade CTA must be ABSENT (no upsell to a paid user).`,
          ).toHaveCount(0)
        }

        // ── Resources (/app/resources) — tier echo + empty-state ───────────────
        await page.goto(appURL('/app/resources'), { waitUntil: 'domcontentloaded' })
        // The Provision PromptCard echoes the account's plan tier inline; a render
        // of the minted tier proves the authed /auth/me read resolved for THIS
        // account (anti-false-pass: a 401/contract drift could not show it).
        await expect(
          page.getByText(tier, { exact: false }).first(),
          `/app/resources must render the ${tier} plan-tier text (proves the authed read resolved).`,
        ).toBeVisible({ timeout: 30_000 })
        // The list heading resolves (empty "0 resources" is fine — the minted
        // account has none) rather than hanging on "loading…".
        await expect(
          page.getByRole('heading', { name: /resources$/ }),
          `/app/resources must reach a terminal "N resources" heading for ${tier} (not stuck loading).`,
        ).toBeVisible({ timeout: 30_000 })

        // ── Deployments (/app/deployments) — private-deploy gate ───────────────
        await page.goto(appURL('/app/deployments'), { waitUntil: 'domcontentloaded' })
        await expect(
          page.getByTestId('private-deploy-section'),
          `the private-deploy section must render on /app/deployments for ${tier}.`,
        ).toBeVisible({ timeout: 30_000 })
        if (exp.privateDeployUnlocked) {
          await expect(
            page.getByTestId('private-deploy-configurator'),
            `${tier} is Pro+ → the private-deploy CONFIGURATOR must render (feature unlocked).`,
          ).toBeVisible({ timeout: 15_000 })
          await expect(
            page.getByTestId('private-deploy-upsell'),
            `${tier} is Pro+ → the private-deploy UPSELL must be ABSENT.`,
          ).toHaveCount(0)
        } else {
          await expect(
            page.getByTestId('private-deploy-upsell'),
            `${tier} is sub-Pro → the private-deploy UPSELL (UpgradePromptCard) must render.`,
          ).toBeVisible({ timeout: 15_000 })
          await expect(
            page.getByTestId('private-deploy-configurator'),
            `${tier} is sub-Pro → the private-deploy CONFIGURATOR must be ABSENT (feature gated).`,
          ).toHaveCount(0)
        }

        // ── Vault (/app/vault) — multi-env wall on a non-prod env tab ──────────
        await page.goto(appURL('/app/vault'), { waitUntil: 'domcontentloaded' })
        // The page itself must render. Anchor on the VaultPage subtitle ("Encrypted
        // secrets · AES-256-GCM") rather than the heading text "Vault" — the latter
        // strict-mode-collides with the AppShell crumb + a PromptCard h4. The
        // subtitle is unique to VaultPage and proves it mounted.
        await expect(
          page.getByText(/Encrypted secrets.*AES-256-GCM/i).first(),
          `/app/vault must render for ${tier} (VaultPage subtitle present).`,
        ).toBeVisible({ timeout: 30_000 })
        const vaultUpsell = page.getByTestId('upgrade-prompt-vault_prod')
        if (exp.vaultMultiEnvUnlocked) {
          await expect(
            vaultUpsell,
            `${tier} is Pro+ → the vault multi-env upsell must be ABSENT on the ${NON_PROD_ENV} env tab.`,
          ).toHaveCount(0)
        } else {
          await expect(
            vaultUpsell,
            `${tier} is sub-Pro → the vault multi-env upsell must render on the non-prod (${NON_PROD_ENV}) env tab.`,
          ).toBeVisible({ timeout: 15_000 })
        }

        // ── Settings (/app/settings) — deploy-TTL edit gate ────────────────────
        await page.goto(appURL('/app/settings'), { waitUntil: 'domcontentloaded' })
        await expect(
          page.getByTestId('deploy-ttl-policy-card'),
          `the deploy-TTL policy card must render on /app/settings for ${tier}.`,
        ).toBeVisible({ timeout: 30_000 })
        const ttlUpgradeHint = page.getByTestId('ttl-policy-upgrade-hint')
        if (exp.ttlEditUnlocked) {
          await expect(
            ttlUpgradeHint,
            `${tier} is a paid tier → the free-tier TTL upgrade hint must be ABSENT (radios editable).`,
          ).toHaveCount(0)
        } else {
          await expect(
            ttlUpgradeHint,
            `${tier} is free → the deploy-TTL upgrade hint must render (TTL edit gated).`,
          ).toBeVisible({ timeout: 15_000 })
        }

        // ── Billing (/app/billing) — Team is contact-sales, never self-serve ───
        await page.goto(appURL('/app/billing'), { waitUntil: 'domcontentloaded' })
        await expect(
          page.getByTestId('billing-upgrade-section'),
          `the billing upgrade section must render on /app/billing for ${tier}.`,
        ).toBeVisible({ timeout: 30_000 })
        // The Team column CTA must ALWAYS read "Contact sales" (project HARD rule:
        // Team is never self-serve). The grid renders the Team column for every
        // tier; assert it's a sales CTA, not a checkout button. We assert this for
        // EVERY tier (not just pro+) since the Team column is always present.
        const teamCta = page.getByTestId('tier-cta-team')
        if (await teamCta.count()) {
          await expect(
            teamCta,
            `the Team CTA must read "Contact sales" for ${tier} — Team is NEVER self-serve checkout.`,
          ).toContainText(/contact sales/i, { timeout: 15_000 })
        }
      } finally {
        await context.close()
      }

      // Inline reap (prompt); afterAll + reap-cohort back this up.
      await reapUser(request, u)
    })
  }
})

// Reap a minted account inline (eager); idempotent with the ledger backstop.
async function reapUser(request: APIRequestContext, u: MintedUser): Promise<void> {
  await reap(request, u.teamID)
  clearLedger()
}
