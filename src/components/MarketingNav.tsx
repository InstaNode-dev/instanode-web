/* MarketingNav — single source of truth for the public-site top nav.
 *
 * Before this component existed, there were two distinct nav lists:
 *   - src/pages/MarketingPage.tsx (inline)  → Pricing/For agents/Docs/Blog/Changelog
 *   - src/layout/PublicShell.tsx (NAV_LINKS) → Pricing/Use cases/For agents/Docs/Blog/Status
 *
 * Result: B1-P0-1 — the SSR'd homepage HTML showed "Changelog" while
 * /pricing, /docs, /blog (rendered through PublicShell) showed
 * "Use cases" + "Status." A visitor navigating across surfaces saw the
 * nav reorder under them — a hydration-time mismatch that read as an SSR
 * bug. It wasn't an SSR bug; both surfaces are SSR'd correctly, they
 * just rendered different lists.
 *
 * The unified list below is the single contract every public surface
 * renders against. Adding/removing a public marketing page = one edit
 * here, and the change propagates to every page that mounts the shell
 * and the homepage simultaneously.
 *
 * The unified list intentionally drops `/status` from the nav (it stays
 * reachable via the footer-status pill) and keeps `/changelog` + adds
 * `/use-cases` so both surfaces agree.
 */

/** PUBLIC_NAV_LINKS — the canonical public marketing nav. The order here
 * is the order rendered. Both PublicShell and the MarketingPage inline
 * nav read from this exact array. Adding a route here will appear on
 * both surfaces on the next build with no further edits. */
export const PUBLIC_NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/use-cases', label: 'Use cases' },
  { href: '/for-agents', label: 'For agents' },
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/changelog', label: 'Changelog' },
]
