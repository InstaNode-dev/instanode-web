/* UpgradePromptCard.test.tsx — unit tests for the in-context upgrade card (U2).
 *
 * Three responsibilities, tested separately:
 *   1. Per-feature copy (title + body) — the surface-specific framing
 *   2. PRIMARY CTA — defaults to Pro Annual, supports P1 variant override,
 *      navigates to /app/billing?frequency=yearly&plan=pro
 *   3. SECONDARY CTA — static "Or pay monthly" link that navigates to
 *      /app/billing?frequency=monthly&plan=pro and is NEVER overridden
 *      by the P1 experiment (the A/B test only runs on the primary)
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

// Module-level mock for useDashboardCtx so each test controls what /auth/me
// returns. Mutable holder so the suite can flip variants between cases.
let mockMe: any = null
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: mockMe,
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
    billing: null,
    billingLoading: false,
  }),
}))

import { UpgradePromptCard } from './UpgradePromptCard'
import {
  UPGRADE_COPY,
  BILLING_PATH,
  PRIMARY_CTA_LABEL_PRO_ANNUAL,
  SECONDARY_CTA_LABEL_PRO_MONTHLY,
  type UpgradeFeature,
} from './upgradeCopy'

afterEach(() => {
  mockMe = null
  cleanup()
})

function withMe(me: any, ui: ReactNode) {
  mockMe = me
  return render(<>{ui}</>)
}

// Helper: parse the href on a rendered CTA into its frequency + plan params.
// Kept here (not in helpers_test) so the assertion stays close to the test.
function parseCtaHref(el: HTMLAnchorElement): {
  path: string
  frequency: string | null
  plan: string | null
} {
  const href = el.getAttribute('href') ?? ''
  const [path, query = ''] = href.split('?')
  const params = new URLSearchParams(query)
  return {
    path,
    frequency: params.get('frequency'),
    plan: params.get('plan'),
  }
}

describe('UpgradePromptCard — per-feature copy', () => {
  const FEATURES: UpgradeFeature[] = [
    'vault_prod',
    'provision_twin',
    'family_bindings',
    'quota_wall',
    'custom_domain',
    'private_deploy',
  ]

  for (const feature of FEATURES) {
    it(`renders the ${feature} title and body from upgradeCopy`, () => {
      withMe(null, <UpgradePromptCard feature={feature} />)
      const card = screen.getByTestId(`upgrade-prompt-${feature}`)
      expect(card).toBeTruthy()
      expect(card.getAttribute('data-feature')).toBe(feature)
      // Title and body come straight from the central copy map.
      expect(screen.getByTestId('upgrade-prompt-title').textContent).toContain(
        UPGRADE_COPY[feature].title,
      )
      expect(screen.getByTestId('upgrade-prompt-body').textContent).toContain(
        UPGRADE_COPY[feature].body,
      )
    })
  }

  it('renders different copy for two different feature keys', () => {
    const { container, rerender } = withMe(
      null,
      <UpgradePromptCard feature="vault_prod" />,
    )
    const vaultTitle = container.querySelector('[data-testid="upgrade-prompt-title"]')!.textContent
    rerender(<UpgradePromptCard feature="custom_domain" />)
    const cdTitle = container.querySelector('[data-testid="upgrade-prompt-title"]')!.textContent
    expect(vaultTitle).not.toEqual(cdTitle)
  })

  it('renders the priceLine footer when defined', () => {
    withMe(null, <UpgradePromptCard feature="vault_prod" />)
    // The post-refactor priceLine is the Pro Annual framing — "2 months free"
    // is the load-bearing phrase from the pricing playbook.
    expect(screen.getByTestId('upgrade-prompt-price').textContent).toContain(
      '2 months free',
    )
  })
})

describe('UpgradePromptCard — primary CTA (Pro Annual default)', () => {
  it('renders the Pro Annual primary label by default on every surface', () => {
    withMe(null, <UpgradePromptCard feature="family_bindings" />)
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(
      PRIMARY_CTA_LABEL_PRO_ANNUAL,
    )
  })

  it('navigates the primary CTA to /app/billing?frequency=yearly&plan=pro', () => {
    withMe(null, <UpgradePromptCard feature="vault_prod" />)
    const parsed = parseCtaHref(
      screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement,
    )
    expect(parsed.path).toBe(BILLING_PATH)
    expect(parsed.frequency).toBe('yearly')
    expect(parsed.plan).toBe('pro')
  })

  it('marks the primary CTA with data-frequency=yearly for analytics hooks', () => {
    withMe(null, <UpgradePromptCard feature="vault_prod" />)
    expect(
      screen.getByTestId('upgrade-prompt-cta').getAttribute('data-frequency'),
    ).toBe('yearly')
  })

  it('keeps the Pro Annual label when /auth/me has experiments but no upgrade_cta', () => {
    withMe(
      { user: {}, team: { tier: 'hobby' }, experiments: {} },
      <UpgradePromptCard feature="family_bindings" />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(
      PRIMARY_CTA_LABEL_PRO_ANNUAL,
    )
  })
})

describe('UpgradePromptCard — P1 variant composition (primary only)', () => {
  it('uses the P1 experiment label on the primary CTA when /auth/me supplies one', () => {
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'B', label: 'Get Pro now' } },
      },
      <UpgradePromptCard feature="family_bindings" />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Get Pro now')
  })

  it('keeps the primary destination at frequency=yearly even when P1 overrides the label', () => {
    // The A/B test is on copy, NOT on destination — a variant that says
    // "Unlock Pro features" should still land on the yearly checkout.
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'C', label: 'Unlock Pro features' } },
      },
      <UpgradePromptCard feature="vault_prod" />,
    )
    const parsed = parseCtaHref(
      screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement,
    )
    expect(parsed.frequency).toBe('yearly')
    expect(parsed.plan).toBe('pro')
  })

  it('respects the variantOverride prop (used by tests / parents)', () => {
    withMe(
      null,
      <UpgradePromptCard
        feature="vault_prod"
        variantOverride={{ label: 'Unlock for $9' }}
      />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Unlock for $9')
  })

  it('variantOverride={null} forces the Pro Annual default even when /auth/me has a variant', () => {
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'B', label: 'Start free trial' } },
      },
      <UpgradePromptCard feature="family_bindings" variantOverride={null} />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(
      PRIMARY_CTA_LABEL_PRO_ANNUAL,
    )
  })

  it('does NOT apply the P1 variant label to the secondary CTA', () => {
    // The secondary "Or pay monthly" is intentionally static so we don't
    // confound the A/B test by changing copy on two surfaces at once.
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'B', label: 'Get Pro now' } },
      },
      <UpgradePromptCard feature="family_bindings" />,
    )
    expect(
      screen.getByTestId('upgrade-prompt-cta-secondary').textContent,
    ).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
  })
})

describe('UpgradePromptCard — secondary CTA (monthly fallback)', () => {
  it('renders the static "Or pay monthly" secondary link', () => {
    withMe(null, <UpgradePromptCard feature="quota_wall" />)
    expect(
      screen.getByTestId('upgrade-prompt-cta-secondary').textContent,
    ).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
  })

  it('navigates the secondary link to /app/billing?frequency=monthly&plan=pro', () => {
    withMe(null, <UpgradePromptCard feature="quota_wall" />)
    const parsed = parseCtaHref(
      screen.getByTestId('upgrade-prompt-cta-secondary') as HTMLAnchorElement,
    )
    expect(parsed.path).toBe(BILLING_PATH)
    expect(parsed.frequency).toBe('monthly')
    expect(parsed.plan).toBe('pro')
  })

  it('marks the secondary link with data-frequency=monthly for analytics', () => {
    withMe(null, <UpgradePromptCard feature="quota_wall" />)
    expect(
      screen
        .getByTestId('upgrade-prompt-cta-secondary')
        .getAttribute('data-frequency'),
    ).toBe('monthly')
  })

  it('renders BOTH the primary and secondary CTAs on the same card', () => {
    withMe(null, <UpgradePromptCard feature="vault_prod" />)
    expect(screen.getByTestId('upgrade-prompt-cta')).toBeTruthy()
    expect(screen.getByTestId('upgrade-prompt-cta-secondary')).toBeTruthy()
  })
})

describe('UpgradePromptCard — link target', () => {
  it('defaults to BILLING_PATH (/app/billing) with frequency+plan query', () => {
    withMe(null, <UpgradePromptCard feature="quota_wall" />)
    const href =
      (screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement).getAttribute('href') ?? ''
    expect(href.startsWith(BILLING_PATH)).toBe(true)
    expect(href).toContain('frequency=yearly')
    expect(href).toContain('plan=pro')
  })

  it('respects an explicit href prop while still appending the frequency params', () => {
    withMe(
      null,
      <UpgradePromptCard feature="quota_wall" href="/custom/upgrade" />,
    )
    const primary = parseCtaHref(
      screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement,
    )
    const secondary = parseCtaHref(
      screen.getByTestId('upgrade-prompt-cta-secondary') as HTMLAnchorElement,
    )
    expect(primary.path).toBe('/custom/upgrade')
    expect(primary.frequency).toBe('yearly')
    expect(secondary.path).toBe('/custom/upgrade')
    expect(secondary.frequency).toBe('monthly')
  })
})
