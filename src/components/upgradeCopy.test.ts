/**
 * upgradeCopy.test.ts — regression coverage for the Pro upgrade CTA strings.
 *
 * FIX-G (2026-05-14) regression: PRIMARY_CTA_LABEL_PRO_ANNUAL used to read
 * "Get Pro — $7.50/mo billed yearly" — which is the Hobby Annual per-month
 * price ($90/yr ÷ 12 = $7.50), not Pro Annual ($490/yr ÷ 12 = $40.83). The
 * wrong number propagated to 6 upgrade surfaces (vault_prod, provision_twin,
 * family_bindings, quota_wall, custom_domain, private_deploy). This test
 * locks the correct numbers in so the bug can't silently regress.
 *
 * Source of truth: api/plans.yaml
 *   pro.price_monthly_cents          = 4900 → "$49/mo"
 *   pro_yearly.price_monthly_cents   = 49000 → $490/yr → "$40.83/mo billed yearly"
 *
 * If pricing changes, update plans.yaml first, then PRIMARY_CTA_LABEL_PRO_ANNUAL
 * + SECONDARY_CTA_LABEL_PRO_MONTHLY, then this test. The PricingGrid + BillingPage
 * tests cover the grid surfaces — this test covers the in-context UpgradePromptCard
 * surfaces that share the constants above.
 */

import { describe, it, expect } from 'vitest'
import {
  PRIMARY_CTA_LABEL_PRO_ANNUAL,
  SECONDARY_CTA_LABEL_PRO_MONTHLY,
  UPGRADE_COPY,
} from './upgradeCopy'

describe('upgradeCopy — Pro CTA prices match plans.yaml', () => {
  it('PRIMARY_CTA_LABEL_PRO_ANNUAL anchors on Pro Annual ($40.83/mo), not Hobby Annual ($7.50/mo)', () => {
    expect(PRIMARY_CTA_LABEL_PRO_ANNUAL).toContain('$40.83')
    expect(PRIMARY_CTA_LABEL_PRO_ANNUAL).toContain('billed yearly')
    // Negative assertion — the FIX-G regression we're guarding against.
    expect(PRIMARY_CTA_LABEL_PRO_ANNUAL).not.toContain('$7.50')
  })

  it('SECONDARY_CTA_LABEL_PRO_MONTHLY anchors on Pro Monthly ($49/mo), not Hobby Monthly ($9/mo)', () => {
    expect(SECONDARY_CTA_LABEL_PRO_MONTHLY).toContain('$49')
    // Negative assertion — Hobby Monthly was the wrong number that shipped
    // before FIX-G. The slash before "mo" makes the check unambiguous so it
    // doesn't trip on e.g. "$490/yr".
    expect(SECONDARY_CTA_LABEL_PRO_MONTHLY).not.toMatch(/\$9\/mo/)
  })

  it('every UPGRADE_COPY entry uses the correct Pro Annual priceLine ($40.83/mo)', () => {
    // The 6 surfaces (vault_prod / provision_twin / family_bindings /
    // quota_wall / custom_domain / private_deploy) all carry a priceLine
    // for visual continuity. Each must reflect Pro Annual.
    for (const [key, copy] of Object.entries(UPGRADE_COPY)) {
      expect(copy.priceLine, `${key}.priceLine`).toBeDefined()
      expect(copy.priceLine, `${key}.priceLine`).toContain('$40.83')
      expect(copy.priceLine, `${key}.priceLine`).not.toContain('$7.50')
    }
  })

  it('every UPGRADE_COPY entry routes its primary CTA to the shared PRIMARY_CTA_LABEL_PRO_ANNUAL', () => {
    // Belt-and-braces: if a future surface forks the label, this catches it
    // so the centralised constant stays the single source of truth.
    for (const [key, copy] of Object.entries(UPGRADE_COPY)) {
      expect(copy.primaryCtaLabel, `${key}.primaryCtaLabel`).toBe(PRIMARY_CTA_LABEL_PRO_ANNUAL)
      expect(copy.primaryCtaFrequency, `${key}.primaryCtaFrequency`).toBe('yearly')
      expect(copy.secondaryCtaLabel, `${key}.secondaryCtaLabel`).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
      expect(copy.secondaryCtaFrequency, `${key}.secondaryCtaFrequency`).toBe('monthly')
    }
  })
})
