/* PublicShell — chrome for public marketing pages (pricing, for-agents, etc.).
   Distinct from AppShell (authenticated app). Renders a glassmorphic sticky
   top nav and a minimal footer. Wraps page content via the `children` prop;
   App.tsx will eventually wire routes to PublicShell-wrapped pages. */

import type { ReactNode } from 'react'
import { Brand } from '../components/Common'

const NAV_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/use-cases', label: 'Use cases' },
  { href: '/for-agents', label: 'For agents' },
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/status', label: 'Status' }
]

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <PublicShellStyles />
      <PublicNav />
      <main className="public-main">{children}</main>
      <PublicFooter />
    </div>
  )
}

function PublicNav() {
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
          <a href="/login" className="public-nav-link public-nav-link--muted">
            Sign in
          </a>
          <a href="/login" className="public-cta-pill">
            Get token <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </header>
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
            <a href="/docs/public/security.md">Security</a>
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
      @media (max-width: 760px) {
        .public-nav-links { display: none; }
        .public-nav-inner { gap: 12px; padding: 12px 18px; }
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
