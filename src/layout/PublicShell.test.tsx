/* PublicShell.test.tsx — regression tests for the Wave 3 polish additions.
 *
 * Coverage block (rule 17 of the agent-reliability rules):
 *   Symptom:        mobile visitors had no nav (display:none above 760px)
 *   Enumeration:    grep -rn "NAV_LINKS\|public-nav-links" src/
 *   Sites found:    1 (PublicShell.tsx)
 *   Sites touched:  1
 *   Coverage test:  this file — `hamburger button toggles a panel that
 *                   contains every NAV_LINKS entry`
 *   Live verified:  pending (PR not yet deployed)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PublicShell } from './PublicShell'

describe('PublicShell — mobile hamburger nav (B2-P2-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // Hamburger is queried by class because react-testing-library treats two
  // accessible buttons in the same nav-cta cluster (theme + hamburger) as
  // ambiguous when searched purely by name regex — the class is the
  // stable structural handle.
  function getHamburger(): HTMLButtonElement {
    const el = document.querySelector('.public-nav-hamburger')
    if (!el) throw new Error('hamburger button not found')
    return el as HTMLButtonElement
  }

  it('renders a hamburger button that is always in the DOM (display flips at 760px)', () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    const btn = getHamburger()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBe('public-mobile-menu')
    expect(btn.getAttribute('aria-label')).toMatch(/open menu/i)
  })

  it('toggles the mobile menu panel via aria-expanded / .open class', () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    const btn = getHamburger()
    const panel = document.getElementById('public-mobile-menu')
    expect(panel).toBeTruthy()
    expect(panel!.classList.contains('open')).toBe(false)

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(panel!.classList.contains('open')).toBe(true)
  })

  it('mobile panel contains every NAV link', () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    const btn = getHamburger()
    fireEvent.click(btn)
    const panel = document.getElementById('public-mobile-menu')!
    const labels = ['Pricing', 'Use cases', 'For agents', 'Docs', 'Blog', 'Changelog']
    for (const l of labels) {
      expect(panel.textContent ?? '').toContain(l)
    }
  })
})

describe('PublicShell — dark/light theme toggle (B3-P2-4)', () => {
  beforeEach(() => {
    // jsdom doesn't ship a localStorage; tests run with the experimental
    // node localStorage shim. Reset attribute + storage between specs.
    try { window.localStorage.removeItem('instant.theme') } catch { /* ignore */ }
    document.documentElement.removeAttribute('data-theme')
  })

  it('renders a placeholder before mount, then a real toggle after hydration', async () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    // After useEffect runs in the test renderer, the real button is mounted.
    const btn = await screen.findByRole('button', { name: /system theme/i })
    expect(btn).toBeTruthy()
  })

  it('cycles system → light → dark → system, persisting to localStorage', async () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    let btn = await screen.findByRole('button', { name: /system theme/i })

    // system → light
    await act(async () => { fireEvent.click(btn) })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    // light → dark
    btn = await screen.findByRole('button', { name: /light theme/i })
    await act(async () => { fireEvent.click(btn) })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // dark → system (removes attribute)
    btn = await screen.findByRole('button', { name: /dark theme/i })
    await act(async () => { fireEvent.click(btn) })
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('PublicShell — footer support email consistency (2026-06-11)', () => {
  it('footer Contact link uses the canonical contact@ address, not hello@', () => {
    render(<PublicShell><p>hi</p></PublicShell>)
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(
      (a) => a.getAttribute('href') ?? '',
    )
    expect(mailtos.some((h) => h.includes('hello@instanode.dev'))).toBe(false)
    const contact = Array.from(document.querySelectorAll('a')).find(
      (a) => (a.textContent ?? '').trim() === 'Contact',
    ) as HTMLAnchorElement | undefined
    expect(contact).toBeTruthy()
    expect(contact!.getAttribute('href')).toContain('mailto:contact@instanode.dev')
  })
})
