/* PublicShell — chrome for public marketing pages (pricing, for-agents, etc.).
   Distinct from AppShell (authenticated app). Renders a glassmorphic sticky
   top nav and a minimal footer. Wraps page content via the `children` prop;
   App.tsx will eventually wire routes to PublicShell-wrapped pages.

   Wave 3 (2026-05-21):
   - Mobile hamburger nav: below 760px the nav-links collapse into a
     hamburger button that toggles a dropdown panel. Was previously
     `display: none` outright — leaving mobile visitors with no
     navigation at all on /pricing, /docs, /for-agents, etc.
   - Dark-mode toggle (B3-P2-4): the design IS dark by default, and the
     CSS already has a `prefers-color-scheme: dark` aware base — but
     readers who deliberately want light mode (printing, low-light
     hostility to dark UIs, accessibility preferences) had no way to
     override. The toggle persists to localStorage and applies a
     `data-theme="light"` attribute on <html> that flips token variables
     in tokens.css. Default = system preference, override = persisted.
     SSR-safe: the toggle button mounts only after hydration so the
     prerendered HTML matches the SSR output exactly.
*/

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Brand } from '../components/Common'
import { PUBLIC_NAV_LINKS } from '../components/MarketingNav'

// B1-P0-1 (2026-05-20): NAV_LINKS used to be a 6-item array defined here
// — Pricing/Use cases/For agents/Docs/Blog/Status — while MarketingPage
// rendered its own inline list — Pricing/For agents/Docs/Blog/Changelog.
// A visitor navigating between surfaces saw the nav reorder underneath
// them (the SSR'd homepage said "Changelog", every other public page said
// "Use cases" + "Status"). Both surfaces now import PUBLIC_NAV_LINKS from
// the shared MarketingNav module so adding/removing a route = one edit.
const NAV_LINKS = PUBLIC_NAV_LINKS

const THEME_STORAGE_KEY = 'instant.theme'
type ThemePref = 'light' | 'dark' | 'system'

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <PublicShellStyles />
      {/* a11y skip-link — first focusable element on every PublicShell-
          wrapped page (Pricing/Docs/Blog/Changelog/etc). Hidden until
          focused; jumps screen-reader / keyboard users straight to
          <main>. WCAG 2.4.1 Bypass Blocks. */}
      <a href="#main-content" className="public-skip-link">Skip to main content</a>
      <PublicNav />
      <main id="main-content" className="public-main">{children}</main>
      <PublicFooter />
    </div>
  )
}

function PublicNav() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Close mobile menu on Esc, and reset state if viewport widens past mobile.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile()
    }
    const onResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth > 760) closeMobile()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [mobileOpen, closeMobile])

  return (
    <header className="public-nav" role="banner">
      <div className="public-nav-inner">
        <a href="/" className="public-nav-brand" aria-label="instanode.dev — home">
          <Brand />
        </a>

        <nav className="public-nav-links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="public-nav-link">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="public-nav-cta">
          <ThemeToggle />
          <a href="/login" className="public-nav-link public-nav-link--muted public-nav-link--desktop">
            Sign in
          </a>
          <a href="/login" className="public-cta-pill public-cta-pill--desktop">
            Get token <span aria-hidden="true">→</span>
          </a>
          <button
            type="button"
            className="public-nav-hamburger"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            aria-controls="public-mobile-menu"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </button>
        </div>
      </div>

      {/* Mobile menu panel. Always rendered (SSR-stable); display flips via
          .open class so transition timing is preserved. */}
      <div
        id="public-mobile-menu"
        className={`public-nav-mobile ${mobileOpen ? 'open' : ''}`}
        aria-hidden={!mobileOpen}
      >
        <nav aria-label="Mobile primary">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="public-nav-mobile-link" onClick={closeMobile}>
              {l.label}
            </a>
          ))}
          <a href="/login" className="public-nav-mobile-link public-nav-mobile-link--muted" onClick={closeMobile}>
            Sign in
          </a>
          <a href="/login" className="public-nav-mobile-cta" onClick={closeMobile}>
            Get token <span aria-hidden="true">→</span>
          </a>
        </nav>
      </div>
    </header>
  )
}

/* ThemeToggle — manual override for prefers-color-scheme.
 * SSR-safe: renders an empty placeholder on the server (mounted=false),
 * then flips to the real button on first client render. Avoids
 * hydration mismatch and prevents the prerendered HTML from baking in
 * a stale theme. */
function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const [pref, setPref] = useState<ThemePref>('system')

  useEffect(() => {
    setMounted(true)
    try {
      const stored = typeof window !== 'undefined'
        ? window.localStorage.getItem(THEME_STORAGE_KEY)
        : null
      if (stored === 'light' || stored === 'dark') setPref(stored)
    } catch { /* private mode — keep system default */ }
  }, [])

  const apply = useCallback((next: ThemePref) => {
    setPref(next)
    try {
      if (next === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY)
        document.documentElement.removeAttribute('data-theme')
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next)
        document.documentElement.setAttribute('data-theme', next)
      }
    } catch { /* non-fatal */ }
  }, [])

  // On mount, sync DOM with whatever was stored.
  useEffect(() => {
    if (!mounted) return
    if (pref === 'light' || pref === 'dark') {
      document.documentElement.setAttribute('data-theme', pref)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [mounted, pref])

  // Skip rendering on SSR / first paint to avoid hydration mismatch.
  // The placeholder reserves the same width as the rendered button so
  // there is no layout shift when it appears.
  if (!mounted) return <span className="theme-toggle-placeholder" aria-hidden="true" />

  // Three-state cycle: system → light → dark → system.
  const next: ThemePref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
  const label = pref === 'system' ? 'System theme (click to switch to light)'
    : pref === 'light' ? 'Light theme (click to switch to dark)'
    : 'Dark theme (click to switch to system)'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => apply(next)}
      aria-label={label}
      title={label}
    >
      {pref === 'light' ? (
        <SunIcon />
      ) : pref === 'dark' ? (
        <MoonIcon />
      ) : (
        <SystemIcon />
      )}
    </button>
  )
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.2 3.2l1 1M11.8 11.8l1 1M3.2 12.8l1-1M11.8 4.2l1-1" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7Z" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="9" rx="1.5" />
      <path d="M6 14h4M8 12v2" />
    </svg>
  )
}

function PublicFooter() {
  return (
    <footer className="public-footer" role="contentinfo">
      <div className="public-footer-inner">
        <div className="public-footer-brand">
          <Brand />
          <p className="public-footer-tag">Real infrastructure for AI agents.</p>
          <span className="public-status">
            <span className="public-status-dot" /> All systems · operational
          </span>
        </div>

        <div className="public-footer-cols">
          <div className="public-footer-col">
            <div className="public-footer-h">Product</div>
            <a href="/pricing">Pricing</a>
            <a href="/for-agents">For agents</a>
            <a href="/docs">Docs</a>
            <a href="https://api.instanode.dev/openapi.json">OpenAPI</a>
          </div>
          <div className="public-footer-col">
            <div className="public-footer-h">Legal</div>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            {/* B1-P1 (2026-05-20): /security renders security.md
                through the shared markdown pipeline. The previous
                link pointed at the raw .md file, which GH Pages
                served as text/markdown — a visitor saw unrendered
                "## Reporting a vulnerability" source. */}
            <a href="/security">Security</a>
            <a href="mailto:hello@instanode.dev">Contact</a>
          </div>
        </div>
      </div>
      <div className="public-footer-bottom">
        <span>© {new Date().getFullYear()} instanode.dev</span>
        <span className="public-footer-mono">built for agents · v0.7</span>
      </div>
    </footer>
  )
}

/* Inline styles — kept local to PublicShell so the public surface doesn't
   leak into the authenticated dashboard CSS. All values resolve from
   tokens.css; nothing hardcoded. */
function PublicShellStyles() {
  return (
    <style>{`
      /* skip-to-content — WCAG 2.4.1 Bypass Blocks. Hidden until
         keyboard focus, then drops in over the sticky nav. */
      .public-skip-link {
        position: absolute;
        top: -100px;
        left: 8px;
        z-index: 90;
        padding: 10px 16px;
        background: var(--accent);
        color: var(--ink);
        font-weight: 600;
        font-size: 13px;
        border-radius: 6px;
        text-decoration: none;
        transition: top 120ms ease-out;
      }
      .public-skip-link:focus,
      .public-skip-link:focus-visible {
        top: 8px;
        outline: 2px solid var(--text);
        outline-offset: 2px;
      }

      .public-shell {
        min-height: 100vh;
        display: flex; flex-direction: column;
        background:
          radial-gradient(ellipse 1100px 700px at 80% -200px, rgba(0,228,142,0.08), transparent 60%),
          radial-gradient(ellipse 900px 600px at -10% -100px, rgba(108,206,255,0.05), transparent 55%),
          var(--ink);
      }

      /* glassmorphic top nav */
      .public-nav {
        position: sticky; top: 0; z-index: 80;
        background: rgba(8,8,10,0.65);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border-bottom: 1px solid var(--border-soft);
      }
      .public-nav-inner {
        max-width: 1240px; margin: 0 auto;
        padding: 14px 24px;
        display: flex; align-items: center; gap: 28px;
      }
      .public-nav-brand { display: inline-flex; align-items: center; }
      .public-nav-links {
        display: flex; gap: 22px; align-items: center;
        margin-left: 8px;
      }
      .public-nav-link {
        font-size: 13px;
        color: var(--text-dim);
        letter-spacing: -0.005em;
        transition: color 120ms;
      }
      .public-nav-link:hover { color: var(--text); }
      .public-nav-link--muted { font-size: 13px; }
      .public-nav-cta {
        margin-left: auto;
        display: flex; align-items: center; gap: 14px;
      }
      .public-cta-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: var(--accent);
        color: var(--ink);
        font-weight: 600;
        font-size: 13px;
        border-radius: 6px;
        box-shadow: 0 0 0 1px var(--accent-deep) inset, 0 8px 24px -8px var(--accent-glow);
        transition: background 150ms, transform 150ms;
      }
      .public-cta-pill:hover { background: #28edA0; transform: translateY(-1px); }

      /* hamburger button — hidden on desktop */
      .public-nav-hamburger {
        display: none;
        width: 36px; height: 36px;
        flex-direction: column; align-items: center; justify-content: center;
        gap: 4px;
        border: 1px solid var(--border-hi);
        border-radius: 6px;
        background: var(--ink);
        cursor: pointer;
        padding: 0;
        transition: border-color 120ms, background 120ms;
      }
      .public-nav-hamburger:hover { border-color: var(--accent); }
      .hamburger-bar {
        display: block;
        width: 16px; height: 1.5px;
        background: var(--text);
        border-radius: 2px;
      }

      /* theme toggle */
      .theme-toggle, .theme-toggle-placeholder {
        width: 32px; height: 32px;
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid var(--border-hi);
        background: var(--ink);
        color: var(--text-dim);
        border-radius: 6px;
        transition: color 120ms, border-color 120ms;
        flex-shrink: 0;
      }
      .theme-toggle:hover { color: var(--text); border-color: var(--accent); }

      /* mobile menu panel — display:none unless .open */
      .public-nav-mobile {
        display: none;
        background: rgba(8,8,10,0.95);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border-bottom: 1px solid var(--border-soft);
        padding: 12px 18px 18px;
      }
      .public-nav-mobile.open { display: block; }
      .public-nav-mobile nav { display: flex; flex-direction: column; gap: 2px; }
      .public-nav-mobile-link {
        padding: 11px 4px;
        font-size: 15px;
        color: var(--text);
        border-bottom: 1px solid var(--border-soft);
        letter-spacing: -0.005em;
      }
      .public-nav-mobile-link--muted { color: var(--text-dim); }
      .public-nav-mobile-cta {
        margin-top: 12px;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 16px;
        background: var(--accent);
        color: var(--ink);
        font-weight: 600;
        font-size: 14px;
        border-radius: 6px;
        align-self: flex-start;
        box-shadow: 0 0 0 1px var(--accent-deep) inset;
      }

      @media (max-width: 760px) {
        .public-nav-links { display: none; }
        .public-nav-inner { gap: 12px; padding: 12px 18px; }
        .public-nav-link--desktop { display: none; }
        .public-cta-pill--desktop { display: none; }
        .public-nav-hamburger { display: inline-flex; }
      }

      /* main content area */
      .public-main {
        flex: 1;
        max-width: 1240px;
        width: 100%;
        margin: 0 auto;
        padding: 64px 24px 96px;
      }
      @media (max-width: 760px) { .public-main { padding: 40px 18px 64px; } }

      /* footer */
      .public-footer {
        border-top: 1px solid var(--border-soft);
        background: var(--surface);
      }
      .public-footer-inner {
        max-width: 1240px; margin: 0 auto;
        padding: 48px 24px 24px;
        display: grid;
        grid-template-columns: 1.6fr 2fr;
        gap: 48px;
      }
      @media (max-width: 760px) {
        .public-footer-inner { grid-template-columns: 1fr; gap: 32px; padding: 32px 18px 20px; }
      }
      .public-footer-brand {
        display: flex; flex-direction: column; gap: 12px;
        max-width: 320px;
      }
      .public-footer-tag {
        font-size: 13px; color: var(--text-dim); line-height: 1.5;
      }
      .public-status {
        display: inline-flex; align-items: center; gap: 8px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--accent);
        padding: 4px 10px;
        background: rgba(0,228,142,0.06);
        border: 1px solid rgba(0,228,142,0.2);
        border-radius: 100px;
        width: max-content;
      }
      .public-status-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--accent);
        box-shadow: 0 0 6px var(--accent);
      }
      .public-footer-cols {
        display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
      }
      .public-footer-col { display: flex; flex-direction: column; gap: 8px; }
      .public-footer-col a {
        font-size: 13px;
        color: var(--text-dim);
        transition: color 120ms;
      }
      .public-footer-col a:hover { color: var(--text); }
      .public-footer-h {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--text-faint);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
      }
      .public-footer-bottom {
        max-width: 1240px; margin: 0 auto;
        padding: 16px 24px 32px;
        display: flex; align-items: center; justify-content: space-between;
        font-size: 12px; color: var(--text-faint);
        border-top: 1px solid var(--border-soft);
      }
      .public-footer-mono {
        font-family: var(--font-mono);
        font-size: 11px;
      }
      @media (max-width: 760px) {
        .public-footer-bottom { padding: 16px 18px 24px; flex-direction: column; gap: 6px; align-items: flex-start; }
      }

      /* shared marketing primitives */
      .public-eyebrow {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 14px;
        display: inline-block;
      }
      .public-h1 {
        font-family: var(--font-display);
        font-size: clamp(40px, 6vw, 72px);
        font-weight: 400;
        letter-spacing: -0.035em;
        line-height: 1;
        margin-bottom: 18px;
      }
      .public-h1 .dot { color: var(--accent); }
      .public-sub {
        font-size: clamp(15px, 1.6vw, 18px);
        color: var(--text-dim);
        line-height: 1.5;
        max-width: 640px;
      }
      .public-section { margin-top: 80px; }
      .public-section-h {
        font-family: var(--font-display);
        font-size: clamp(24px, 3vw, 32px);
        font-weight: 400;
        letter-spacing: -0.025em;
        margin-bottom: 6px;
      }
      .public-section-sub {
        font-size: 14px; color: var(--text-dim); margin-bottom: 28px;
      }

      /* code block — public variant */
      .public-code {
        background: var(--code-bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 16px 18px;
        font-family: var(--font-mono);
        font-size: 12.5px;
        line-height: 1.7;
        color: var(--text);
        overflow-x: auto;
        white-space: pre;
      }
      .public-code .c-comment { color: var(--text-faint); }
      .public-code .c-key     { color: var(--blue); }
      .public-code .c-str     { color: var(--accent); }
      .public-code .c-num     { color: var(--amber); }
      .public-code .c-bool    { color: var(--violet); }
      .public-code .c-flag    { color: var(--violet); }
    `}</style>
  )
}
