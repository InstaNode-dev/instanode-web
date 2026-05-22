/* SecurityPage.test.tsx — /security + generic /legal/:slug. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SecurityPage, LegalDocPage } from './SecurityPage'

afterEach(() => cleanup())

describe('SecurityPage', () => {
  it('renders the security doc title + raw-source link', () => {
    render(<SecurityPage />)
    // The page header (h1) + the markdown's own "# Security Disclosures"
    // both surface — at least one heading must carry the title.
    expect(screen.getAllByRole('heading', { name: /Security Disclosures/i }).length).toBeGreaterThan(0)
    const raw = screen.getByRole('link', { name: /\/docs\/public\/security\.md/i })
    expect(raw.getAttribute('href')).toBe('/docs/public/security.md')
  })

  it('has a back-to-homepage link', () => {
    render(<SecurityPage />)
    expect(screen.getByRole('link', { name: /Back to homepage/i }).getAttribute('href')).toBe('/')
  })
})

function renderLegal(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/legal/${slug}`]}>
      <Routes>
        <Route path="/legal/:slug" element={<LegalDocPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LegalDocPage', () => {
  it('renders a known doc by slug (subprocessors)', () => {
    renderLegal('subprocessors')
    expect(screen.getAllByRole('heading', { name: /Subprocessors/i }).length).toBeGreaterThan(0)
  })

  it('renders a friendly fallback for an unknown slug', () => {
    renderLegal('does-not-exist')
    expect(screen.getByText(/couldn't find a legal document/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Document/i })).toBeTruthy()
  })
})
