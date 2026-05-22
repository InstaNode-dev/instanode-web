/* UseCasesPage.test.tsx — catalogue page.
 *
 * In the test environment the `.content/use-cases/*.md` glob is empty
 * (fetch-content.mjs hasn't run), so USE_CASES is []. We mock the content
 * module to inject a deterministic catalogue and exercise the filter +
 * grouping logic that the empty real fixture can't reach. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../content/useCases', async () => {
  const actual = await vi.importActual<typeof import('../content/useCases')>('../content/useCases')
  const USE_CASES: import('../content/useCases').UseCase[] = [
    { slug: 'a1', title: 'Agent memory', category: 'A. Agents', scenario: 'cross-session memory', services: ['pg', 'redis'], body: '' },
    { slug: 'b1', title: 'Hackathon backend', category: 'B. Builders', scenario: 'backend in three curls', services: ['deploy'], body: '' },
    { slug: 'a2', title: 'Agent queue', category: 'A. Agents', scenario: 'task fan-out', services: ['nats'], body: '' },
  ]
  return { ...actual, USE_CASES }
})

import { UseCasesPage } from './UseCasesPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderPage() {
  return render(<MemoryRouter><UseCasesPage /></MemoryRouter>)
}

describe('UseCasesPage', () => {
  it('renders the hero and an "All N" chip reflecting the catalogue size', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /Fifty places/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /All 3/i })).toBeTruthy()
  })

  it('renders one card per case with a link to the detail page', () => {
    renderPage()
    expect(screen.getByText('Agent memory')).toBeTruthy()
    expect(screen.getByText('Hackathon backend')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /See how/i })
    expect(links.length).toBe(3)
    expect(links.some((l) => l.getAttribute('href') === '/use-cases/a1')).toBe(true)
  })

  it('renders the human service labels for each card', () => {
    renderPage()
    expect(screen.getAllByText('Postgres').length).toBeGreaterThan(0)
    expect(screen.getAllByText('NATS').length).toBeGreaterThan(0)
  })

  it('filters to a single category when a category chip is clicked', () => {
    renderPage()
    // "B. Builders" chip — its label has the "B. " prefix stripped.
    const builders = screen.getByRole('button', { name: /^Builders/i })
    fireEvent.click(builders)
    expect(screen.getByText('Hackathon backend')).toBeTruthy()
    expect(screen.queryByText('Agent memory')).toBeNull()
  })

  it('returns to the full list when "All" is clicked again', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^Builders/i }))
    expect(screen.queryByText('Agent memory')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /All 3/i }))
    expect(screen.getByText('Agent memory')).toBeTruthy()
  })
})
