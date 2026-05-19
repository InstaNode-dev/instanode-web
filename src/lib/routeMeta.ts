/* routeMeta.ts — per-route document <title> for client-side SPA navigation.
 *
 * The build-time prerender (scripts/prerender.mjs) writes the correct
 * <title> into the first-byte HTML of each public route. But once React
 * Router takes over, a soft navigation (clicking a nav link) does NOT
 * change document.title — so a screen-reader user hears the same title on
 * every page (WCAG 2.4.2 "Page Titled" fail) and the browser tab/history
 * shows a stale name.
 *
 * RouteTracker imports `titleForPath` and sets document.title on every
 * location change. The static-route titles here are kept consistent with
 * scripts/prerender.mjs's ROUTE_META. Detail pages (/blog/:slug,
 * /use-cases/:slug) and the auth-gated /app/* subtree are handled by the
 * prefix fallbacks below — the client doesn't have the frontmatter title
 * at navigation time, so a sensible section title is used.
 */

const SUFFIX = ' · instanode'
const DEFAULT_TITLE = 'instanode · Real infrastructure for AI agents'

// Exact-match titles for the static public routes.
const EXACT_TITLES: Record<string, string> = {
  '/': DEFAULT_TITLE,
  '/pricing': `Pricing${SUFFIX}`,
  '/for-agents': `For agents${SUFFIX}`,
  '/status': `Status${SUFFIX}`,
  '/incidents': `Incidents${SUFFIX}`,
  '/docs': `Documentation${SUFFIX}`,
  '/blog': `Blog${SUFFIX}`,
  '/use-cases': `Use cases${SUFFIX}`,
  '/changelog': `Changelog${SUFFIX}`,
  '/privacy': `Privacy${SUFFIX}`,
  '/terms': `Terms${SUFFIX}`,
  '/login': `Sign in${SUFFIX}`,
  '/claim': `Claim your resources${SUFFIX}`,
}

// Prefix fallbacks for dynamic / nested routes, longest-prefix-first.
const PREFIX_TITLES: Array<[string, string]> = [
  ['/blog/', `Blog${SUFFIX}`],
  ['/use-cases/', `Use cases${SUFFIX}`],
  ['/app/admin', `Admin${SUFFIX}`],
  ['/app/deployments', `Deployments${SUFFIX}`],
  ['/app/resources', `Resources${SUFFIX}`],
  ['/app/stacks', `Stacks${SUFFIX}`],
  ['/app/billing', `Billing${SUFFIX}`],
  ['/app/settings', `Settings${SUFFIX}`],
  ['/app/team', `Team${SUFFIX}`],
  ['/app/vault', `Vault${SUFFIX}`],
  ['/app/checkout', `Checkout${SUFFIX}`],
  ['/app', `Dashboard${SUFFIX}`],
]

/** titleForPath — resolve the document.title for a pathname. Exact matches
 * win; otherwise the longest matching prefix; otherwise the default. */
export function titleForPath(pathname: string): string {
  const p = pathname || '/'
  if (EXACT_TITLES[p]) return EXACT_TITLES[p]
  for (const [prefix, title] of PREFIX_TITLES) {
    if (p === prefix || p.startsWith(prefix)) return title
  }
  return DEFAULT_TITLE
}
