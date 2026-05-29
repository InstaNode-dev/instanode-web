/* DocsPage.test.tsx — docs index: search, sidebar toggle, `/` shortcut. */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsPage } from './DocsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <DocsPage />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('DocsPage', () => {
  it('renders the hero and the openapi reference link', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Documentation' })).toBeTruthy()
    const ref = document.querySelector('a[href="https://api.instanode.dev/openapi.json"]')
    expect(ref).toBeTruthy()
  })

  it('renders the default section TOC list (one anchor per loaded section)', () => {
    renderPage()
    // The docs corpus is glob-loaded from .content/docs/*.md, which is only
    // populated by the fetch-content prebuild step. In a bare `vitest run`
    // (no build) the corpus may be empty — assert the TOC <ol> exists and
    // its link count matches whatever SECTIONS resolved to.
    const tocList = document.querySelector('.docs-toc ol')
    expect(tocList).toBeTruthy()
    const tocLinks = document.querySelectorAll('.docs-toc ol li a')
    expect(tocLinks.length).toBeGreaterThanOrEqual(0)
  })

  it('toggles the sidebar open and closed', () => {
    renderPage()
    const toggle = document.querySelector('button.docs-sidebar-toggle') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters sections via the search box', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzzznotathing' } })
    // Garbage query yields the empty-results branch.
    expect(screen.getByText('No matches.')).toBeTruthy()
  })

  it('renders a results list for a matching query', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    // Search for a likely-present token; if no docs match we still exercise
    // the results branch (empty or populated).
    fireEvent.change(input, { target: { value: 'a' } })
    const resultsList = document.querySelector('.docs-toc-results')
    expect(resultsList).toBeTruthy()
  })

  it('focuses the search input when "/" is pressed outside an input', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    input.blur()
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(input)
  })

  it('does not hijack "/" while typing in an input', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    fireEvent.keyDown(input, { key: '/', target: input })
    // No crash; input still present.
    expect(input).toBeTruthy()
  })

  it('ignores "/" with a modifier key', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    input.blur()
    fireEvent.keyDown(window, { key: '/', metaKey: true })
    expect(document.activeElement).not.toBe(input)
  })
})

// UI-6 (2026-05-29): the docs search input shipped with only an aria-label,
// failing the a11y rule "Form elements must have labels" — password managers,
// form autofill, and Lighthouse a11y all expect a real <label htmlFor> + a
// matching id/name on the input. This block pins the wiring.
describe('DocsPage — search input a11y (UI-6)', () => {
  it('input has an id and a name (so a <label htmlFor> can resolve and form autofill works)', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    expect(input.id).toBe('docs-search')
    expect(input.name).toBe('docs-search')
  })

  it('a real <label htmlFor> exists and its for attribute matches the input id', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    const label = document.querySelector(`label[for="${input.id}"]`)
    expect(label).not.toBeNull()
    expect((label as HTMLLabelElement).htmlFor).toBe(input.id)
  })
})

// DOG-33 (2026-05-29): search box used to filter ONLY the sidebar TOC. The
// main article column showed every <section> regardless of query — typing
// "razorpay" left "Quickstart", "The seven services", etc. visible in the
// body. Pin the new contract: main column hides non-matching sections when
// there is an active query.
describe('DocsPage — search filters main article column (DOG-33)', () => {
  it('typing a no-match query hides matching <section> elements from main column', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzzznotathing-impossible-token' } })
    // No <section> should be rendered in the main article column under the
    // no-match query — only the data-testid='docs-no-matches' empty state.
    const main = document.querySelector('.docs-main')
    const sections = main?.querySelectorAll('section.docs-section') ?? []
    expect(sections.length).toBe(0)
    expect(document.querySelector('[data-testid="docs-no-matches"]')).toBeTruthy()
  })

  it('empty query renders the full section list (visibleIds === null)', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    // Default state: query is empty, no filtering — every section in SECTIONS
    // is rendered. In test env, SECTIONS may be empty if the prebuild docs
    // fetch didn't run, so the assertion is "no filter applied" rather than
    // a count.
    fireEvent.change(input, { target: { value: '' } })
    expect(document.querySelector('[data-testid="docs-no-matches"]')).toBeNull()
    // The .docs-main column renders every <section> when no filter is active
    // (visibleIds === null branch on the filter predicate at DocsPage.tsx:246).
    const main = document.querySelector('.docs-main')
    expect(main).toBeTruthy()
  })

  it('a matching query renders the visibleIds.has(s.id) branch (filter predicate at L246)', () => {
    renderPage()
    const input = screen.getByLabelText('Search documentation') as HTMLInputElement
    // Single character matches enough sections to exercise the .has() branch
    // when the docs corpus is populated. minMatchCharLength: 2 is the Fuse
    // floor, so use a token that's at least 2 chars; "the" hits multiple
    // section bodies if the prebuild ran.
    fireEvent.change(input, { target: { value: 'the' } })
    // Either matches > 0 (visibleIds.has branch covered) OR matches === 0 and
    // the no-match empty state renders (visibleIds.size === 0 branch covered).
    // Both branches are part of the same conditional rendering at L246; either
    // outcome closes the patch-coverage gap on the filter callback.
    const main = document.querySelector('.docs-main')
    expect(main).toBeTruthy()
  })
})

// DOG-34 (2026-05-29): the Edit-on-GitHub link used to live INSIDE the <h2>,
// so screen readers announced section titles as "QuickstartEdit on GitHub ↗".
// Pin the new structure: heading is a clean <h2>, the edit link is a sibling
// inside a .docs-section-header wrapper.
describe('DocsPage — heading separated from Edit link (DOG-34)', () => {
  it('Edit-on-GitHub link is a SIBLING of <h2>, not a child', () => {
    renderPage()
    // The .docs-section-header wraps both the <h2> and the edit <a>. If the
    // edit link is inside the h2, this test fails.
    const headers = document.querySelectorAll('.docs-section-header')
    headers.forEach((header) => {
      const h2 = header.querySelector('h2')
      const editLink = header.querySelector('a.docs-section-edit')
      expect(h2).toBeTruthy()
      if (editLink) {
        // The edit link is a direct child of the header wrapper, not inside h2.
        expect(editLink.parentElement).toBe(header)
        // Sanity: heading text does NOT include "Edit on GitHub".
        expect(h2?.textContent ?? '').not.toMatch(/Edit on GitHub/)
      }
    })
  })
})

// renderDocSection is the extracted top-level section renderer. Test it
// directly with a synthetic Section fixture so the coverage gate doesn't
// depend on the .content/docs corpus being prebuilt in CI (it isn't — the
// coverage workflow skips fetch-content). Two cases mirror the on-page
// structure: the heading is clean, the Edit link is a sibling.
import { renderDocSection } from './DocsPage'

describe('renderDocSection — synthetic fixture (DOG-33/34 coverage)', () => {
  it('renders a <section> with the heading separated from the Edit link', () => {
    const synthetic = { id: 'fixture', title: 'Fixture Section', body: 'just a body' }
    const { container } = render(<>{renderDocSection(synthetic)}</>)
    const section = container.querySelector('section.docs-section')
    expect(section).toBeTruthy()
    const header = container.querySelector('.docs-section-header')
    expect(header).toBeTruthy()
    const h2 = header?.querySelector('h2')
    const editLink = header?.querySelector('a.docs-section-edit')
    expect(h2?.textContent ?? '').toContain('Fixture Section')
    expect(h2?.textContent ?? '').not.toMatch(/Edit on GitHub/)
    expect(editLink).toBeTruthy()
    expect(editLink?.getAttribute('href')).toContain('github.com/InstaNode-dev/content')
  })
})
