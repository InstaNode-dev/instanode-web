/* UpgradePromptCard.test.tsx — unit tests for the in-context upgrade card (U2).
 *
 * Two responsibilities, tested separately:
 *   1. Per-feature copy (title + body) — the surface-specific framing
 *   2. CTA label resolution — P1 experiment variant from /auth/me, with
 *      fallbacks to per-feature override and DEFAULT_UPGRADE_CTA
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
  DEFAULT_UPGRADE_CTA,
  BILLING_PATH,
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
    expect(screen.getByTestId('upgrade-prompt-price').textContent).toContain('$9/mo')
  })
})

describe('UpgradePromptCard — CTA label resolution', () => {
  it('falls back to DEFAULT_UPGRADE_CTA when /auth/me has no experiment', () => {
    withMe(null, <UpgradePromptCard feature="family_bindings" />)
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(DEFAULT_UPGRADE_CTA)
  })

  it("falls back to DEFAULT_UPGRADE_CTA when /auth/me has experiments but no upgrade_cta", () => {
    withMe(
      { user: {}, team: { tier: 'hobby' }, experiments: {} },
      <UpgradePromptCard feature="family_bindings" />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(DEFAULT_UPGRADE_CTA)
  })

  it('uses P1 experiment label when /auth/me supplies one', () => {
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'B', label: 'Start free trial' } },
      },
      <UpgradePromptCard feature="family_bindings" />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Start free trial')
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

  it('variantOverride={null} forces the default even when /auth/me has a variant', () => {
    withMe(
      {
        user: {},
        team: { tier: 'hobby' },
        experiments: { upgrade_cta: { variant: 'B', label: 'Start free trial' } },
      },
      <UpgradePromptCard feature="family_bindings" variantOverride={null} />,
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(DEFAULT_UPGRADE_CTA)
  })
})

describe('UpgradePromptCard — link target', () => {
  it('defaults to BILLING_PATH (/app/billing)', () => {
    withMe(null, <UpgradePromptCard feature="quota_wall" />)
    expect(
      (screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement).getAttribute('href'),
    ).toBe(BILLING_PATH)
  })

  it('respects an explicit href prop', () => {
    withMe(
      null,
      <UpgradePromptCard feature="quota_wall" href="/custom/upgrade" />,
    )
    expect(
      (screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement).getAttribute('href'),
    ).toBe('/custom/upgrade')
  })
})
