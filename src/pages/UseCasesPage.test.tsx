/* UseCasesPage.test.tsx — coverage for filter / grouping logic + render. */
import { describe, it, expect } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UseCasesPage } from './UseCasesPage'
import { USE_CASES, type Category } from '../content/useCases'

function renderPage() {
  return render(
    <MemoryRouter>
      <UseCasesPage />
    </MemoryRouter>,
  )
}

describe('UseCasesPage', () => {
  it('renders the hero headline and quickstart CTA', () => {
    renderPage()
    expect(document.body.textContent ?? '').toContain('Fifty places instanode.dev fits')
    const cta = document.querySelector('a[href="/docs#quickstart"]')
    expect(cta).toBeTruthy()
    cleanup()
  })

  it('renders one card per use case by default', () => {
    renderPage()
    const cards = document.querySelectorAll('a.uc-card-link')
    expect(cards.length).toBe(USE_CASES.length)
    cleanup()
  })

  it('renders a filter chip per unique category + the "All" chip', () => {
    renderPage()
    const uniqueCats = new Set<Category>()
    for (const c of USE_CASES) uniqueCats.add(c.category)
    const chips = document.querySelectorAll('button.uc-chip')
    expect(chips.length).toBe(uniqueCats.size + 1) // +1 for "All"
    cleanup()
  })

  it('"All" chip is selected by default (has uc-chip-on)', () => {
    renderPage()
    const first = document.querySelector('button.uc-chip')
    expect(first?.classList.contains('uc-chip-on')).toBe(true)
    cleanup()
  })

  it('clicking a category chip filters the rendered cards', () => {
    if (USE_CASES.length === 0) return
    const firstCat = USE_CASES[0].category
    const expectedCount = USE_CASES.filter((u) => u.category === firstCat).length

    renderPage()
    // Find the chip whose text begins with the category label (stripped of "X. ").
    const stripped = firstCat.replace(/^[A-Z]\.\s*/, '')
    const chips = Array.from(document.querySelectorAll('button.uc-chip'))
    const target = chips.find((c) => (c.textContent ?? '').startsWith(stripped))
    expect(target, `no chip matched category ${firstCat}`).toBeTruthy()
    fireEvent.click(target!)

    const cards = document.querySelectorAll('a.uc-card-link')
    expect(cards.length).toBe(expectedCount)
    expect(target!.classList.contains('uc-chip-on')).toBe(true)
    cleanup()
  })

  it('every card links to /use-cases/<slug>', () => {
    renderPage()
    for (const u of USE_CASES) {
      const link = document.querySelector(`a[href="/use-cases/${u.slug}"]`)
      expect(link, `missing link for ${u.slug}`).toBeTruthy()
    }
    cleanup()
  })
})
