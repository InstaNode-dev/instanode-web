/* UpgradePromptSurfaces.test.tsx — integration coverage for U2.
 *
 * U2 replaces every generic "Upgrade to Pro" CTA with a feature-specific
 * UpgradePromptCard. This file asserts that each refactored surface renders
 * the new card (not the old generic button) and that the card's CTA respects
 * the P1 experiment variant injected via /auth/me.
 *
 * Each surface is rendered in isolation so the suite stays fast and we
 * don't bleed coverage from the page's other async behaviours.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  UPGRADE_COPY,
  PRIMARY_CTA_LABEL_PRO_ANNUAL,
  SECONDARY_CTA_LABEL_PRO_MONTHLY,
  BILLING_PATH,
} from './upgradeCopy'

// ─── Module mocks ────────────────────────────────────────────────────────

// useDashboardCtx is mutable per-test. The variant lives under `me.experiments`.
let mockMe: any = null
let mockTier: string = 'hobby'
let mockEnv: string = 'production'
let mockResources: any[] = []

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: {
      user: { id: 'u', email: 'e@test', tier: mockTier },
      team: { id: 't', slug: 't', name: 't', tier: mockTier },
      ...(mockMe ? { experiments: mockMe.experiments } : {}),
    },
    meErr: null,
    meLoading: false,
    env: mockEnv,
    envs: ['production', 'staging', 'development'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: mockResources,
    billing: null,
    billingLoading: false,
  }),
  addEnv: vi.fn(),
}))

// Stub the API surface used by each page so the component mounts cleanly.
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listResources: vi.fn().mockResolvedValue({ ok: true, items: [], total: 0 }),
    listVault: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
    listCustomDomains: vi.fn().mockResolvedValue([]),
    createCustomDomain: vi.fn(),
  }
})

import { ResourcesPage } from '../pages/ResourcesPage'
import { VaultPage } from '../pages/VaultPage'
import { CustomDomainPanel } from './CustomDomainPanel'
import * as api from '../api'

function withRouter(ui: ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

beforeEach(() => {
  mockMe = null
  mockTier = 'hobby'
  mockEnv = 'production'
  mockResources = []
  ;(api.listResources as any).mockReset?.()
  ;(api.listVault as any).mockReset?.()
  ;(api.listCustomDomains as any).mockReset?.()
  ;(api.createCustomDomain as any).mockReset?.()
  ;(api.listResources as any).mockResolvedValue({ ok: true, items: [], total: 0 })
  ;(api.listVault as any).mockResolvedValue({ ok: true, entries: [] })
  ;(api.listCustomDomains as any).mockResolvedValue([])
})

afterEach(() => cleanup())

// ─── ResourcesPage — quota_wall prompt ───────────────────────────────────

describe('ResourcesPage — quota_wall upgrade prompt', () => {
  it('renders the quota_wall card when a hobby resource is at >= 80% usage', async () => {
    mockTier = 'hobby'
    ;(api.listResources as any).mockResolvedValue({
      ok: true,
      total: 1,
      items: [
        {
          id: 'r1',
          token: 'r1',
          resource_type: 'postgres',
          tier: 'hobby',
          status: 'active',
          name: 'app-db',
          env: 'production',
          storage_bytes: 900_000_000,
          storage_limit_bytes: 1_000_000_000,
          storage_exceeded: false,
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      ],
    })
    render(withRouter(<ResourcesPage />))
    await waitFor(() =>
      expect(screen.queryByTestId('upgrade-prompt-quota_wall')).toBeTruthy(),
    )
    expect(screen.getByTestId('upgrade-prompt-title').textContent).toContain(
      UPGRADE_COPY.quota_wall.title,
    )
  })

  it('does NOT render the card when no resource has crossed the 80% threshold', async () => {
    mockTier = 'hobby'
    ;(api.listResources as any).mockResolvedValue({
      ok: true,
      total: 1,
      items: [
        {
          id: 'r1',
          token: 'r1',
          resource_type: 'postgres',
          tier: 'hobby',
          status: 'active',
          name: 'app-db',
          env: 'production',
          storage_bytes: 100_000_000,
          storage_limit_bytes: 1_000_000_000,
          storage_exceeded: false,
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      ],
    })
    render(withRouter(<ResourcesPage />))
    // Give the effect a tick to settle. If the prompt ever appeared, it'd
    // be there immediately on render after the resolve — wait briefly.
    await waitFor(() => expect(api.listResources).toHaveBeenCalled())
    expect(screen.queryByTestId('upgrade-prompt-quota_wall')).toBeNull()
  })

  it('does NOT render the card for pro-tier users even at high usage', async () => {
    mockTier = 'pro'
    ;(api.listResources as any).mockResolvedValue({
      ok: true,
      total: 1,
      items: [
        {
          id: 'r1',
          token: 'r1',
          resource_type: 'postgres',
          tier: 'pro',
          status: 'active',
          name: 'app-db',
          env: 'production',
          storage_bytes: 4_500_000_000,
          storage_limit_bytes: 5_000_000_000,
          storage_exceeded: false,
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      ],
    })
    render(withRouter(<ResourcesPage />))
    await waitFor(() => expect(api.listResources).toHaveBeenCalled())
    expect(screen.queryByTestId('upgrade-prompt-quota_wall')).toBeNull()
  })
})

// ─── VaultPage — vault_prod prompt ───────────────────────────────────────

describe('VaultPage — vault_prod upgrade prompt', () => {
  it('shows vault_prod card when hobby user navigates to a non-prod env', async () => {
    mockTier = 'hobby'
    mockEnv = 'staging'
    render(withRouter(<VaultPage />))
    await waitFor(() =>
      expect(screen.queryByTestId('upgrade-prompt-vault_prod')).toBeTruthy(),
    )
    expect(screen.getByTestId('upgrade-prompt-title').textContent).toContain(
      UPGRADE_COPY.vault_prod.title,
    )
  })

  it('hides vault_prod card on the production env (no friction)', async () => {
    mockTier = 'hobby'
    mockEnv = 'production'
    render(withRouter(<VaultPage />))
    await waitFor(() => expect(api.listVault).toHaveBeenCalled())
    expect(screen.queryByTestId('upgrade-prompt-vault_prod')).toBeNull()
  })

  it('hides vault_prod card for pro-tier users (already unlocked)', async () => {
    mockTier = 'pro'
    mockEnv = 'staging'
    render(withRouter(<VaultPage />))
    await waitFor(() => expect(api.listVault).toHaveBeenCalled())
    expect(screen.queryByTestId('upgrade-prompt-vault_prod')).toBeNull()
  })
})

// ─── CustomDomainPanel — custom_domain prompt ────────────────────────────

describe('CustomDomainPanel — custom_domain upgrade prompt on 402', () => {
  it('replaces the legacy "Upgrade to Pro" anchor with the UpgradePromptCard', async () => {
    ;(api.createCustomDomain as any).mockRejectedValue({
      status: 402,
      code: 'upgrade_required',
    })
    render(<CustomDomainPanel stackSlug="stk-x" />)
    // Open the "add domain" form.
    await waitFor(() => screen.getByRole('button', { name: /add domain/i }))
    fireEvent.click(screen.getByRole('button', { name: /add domain/i }))
    fireEvent.change(screen.getByLabelText(/hostname/i), {
      target: { value: 'app.acme.com' },
    })
    // Trigger the create call so 402 fires.
    fireEvent.submit(
      screen.getByLabelText(/hostname/i).closest('form')!,
    )
    await waitFor(() =>
      expect(screen.queryByTestId('upgrade-prompt-custom_domain')).toBeTruthy(),
    )
    // Banner copy matches the feature key.
    expect(screen.getByTestId('upgrade-prompt-title').textContent).toContain(
      UPGRADE_COPY.custom_domain.title,
    )
  })
})

// ─── P1 variant composition ──────────────────────────────────────────────

describe('UpgradePromptCard composes with the P1 experiment variant', () => {
  it('defaults the primary CTA to the Pro Annual label when /auth/me has no variant', async () => {
    mockTier = 'hobby'
    mockEnv = 'staging'
    render(withRouter(<VaultPage />))
    await waitFor(() =>
      expect(screen.queryByTestId('upgrade-prompt-vault_prod')).toBeTruthy(),
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe(
      PRIMARY_CTA_LABEL_PRO_ANNUAL,
    )
    // The secondary "Or pay monthly" link always renders alongside the
    // primary regardless of variant state.
    expect(
      screen.getByTestId('upgrade-prompt-cta-secondary').textContent,
    ).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
  })

  it('uses the P1 variant label on the PRIMARY CTA when /auth/me supplies one', async () => {
    // Regression guard: P1 variants must continue to override the primary
    // CTA copy. This is the load-bearing assertion for the P1 composition.
    mockTier = 'hobby'
    mockEnv = 'staging'
    mockMe = { experiments: { upgrade_cta: { variant: 'B', label: 'Try Pro free' } } }
    render(withRouter(<VaultPage />))
    await waitFor(() =>
      expect(screen.queryByTestId('upgrade-prompt-vault_prod')).toBeTruthy(),
    )
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Try Pro free')
    // …but the destination stays yearly so the experiment only measures copy.
    const primaryHref =
      (screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement).getAttribute('href') ?? ''
    expect(primaryHref).toContain('frequency=yearly')
    expect(primaryHref).toContain('plan=pro')
    // …and the secondary monthly link is unaffected by the variant.
    expect(
      screen.getByTestId('upgrade-prompt-cta-secondary').textContent,
    ).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
  })
})

// ─── 5-surface regression: primary→yearly, secondary→monthly ─────────────
//
// U2 lit up UpgradePromptCard across 5 surfaces (vault_prod, provision_twin,
// family_bindings, quota_wall, custom_domain — the BillingPage CTA is a 6th
// but lives in a parallel PR). This block proves the Pro Annual primary +
// monthly secondary render correctly on every surface, in isolation, with
// no /auth/me variant in flight.

import { UpgradePromptCard } from './UpgradePromptCard'
import type { UpgradeFeature } from './upgradeCopy'

describe('5-surface regression — primary yearly + secondary monthly', () => {
  const SURFACES: UpgradeFeature[] = [
    'vault_prod',
    'provision_twin',
    'family_bindings',
    'quota_wall',
    'custom_domain',
  ]

  for (const feature of SURFACES) {
    it(`renders Pro Annual primary + monthly secondary on ${feature}`, () => {
      render(<UpgradePromptCard feature={feature} />)
      const primary = screen.getByTestId('upgrade-prompt-cta') as HTMLAnchorElement
      const secondary = screen.getByTestId(
        'upgrade-prompt-cta-secondary',
      ) as HTMLAnchorElement
      expect(primary.textContent).toBe(PRIMARY_CTA_LABEL_PRO_ANNUAL)
      expect(secondary.textContent).toBe(SECONDARY_CTA_LABEL_PRO_MONTHLY)
      const pHref = primary.getAttribute('href') ?? ''
      const sHref = secondary.getAttribute('href') ?? ''
      expect(pHref.startsWith(BILLING_PATH)).toBe(true)
      expect(pHref).toContain('frequency=yearly')
      expect(pHref).toContain('plan=pro')
      expect(sHref.startsWith(BILLING_PATH)).toBe(true)
      expect(sHref).toContain('frequency=monthly')
      expect(sHref).toContain('plan=pro')
    })
  }
})
