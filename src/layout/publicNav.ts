/* publicNav.ts — single source of truth for the public-marketing primary
 * nav.
 *
 * Why this exists: T18 P1-1 caught a "two-nav-shell drift" — the homepage
 * (MarketingPage.tsx) inlined its own nav (Pricing / For agents / Docs /
 * Blog / Changelog) while every other public page (pricing, docs, blog,
 * status, use-cases) used PublicShell, which renders a different set
 * (Pricing / Use cases / For agents / Docs / Blog / Status). A visitor
 * clicking homepage → pricing watched the nav reshuffle and lose Changelog
 * + gain Status / Use cases. Confusing IA, dead-ends users looking for
 * "Status" from the homepage and "Changelog" from sub-pages.
 *
 * Fix: both shells consume PUBLIC_NAV_LINKS. Adding or removing a public
 * surface from the nav is now a single-line edit that updates both
 * surfaces atomically.
 *
 * Coverage test (PublicNavSyncTest in MarketingPage.test.tsx) iterates
 * this constant and asserts both shells render every entry — so a future
 * inlined-nav regression in either shell trips the test.
 *
 * Each link points at a real route registered in App.tsx (and statically
 * pre-rendered by scripts/prerender.mjs). The `forAgents` entry uses the
 * dedicated /for-agents page rather than the homepage anchor; the
 * MarketingPage's earlier "#for-agents" anchor still scrolls to the same
 * content for visitors already on the homepage, but the nav itself routes
 * to the canonical page so the homepage no longer orphans /for-agents
 * from its primary nav (T18 P1-2).
 */

export type PublicNavLink = {
  /** Route path or absolute URL. Always points at a real, server-resolvable
   *  surface — never a same-page `#` anchor, so the link works identically
   *  on the homepage and on every sub-page. */
  href: string
  label: string
}

export const PUBLIC_NAV_LINKS: ReadonlyArray<PublicNavLink> = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/use-cases', label: 'Use cases' },
  { href: '/for-agents', label: 'For agents' },
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/status', label: 'Status' },
]
