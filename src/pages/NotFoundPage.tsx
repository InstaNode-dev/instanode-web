/* NotFoundPage — public /404 + every catch-all path on the SPA.
 *
 * Before this page existed, App.tsx's catch-all route was
 *   <Route path="*" element={<Navigate to="/" replace />} />
 * which silently swallowed every unknown URL and dumped the visitor on
 * the homepage. From the visitor's seat that looked like the page
 * loaded but a different one than the URL bar said, with no signal
 * about what went wrong. Worse, GitHub Pages served the homepage HTML
 * body but kept HTTP 404 status (because dist/404.html is GH Pages's
 * fallback file content), so external tools that inspected the status
 * code saw 404 while the rendered page looked like a successful home
 * load — the worst of both worlds.
 *
 * The fix is a real 404 page rendered both as the SPA catch-all route
 * AND pre-rendered into dist/404.html (see scripts/prerender.mjs Step
 * 4.7). Now the URL bar, the rendered content, and the HTTP status
 * code all agree: the requested resource doesn't exist.
 *
 * The page is intentionally lean — title, explainer, two suggested
 * destinations, no marketing chrome. Wraps PublicShell so the same
 * top nav + footer appear, giving a confused visitor a way back out.
 *
 * Title + meta description for SEO/SSG: handled by prerender.mjs's
 * ROUTE_META['/404'] entry. Crawlers indexing the 404 file see
 * "Not found · instanode" instead of the homepage title. */

import { PublicShell } from '../layout/PublicShell'

export function NotFoundPage() {
  return (
    <PublicShell>
      <NotFoundStyles />
      <section className="nf-wrap" aria-labelledby="nf-h">
        <div className="nf-inner">
          <span className="nf-eyebrow">404 · not found</span>
          <h1 id="nf-h" className="nf-h1">
            That page is not provisioned<span className="nf-dot">.</span>
          </h1>
          <p className="nf-sub">
            The URL <code className="nf-url">{currentPath()}</code> doesn't match any
            known route on instanode.dev. It may have been moved, retired, or
            mistyped.
          </p>
          <div className="nf-ctas">
            <a href="/" className="nf-cta nf-cta-primary">
              Back to homepage <span aria-hidden="true">→</span>
            </a>
            <a href="/docs" className="nf-cta nf-cta-secondary">
              Read the docs
            </a>
          </div>
          <p className="nf-help">
            Looking for something specific? Try{' '}
            <a href="/pricing">/pricing</a>, <a href="/use-cases">/use-cases</a>,{' '}
            <a href="/blog">/blog</a>, or <a href="/changelog">/changelog</a>.
          </p>
        </div>
      </section>
    </PublicShell>
  )
}

/* currentPath — read window.location.pathname when running in the
 * browser, fall back to a placeholder during SSG. The SSG path uses
 * StaticRouter with a fixed URL of "/404" (see entry-server.tsx and
 * prerender.mjs), so the server-rendered HTML shows "/404" — the
 * client overwrites with the real URL on first hydration. */
function currentPath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname || '/'
}

function NotFoundStyles() {
  return (
    <style>{`
      .nf-wrap {
        min-height: 60vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 96px 24px;
      }
      .nf-inner {
        max-width: 640px;
        text-align: center;
      }
      .nf-eyebrow {
        display: inline-block;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-dim, #888);
        padding: 4px 10px;
        border: 1px solid var(--border, #2a2a2a);
        border-radius: 999px;
        margin-bottom: 18px;
      }
      .nf-h1 {
        font-family: var(--font-display, inherit);
        font-size: clamp(36px, 6vw, 56px);
        line-height: 1.05;
        letter-spacing: -0.02em;
        margin: 0 0 16px;
        color: var(--text, #fff);
      }
      .nf-dot { color: var(--accent, #9b87f5); }
      .nf-sub {
        font-size: 16px;
        line-height: 1.55;
        color: var(--text-muted, #aaa);
        margin: 0 auto 28px;
        max-width: 480px;
      }
      .nf-url {
        font-family: var(--font-mono);
        font-size: 13px;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--surface, #1a1a1a);
        border: 1px solid var(--border, #2a2a2a);
        color: var(--text, #fff);
      }
      .nf-ctas {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
        margin: 0 0 32px;
      }
      .nf-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 18px;
        border-radius: 8px;
        font-family: var(--font-display, inherit);
        font-size: 14px;
        text-decoration: none;
        transition: transform .15s ease, opacity .15s ease;
      }
      .nf-cta:hover { transform: translateY(-1px); }
      .nf-cta-primary {
        background: var(--accent, #9b87f5);
        color: var(--ink, #0b0b12);
        border: 1px solid var(--accent, #9b87f5);
      }
      .nf-cta-secondary {
        background: transparent;
        color: var(--text, #fff);
        border: 1px solid var(--border, #2a2a2a);
      }
      .nf-help {
        font-size: 14px;
        color: var(--text-dim, #888);
        margin: 0;
      }
      .nf-help a {
        color: var(--text, #fff);
        text-decoration: underline;
        text-decoration-color: var(--text-dim, #555);
        text-underline-offset: 3px;
      }
    `}</style>
  )
}
