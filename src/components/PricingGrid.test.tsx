/* PricingGrid.test.tsx — pricing copy regression guards.
 *
 * BIZ-3 (2026-05-29): the dashboard in-app pricing tile shipped with copy
 * inherited from a retired "deployment_size" field on /deploy/new:
 *   - Hobby tile: "1 small deployment"
 *   - Pro tile:   "50 GB object storage · 10 medium deployments"
 *
 * The backend handler (api/internal/handlers/deploy.go) has no
 * deployment_size field — there are no small/medium/large pod sizes.
 * Numbers come from plans.yaml deployments_apps. Marketing PricingPage
 * (src/pages/PricingPage.tsx) dropped the size adjectives in the
 * 2026-05-20 DOC-REALITY-DELTA sweep; the dashboard surface lagged.
 *
 * This test pins both strings out of the in-app pricing surface so any
 * future copy edit that re-introduces them fails CI before it ships.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PricingGrid } from './PricingGrid'

afterEach(() => cleanup())

function renderGrid() {
  return render(
    <MemoryRouter>
      <PricingGrid
        currentTier="free"
        frequency="monthly"
        onFrequencyChange={() => {}}
        onSelectTier={() => {}}
      />
    </MemoryRouter>,
  )
}

describe('PricingGrid — BIZ-3 deployment copy regression', () => {
  it('does not render "small deployment" copy anywhere', () => {
    renderGrid()
    expect(document.body.textContent ?? '').not.toMatch(/small deployment/i)
  })

  it('does not render "medium deployments" copy anywhere', () => {
    renderGrid()
    expect(document.body.textContent ?? '').not.toMatch(/medium deployments/i)
  })

  it('Hobby tile says "1 deployment" (matches plans.yaml deployments_apps=1)', () => {
    renderGrid()
    expect(document.body.textContent ?? '').toContain('1 deployment')
  })

  it('Pro tile says "10 deployments" (matches plans.yaml deployments_apps=10)', () => {
    renderGrid()
    expect(document.body.textContent ?? '').toContain('10 deployments')
  })
})
