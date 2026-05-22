/* UseCaseDetailPage.test.tsx — /use-cases/:slug detail.
 *
 * The .content glob is empty in tests so getUseCaseBySlug() returns
 * undefined for real slugs. We mock the content module to return a fake
 * case for known slugs and undefined otherwise — that lets us drive both
 * the Detail (auto-generated + hand-authored body) and NotFound branches. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const fakeCases: Record<string, import('../content/useCases').UseCase> = {
  'auto-case': {
    slug: 'auto-case',
    title: 'Auto-generated case',
    category: 'A. Agents',
    scenario: 'A scenario with no hand body',
    services: ['pg', 'webhook'],
    body: '',
  },
  'body-case': {
    slug: 'body-case',
    title: 'Hand-authored case',
    category: 'B. Builders',
    scenario: 'A scenario with a real body',
    services: ['redis'],
    body: '## How it works\n\nProvision a Redis with one curl.',
  },
  'empty-services': {
    slug: 'empty-services',
    title: 'No services case',
    category: 'C. Other',
    scenario: 'edge: empty services',
    services: [],
    body: '',
  },
}

vi.mock('../content/useCases', async () => {
  const actual = await vi.importActual<typeof import('../content/useCases')>('../content/useCases')
  return {
    ...actual,
    getUseCaseBySlug: (slug: string) => fakeCases[slug],
  }
})

import { UseCaseDetailPage } from './UseCaseDetailPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/use-cases/${slug}`]}>
      <Routes>
        <Route path="/use-cases/:slug" element={<UseCaseDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UseCaseDetailPage', () => {
  it('renders the auto-generated "How to set it up" section when there is no body', () => {
    renderAt('auto-case')
    expect(screen.getByRole('heading', { name: /Auto-generated case/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /How to set it up/i })).toBeTruthy()
    // Two services → two provision steps + the wiring step.
    expect(screen.getByText(/Provision Postgres/i)).toBeTruthy()
    expect(screen.getByText(/Provision Webhook receiver/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Why this is useful/i })).toBeTruthy()
  })

  it('shows the primary curl in the footer CTA', () => {
    renderAt('auto-case')
    // pg curl appears in both step 1 and the footer CTA.
    expect(screen.getAllByText(/api\.instanode\.dev\/db\/new/i).length).toBeGreaterThan(0)
  })

  it('renders the hand-authored body instead of the auto section', () => {
    renderAt('body-case')
    expect(screen.getByRole('heading', { name: /Hand-authored case/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /How it works/i })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /How to set it up/i })).toBeNull()
  })

  it('falls back to the Postgres curl when services is empty', () => {
    renderAt('empty-services')
    // primaryCurl([]) → SERVICE_INFO.pg.curl (footer only, no steps)
    expect(screen.getByText(/api\.instanode\.dev\/db\/new/i)).toBeTruthy()
    // No "How to set it up" because services.length === 0.
    expect(screen.queryByRole('heading', { name: /How to set it up/i })).toBeNull()
  })

  it('renders the NotFound branch for an unknown slug', () => {
    renderAt('nope')
    expect(screen.getByRole('heading', { name: /Use case not found/i })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /All use cases|full catalogue/i }).length).toBeGreaterThan(0)
  })
})
