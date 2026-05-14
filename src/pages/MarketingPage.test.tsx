/* MarketingPage.test.tsx — regression guards for legal footer links and the
 * new "paste this into your AI" starter-prompt section.
 *
 * Two clusters of tests live here:
 *
 *   1. W12 H15 footer link guards — the MarketingPage footer used to link
 *      three legal/agent paths that App.tsx never registered: /privacy,
 *      /terms, /llms.txt. The catch-all `*` route redirected every click
 *      to `/`, so the footer was dead. We pin the hrefs here so a future
 *      refactor of the footer can't silently kill the links again.
 *
 *   2. AI starter-prompt section guards — the "paste this into your AI"
 *      block (#ai-starter) is the homepage's strongest funnel hook. The
 *      tests below pin its existence, the prompt content (must mention
 *      llms.txt), the Copy button's a11y, and the clipboard wiring.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MarketingPage, AI_STARTER_PROMPT } from './MarketingPage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function findAnchorByText(text: string): HTMLAnchorElement | null {
  for (const a of Array.from(document.querySelectorAll('a'))) {
    if ((a.textContent ?? '').trim() === text) return a as HTMLAnchorElement
  }
  return null
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <MarketingPage />
    </MemoryRouter>,
  )
}

describe('MarketingPage — legal footer links (W12 H15)', () => {
  it('Privacy link points at /privacy (a real route post-W12)', () => {
    renderPage()
    const a = findAnchorByText('Privacy')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('/privacy')
  })

  it('Terms link points at /terms (a real route post-W12)', () => {
    renderPage()
    const a = findAnchorByText('Terms')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('/terms')
  })

  it("llms.txt link points at the absolute apex URL (not relative /llms.txt — dashboard host doesn't serve that file)", () => {
    renderPage()
    const a = findAnchorByText('llms.txt')
    expect(a).not.toBeNull()
    expect(a!.getAttribute('href')).toBe('https://instanode.dev/llms.txt')
  })
})

describe('MarketingPage — AI starter prompt section', () => {
  it('renders a section with id="ai-starter" so the prompt can be anchored from nav / external links', () => {
    renderPage()
    const section = document.getElementById('ai-starter')
    expect(section).not.toBeNull()
    expect(section!.tagName.toLowerCase()).toBe('section')
  })

  it('prompt text mentions https://instanode.dev/llms.txt so the LLM has the full API contract', () => {
    renderPage()
    expect(AI_STARTER_PROMPT).toContain('https://instanode.dev/llms.txt')
    const promptEl = screen.getByTestId('ai-starter-prompt')
    expect(promptEl.textContent).toContain('https://instanode.dev/llms.txt')
  })

  it('prompt text contains the [describe what you\'re building] placeholder so users see this is a starter, not a finished prompt', () => {
    renderPage()
    expect(AI_STARTER_PROMPT).toContain("[describe what you're building]")
  })

  it('prompt text shows the /db/new endpoint so users understand the shape before the agent reads llms.txt', () => {
    renderPage()
    expect(AI_STARTER_PROMPT).toContain('https://api.instanode.dev/db/new')
  })

  it('Copy button exists, is a real <button>, and is keyboard-focusable', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: /copy starter prompt/i })
    expect(btn).not.toBeNull()
    expect(btn.tagName.toLowerCase()).toBe('button')
    // tabIndex defaults to 0 for buttons; assert it's not disabled/-1.
    expect(btn.hasAttribute('disabled')).toBe(false)
    expect(btn.getAttribute('tabindex')).not.toBe('-1')
  })

  it('clicking Copy calls navigator.clipboard.writeText with the full starter prompt and flips label to "Copied"', async () => {
    // jsdom doesn't ship a clipboard implementation. We install a mock on
    // navigator that captures the writeText call so we can assert on it.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })

    renderPage()
    const btn = screen.getByRole('button', { name: /copy starter prompt/i })
    expect(btn.textContent).toMatch(/^copy$/i)

    fireEvent.click(btn)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(AI_STARTER_PROMPT)

    // The handler awaits the clipboard promise before flipping state, so
    // wait for the label to change.
    await waitFor(() => expect(btn.textContent).toMatch(/copied/i))
  })

  it('renders a visible llms.txt link below the codeblock that points at https://instanode.dev/llms.txt', () => {
    renderPage()
    const link = screen.getByTestId('ai-starter-llms-link') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('href')).toBe('https://instanode.dev/llms.txt')
    // Text must be visible (the URL itself, not just an icon).
    expect(link.textContent).toContain('https://instanode.dev/llms.txt')
  })
})
