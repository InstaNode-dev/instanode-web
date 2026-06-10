/* prerender.mjs — post-build SSG step.
 *
 * SPAs serve an empty <div id="root"></div> as the initial HTML and rely on
 * the browser to mount React and render content. That makes them unindexable
 * by search crawlers (Google, Bing) and generative-engine crawlers (Perplexity,
 * ChatGPT search, You.com) that do not execute JS or that downrank content
 * not present in the first byte.
 *
 * This script fixes that for every public route. It runs AFTER `vite build`:
 *
 *   1. Builds an SSR-compatible bundle from src/entry-server.tsx via Vite's
 *      built-in `--ssr` mode (so TypeScript + JSX + import resolution
 *      "just work" without a separate ts-node setup).
 *   2. Imports the bundle's `render(url)` function.
 *   3. For each route in PRERENDER_ROUTES (static routes + every blog post
 *      slug enumerated from src/content/posts.ts at build time), invokes
 *      render() to produce the HTML string for that page.
 *   4. Splices the HTML into the dist/index.html template at the
 *      <div id="root"></div> placeholder.
 *   5. Writes the result to dist/<route>/index.html. GitHub Pages serves
 *      that file when a crawler requests https://instanode.dev/blog/foo.
 *
 * Auth-gated routes (/app/*, /login*, /claim) are NOT pre-rendered — they
 * have no SEO value and rendering them in Node would crash on localStorage
 * access. The existing dist/index.html SPA fallback covers them.
 */

import { build } from 'vite'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')
const SSR_DIST = resolve(ROOT, 'dist-ssr')

/** PRERENDER_ROUTES — every URL that should ship as a static HTML file.
 *
 * Keep this list in sync with the public routes in App.tsx. /blog/:slug
 * entries are derived from POSTS at build time so adding a post = no
 * change to this file.
 *
 * Auth-gated and dynamic-only routes (/app/*, /login, /claim) are
 * intentionally absent; they require client-only APIs (localStorage) and
 * have no crawler value. */
async function loadRoutes() {
  // Slugs come from .content/blog/<slug>.md filenames. fetch-content.mjs
  // populates .content/ from InstaNode-dev/content before prerender runs
  // (via the `prebuild` script in package.json). Adding a post in the
  // content repo automatically expands the prerender route list — no
  // change needed here.
  const blogDir = resolve(ROOT, '.content/blog')
  const blogSlugs = existsSync(blogDir)
    ? readdirSync(blogDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    : []

  const useCaseDir = resolve(ROOT, '.content/use-cases')
  const useCaseSlugs = existsSync(useCaseDir)
    ? readdirSync(useCaseDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    : []

  return [
    '/',
    '/pricing',
    '/for-agents',
    '/status',
    '/incidents',
    '/docs',
    '/blog',
    '/use-cases',
    // W12 B4: /changelog ships as a real pre-rendered HTML so crawlers
    // and a procurement reviewer pasting the URL into a browser both
    // see the actual entries on first byte.
    '/changelog',
    // W12 H15: privacy / terms ship as pre-rendered placeholder pages so
    // the marketing footer links don't 404 for crawlers or direct hits.
    '/privacy',
    '/terms',
    // B1-P1 (2026-05-20): /security replaces the footer's previous link
    // to the raw /docs/public/security.md file (which GH Pages served as
    // text/markdown — visitors saw unrendered source). Pre-rendered so
    // a procurement reviewer pasting the URL sees real content on byte 1.
    '/security',
    ...blogSlugs.map((s) => `/blog/${s}`),
    ...useCaseSlugs.map((s) => `/use-cases/${s}`),
  ]
}

const SITE_ORIGIN = 'https://instanode.dev'
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/apple-touch-icon.png`

/** ROUTE_META — per-route <head> overrides. Without this every pre-rendered
 * subpage shipped the homepage <title> + canonical (self-canonicalizing to
 * https://instanode.dev/), so Google could drop /pricing, /docs, /blog from
 * the index, and SPA navigation never updated the document title (WCAG
 * 2.4.2). Blog-post and use-case detail pages are NOT listed here — their
 * title/description come from each file's frontmatter (see metaForRoute). */
const ROUTE_META = {
  '/': {
    title: 'instanode · Real infrastructure for AI agents',
    description:
      'Zero-setup infrastructure for AI agents. Provision real Postgres, Redis, MongoDB, queues, storage, and deployed apps with a single HTTP call. No account, no Docker, no configuration.',
  },
  '/pricing': {
    title: 'Pricing · instanode',
    description:
      'Simple pricing for instanode. Anonymous tier free with a 24h TTL; Hobby $9/mo and Pro $49/mo for everything an AI agent needs to ship a working app — database, cache, queue, storage, and deployment.',
  },
  '/for-agents': {
    title: 'For agents · instanode',
    description:
      'How AI coding agents use instanode: a single HTTP call provisions real Postgres, Redis, MongoDB, queues, storage, and deployments — no account, no MCP install required.',
  },
  '/status': {
    title: 'Status · instanode',
    description: 'Live operational status for the instanode platform and its provisioning services.',
  },
  '/incidents': {
    title: 'Incidents · instanode',
    description: 'Incident history and post-mortems for the instanode platform.',
  },
  '/docs': {
    title: 'Documentation · instanode',
    description:
      'instanode API documentation — provision databases, caches, queues, storage, and deploy applications. Every curl example works against https://api.instanode.dev as-is.',
  },
  '/blog': {
    title: 'Blog · instanode',
    description:
      'Build notes, retrospectives, and engineering writing on what "frictionless for AI agents" actually means.',
  },
  '/use-cases': {
    title: 'Use cases · instanode',
    description:
      'Real scenarios where AI agents provision and deploy with instanode — each with a paste-ready prompt any LLM can act on.',
  },
  '/changelog': {
    title: 'Changelog · instanode',
    description: 'What shipped, and when — the running changelog for the instanode platform.',
  },
  '/privacy': {
    title: 'Privacy · instanode',
    description: 'The instanode privacy policy.',
  },
  '/terms': {
    title: 'Terms · instanode',
    description: 'The instanode terms of service.',
  },
  '/security': {
    title: 'Security · instanode',
    description:
      'How to report a security vulnerability to instanode.dev, our PGP key, and our response SLA.',
  },
  // B1-P1 (2026-05-20): /404.html meta. Used by Step 4.7 below to set
  // the <title> + description on the 404 fallback file so a bogus URL
  // no longer ships the homepage <title>. The "/404" key isn't a real
  // SPA route — it's only consumed by metaForRoute() when the 404 emit
  // calls rewriteHead(template, '/404', metaForRoute('/404')).
  '/404': {
    title: 'Not found · instanode',
    description:
      'The page you requested does not exist on instanode.dev. Try /pricing, /docs, or the homepage.',
  },
  // B1-P1 (2026-05-20): /login meta. Without this the prerendered
  // dist/login/index.html shipped with the homepage <title>; a visitor
  // pasted the /login URL into a tab and saw the homepage title.
  '/login': {
    title: 'Sign in · instanode',
    description: 'Sign in to your instanode dashboard.',
  },
  '/login/callback': {
    title: 'Signing in… · instanode',
    description: 'Completing authentication for instanode.dev.',
  },
  '/claim': {
    title: 'Claim resources · instanode',
    description:
      'Claim the anonymous resources your agent provisioned and convert them to a permanent team account.',
  },
  // /cli-auth — defensive redirect to /login?cli_session=<s> (App.tsx
  // CliAuthRedirect). Even though the visible time on this URL is a few
  // ms before the Navigate runs, the SPA shell still needs a meaningful
  // <title> so the tab strip doesn't briefly flash the homepage title.
  '/cli-auth': {
    title: 'Signing in CLI… · instanode',
    description: 'Completing CLI device-flow sign-in for instanode.dev.',
  },
  // /app is the dashboard SPA entry. Visitors who type instanode.dev/app
  // hit this shell before AuthGate runs; a meaningful title is friendlier
  // than the homepage title bleeding through.
  '/app': {
    title: 'Dashboard · instanode',
    description: 'instanode dashboard — manage resources, deployments, and billing.',
  },
  // UI-3 (2026-05-29): /app/checkout and /app/billing are external CTA
  // destinations (from /pricing "Start Pro", magic-link "manage billing",
  // and agent-clickable upsell links). Without pre-generated shells they
  // hit GH Pages' 404.html fallback and ship HTTP 404 even when the body
  // hydrates correctly — analytics noise + tab-strip title flash. Step
  // 4.6 emits dist/app/checkout/index.html and dist/app/billing/index.html
  // so external entries see HTTP 200.
  '/app/checkout': {
    title: 'Checkout · instanode',
    description: 'Complete your instanode plan upgrade.',
  },
  '/app/billing': {
    title: 'Billing · instanode',
    description: 'Manage your instanode subscription, payment method, and invoices.',
  },
}

/** escapeHtmlAttr — minimal escaping for text injected into an HTML
 * attribute value. Frontmatter titles/excerpts are author-controlled but
 * may legitimately contain quotes / ampersands. */
function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** metaForRoute — resolve the {title, description} for a route. Static
 * routes come from ROUTE_META; /blog/:slug and /use-cases/:slug detail
 * pages derive theirs from the content file's frontmatter. */
function metaForRoute(route) {
  if (ROUTE_META[route]) return ROUTE_META[route]

  const blogMatch = route.match(/^\/blog\/(.+)$/)
  if (blogMatch) {
    const src = resolve(ROOT, '.content/blog', `${blogMatch[1]}.md`)
    if (existsSync(src)) {
      const meta = parseFrontmatter(readFileSync(src, 'utf-8'))
      return {
        title: meta.title ? `${meta.title} · instanode blog` : ROUTE_META['/blog'].title,
        description: meta.excerpt || ROUTE_META['/blog'].description,
      }
    }
    return ROUTE_META['/blog']
  }

  const useCaseMatch = route.match(/^\/use-cases\/(.+)$/)
  if (useCaseMatch) {
    const src = resolve(ROOT, '.content/use-cases', `${useCaseMatch[1]}.md`)
    if (existsSync(src)) {
      const meta = parseFrontmatter(readFileSync(src, 'utf-8'))
      return {
        title: meta.title ? `${meta.title} · instanode use case` : ROUTE_META['/use-cases'].title,
        description: meta.scenario || meta.excerpt || ROUTE_META['/use-cases'].description,
      }
    }
    return ROUTE_META['/use-cases']
  }

  // Unknown route — fall back to the homepage meta rather than leaving the
  // stale template values.
  return ROUTE_META['/']
}

/** rewriteHead — replace the homepage-default <head> tags in the SPA
 * template with the route's own title / description / canonical / OG /
 * Twitter values. Each tag is matched by a stable signature and swapped in
 * place, so the rest of <head> (favicons, fonts, theme-color) is untouched. */
function rewriteHead(template, route, meta) {
  // B3-P1-10 (BugBash 2026-05-20): normalise canonical to the
  // trailing-slash variant. Previously /pricing canonicalized to
  // https://instanode.dev/pricing (no trailing slash) but every other
  // production surface (GH Pages serving, sitemap.xml, nav anchors)
  // ends up 301-redirecting that to /pricing/. The 301 hop confused
  // crawlers — Google occasionally indexed both variants and split
  // the link signal in half. Always emit the trailing-slash form
  // (mirroring routeToFile which writes dist/<path>/index.html) so the
  // canonical, the rendered file path, and the served URL all agree.
  const canonical = route === '/'
    ? `${SITE_ORIGIN}/`
    : `${SITE_ORIGIN}${route}/`
  const title = escapeHtmlAttr(meta.title)
  const desc = escapeHtmlAttr(meta.description)
  let html = template

  // <title>
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${title}</title>`,
  )
  // <meta name="description">
  html = html.replace(
    /<meta name="description" content="[\s\S]*?" \/>/,
    `<meta name="description" content="${desc}" />`,
  )
  // <link rel="canonical">
  html = html.replace(
    /<link rel="canonical" href="[\s\S]*?" \/>/,
    `<link rel="canonical" href="${canonical}" />`,
  )
  // Open Graph
  html = html.replace(
    /<meta property="og:title" content="[\s\S]*?" \/>/,
    `<meta property="og:title" content="${title}" />`,
  )
  html = html.replace(
    /<meta property="og:description" content="[\s\S]*?" \/>/,
    `<meta property="og:description" content="${desc}" />`,
  )
  html = html.replace(
    /<meta property="og:url" content="[\s\S]*?" \/>/,
    `<meta property="og:url" content="${canonical}" />`,
  )
  html = html.replace(
    /<meta property="og:image" content="[\s\S]*?" \/>/,
    `<meta property="og:image" content="${DEFAULT_OG_IMAGE}" />`,
  )
  // Twitter
  html = html.replace(
    /<meta name="twitter:title" content="[\s\S]*?" \/>/,
    `<meta name="twitter:title" content="${title}" />`,
  )
  html = html.replace(
    /<meta name="twitter:description" content="[\s\S]*?" \/>/,
    `<meta name="twitter:description" content="${desc}" />`,
  )
  return html
}

/** routeToFile — map a URL to its on-disk index.html path under dist/.
 *
 *   /              → dist/index.html (already written by vite, will overwrite)
 *   /pricing       → dist/pricing/index.html
 *   /blog/foo      → dist/blog/foo/index.html
 *
 * The trailing-slash convention matches what nginx/GH Pages serves when a
 * URL has no extension — request /pricing, get /pricing/index.html. */
function routeToFile(route) {
  if (route === '/') return resolve(DIST, 'index.html')
  return resolve(DIST, route.replace(/^\//, ''), 'index.html')
}

async function main() {
  // Step 1: build the SSR bundle. Output lives at dist-ssr/entry-server.js.
  // We pass `configFile: false` to skip the project's vite.config.ts (no
  // dev-server proxy needed here) and inline the SSR settings.
  console.log('prerender: building SSR bundle…')
  await build({
    configFile: false,
    root: ROOT,
    build: {
      ssr: 'src/entry-server.tsx',
      outDir: 'dist-ssr',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(ROOT, 'src/entry-server.tsx'),
        output: { entryFileNames: 'entry-server.mjs' },
      },
    },
    plugins: [
      // react() is needed so the SSR bundle can resolve .tsx files.
      (await import('@vitejs/plugin-react')).default(),
    ],
    logLevel: 'warn',
  })

  // Step 2: dynamic import the freshly built module.
  const ssrPath = resolve(SSR_DIST, 'entry-server.mjs')
  const { render } = await import(ssrPath)

  // Step 3: read the SPA template that vite build already produced.
  // We inject server-rendered HTML into its #root placeholder; CSS link,
  // JS bundle reference, asset hashing, and any meta tags are preserved.
  const template = await readFile(resolve(DIST, 'index.html'), 'utf-8')

  // Step 4: pre-render each known route.
  const routes = await loadRoutes()
  console.log(`prerender: writing ${routes.length} static HTML files…`)

  let written = 0
  for (const route of routes) {
    const html = render(route)
    // Per-route <head>: swap the homepage-default title / description /
    // canonical / OG / Twitter tags for this route's own values before
    // splicing in the SSR body. Without this every subpage self-
    // canonicalized to https://instanode.dev/ and shared one <title>.
    const head = rewriteHead(template, route, metaForRoute(route))
    const rendered = head.replace('<div id="root"></div>', `<div id="root">${html}</div>`)
    const outPath = routeToFile(route)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rendered, 'utf-8')
    written++
  }

  // Step 4.5: emit empty SPA shells for every authenticated /app/* entry.
  //
  // P3 founder persona caught instanode.dev/app returning 404 on 2026-05-13.
  // Cause: the GH Pages SPA pattern (cp dist/index.html dist/404.html)
  // serves 404.html with HTTP status 404 for any path that doesn't have a
  // matching file under dist/. For SEO routes (/pricing, /blog/...) we
  // emit dist/<route>/index.html via SSG above, which fixes the status to
  // 200 for crawlers. The /app/* tree is intentionally NOT SSG'd (it needs
  // localStorage, would crash in renderToString, and has no SEO value
  // anyway because it's auth-gated). But the entry path /app must still
  // return 200 so a customer who types instanode.dev/app into a browser
  // sees the SPA boot, not a 404 page.
  //
  // Fix: write the unrendered SPA template (the same one Vite emits as
  // dist/index.html before our prerender step overwrites it for the
  // homepage) to dist/app/index.html. The file has an empty
  // <div id="root"></div>; React Router mounts in the browser, sees URL
  // /app, runs through AuthGate, and either renders the overview or
  // redirects to /login. Status 200 either way.
  //
  // The dist/index.html template variable above still has the unrendered
  // SPA shell because we read it BEFORE the homepage was overwritten.
  // B1-P1 (2026-05-20): the /app shell now also gets per-route head
  // rewriting so the <title> tag says "Dashboard · instanode" rather
  // than the homepage title that the raw template carries.
  const appShellPath = resolve(DIST, 'app', 'index.html')
  await mkdir(dirname(appShellPath), { recursive: true })
  await writeFile(appShellPath, rewriteHead(template, '/app', metaForRoute('/app')), 'utf-8')
  console.log('prerender: wrote dist/app/index.html SPA shell (P3 fix)')

  // Step 4.6: emit SPA shells for the OAuth + magic-link entry paths.
  //
  // 2026-05-14: user reported GitHub OAuth login broken. Root cause: the
  // api side mints the JWT correctly and 302-redirects to
  // https://instanode.dev/login/callback?session_token=<jwt>. But the GH
  // Pages host had no file under dist/login/ — 404. The SPA shell never
  // boots, React Router never runs, LoginCallbackPage never stores the
  // session_token. Same break hits anyone who refreshes /login or visits
  // /claim from a magic-link email.
  //
  // Same logic as Step 4.5 above for /app: these routes need localStorage
  // (so they can't be SSR'd through render(route)) but they MUST return
  // 200 with the SPA shell so the client takes over and reads the query
  // string. Write the unrendered template to each.
  // B1-P1 (2026-05-20): the auth shells now also get per-route head
  // rewriting. The /login prerender used to ship the homepage <title>
  // ("instanode · Real infrastructure for AI agents") because we wrote
  // the raw template without invoking rewriteHead. A visitor opening
  // /login in a new tab saw the wrong title, breaking WCAG 2.4.2 and
  // confusing tab-strip navigation. metaForRoute() returns sensible
  // titles for /login, /login/callback, and /claim from ROUTE_META.
  // /cli-auth — defensive redirect emitted by App.tsx's CliAuthRedirect.
  // The api emits the canonical /login?cli_session=<id>, but /cli-auth
  // appears in the CLI test mock and any stale terminal scrollback /
  // chat transcript a user pastes. Without an entry under dist/cli-auth/,
  // GH Pages returns its 404 shell and the React Navigate never runs.
  // UI-3 (2026-05-29): add /app/checkout and /app/billing so external CTA
  // entry from /pricing → "Start Pro" or magic-link → "manage billing"
  // hits pre-generated dist/app/checkout/index.html and
  // dist/app/billing/index.html shells with HTTP 200 instead of the
  // GH Pages 404.html fallback (status code 404 even when the body
  // hydrates correctly via the catch-all SPA shell). The /app shell
  // already covers /app on its own (Step 4.5). Other /app/* deep links
  // remain on the 404-status fallback — they are not external CTA
  // destinations and aren't worth pre-generating.
  // DOG-42 (2026-05-29): extend to every /app/* page reachable from
  // authenticated nav so deep links / refresh / share / bookmark return
  // HTTP 200 instead of 404 (which the catch-all 404.html hydrates as
  // the right page anyway, but the 404 status confuses monitoring +
  // reader-mode tools + uptime checks).
  const authShellRoutes = [
    '/login', '/login/callback', '/claim', '/cli-auth',
    '/app', '/app/checkout', '/app/billing',
    '/app/dashboard', '/app/resources', '/app/deployments',
    '/app/team', '/app/settings', '/app/audit', '/app/vault',
  ]
  for (const route of authShellRoutes) {
    const p = resolve(DIST, route.replace(/^\//, ''), 'index.html')
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, rewriteHead(template, route, metaForRoute(route)), 'utf-8')
  }
  console.log(`prerender: wrote ${authShellRoutes.length} auth SPA shells`)

  // Step 4.7: emit dist/404.html.
  //
  // GH Pages serves this file (with HTTP 404 status) for every URL that
  // doesn't match a real file under dist/. There are two distinct
  // categories of "404" we have to satisfy with one file:
  //
  //   (a) Real unknown URLs — bogus paths, typos, retired routes.
  //       We want the visible body to actually say "not found" and
  //       point back to the homepage. The previous behaviour shipped
  //       the raw SPA template (empty <div id="root"></div>) so the
  //       browser hydrated and the catch-all React Route ran
  //       <Navigate to="/" replace />, silently dumping the visitor on
  //       the homepage with the original URL still in the bar.
  //
  //   (b) Authenticated /app/* deep links (bookmarks, magic-link
  //       redirects to /login/callback?t=..., shared links into a
  //       resource detail page). The SPA must still boot here so it
  //       can hydrate, read window.location, store the token, and
  //       navigate to the right place. The body content of 404.html
  //       doesn't block that — React Router will mount over whatever
  //       HTML is in <div id="root"> on hydration.
  //
  // Both categories are satisfied by pre-rendering the NotFoundPage
  // into 404.html via the SSR render() pipeline:
  //   - For (a), the visitor sees the 404 message before hydration and
  //     the same page after; the catch-all React route now also
  //     renders NotFoundPage (App.tsx), so SSR + CSR agree.
  //   - For (b), the SPA still boots — React Router sees the real URL,
  //     matches /login/callback or /app/foo, and renders the right
  //     component over whatever 404 HTML was in the root div.
  //
  // We render through the SSR pipeline with a path that's guaranteed
  // not to match any real route (`/__404__`) so StaticRouter falls
  // through to the catch-all <Route path="*"> → <NotFoundPage />.
  const notFoundHtml = render('/__404__')
  const notFoundHead = rewriteHead(template, '/404', metaForRoute('/404'))
  const notFoundBody = notFoundHead.replace(
    '<div id="root"></div>',
    `<div id="root">${notFoundHtml}</div>`,
  )
  await writeFile(resolve(DIST, '404.html'), notFoundBody, 'utf-8')
  console.log('prerender: wrote dist/404.html with rendered NotFoundPage')

  // Step 5: publish /llms.txt at the dist root. The llms.txt convention
  // (https://llmstxt.org) expects the file at the domain root.
  //
  // SOURCE PRECEDENCE (fixed 2026-06-10): prefer the committed, post-
  // fetch-content `public/llms.txt` over the raw `.content/llms.txt`. This
  // matters because scripts/fetch-content.mjs applies a `requireMarkers`
  // lock-step guard: when the content repo HEAD is missing a contract marker
  // documented ahead of its upstream landing, fetch-content PRESERVES the
  // committed `public/llms.txt` instead of reverting to the stale upstream.
  // The previous version of this step copied straight from `.content/llms.txt`,
  // bypassing that guard entirely — so the SERVED /llms.txt silently reverted
  // to upstream HEAD even though `public/llms.txt` (and llmsContract.test.ts)
  // carried the corrected contract. We now publish the guarded copy. Vite has
  // already copied `public/llms.txt` → `dist/llms.txt` during `vite build`
  // (this script runs after), so dist is the authoritative guarded copy; we
  // fall back to public/ then .content/ only if it's somehow absent.
  const llmsCandidates = [
    resolve(DIST, 'llms.txt'),       // vite-copied public/llms.txt (guarded)
    resolve(ROOT, 'public/llms.txt'),
    resolve(ROOT, '.content/llms.txt'),
  ]
  const llmsSource = llmsCandidates.find((p) => existsSync(p))
  let llmsBaseContent = ''
  if (llmsSource) {
    llmsBaseContent = await readFile(llmsSource, 'utf-8')
    await writeFile(resolve(DIST, 'llms.txt'), llmsBaseContent, 'utf-8')
    console.log(`prerender: published llms.txt to dist root (source: ${llmsSource.replace(ROOT + '/', '')})`)
  } else {
    console.warn('prerender: no llms.txt found in dist/public/.content, skipping')
  }

  // Step 6: emit .md mirror routes for every HTML page so LLMs and
  // crawlers can consume plain text without parsing HTML. URL convention:
  // /foo → /foo.md, /blog/foo → /blog/foo.md, / → /index.md.
  //
  // Sources:
  //   - Blog posts: copy .content/blog/<slug>.md verbatim
  //   - Use cases: copy .content/use-cases/<slug>.md verbatim
  //   - Docs page: concatenate all .content/docs/*.md (one page in HTML,
  //     so one combined markdown file at /docs.md)
  //   - Index pages (/blog.md, /use-cases.md): generated from filenames
  //   - React-only pages (/, /pricing, /for-agents, /status): copy
  //     authored .content/pages/<name>.md
  //
  // All emitted .md files are also concatenated into /llms-full.txt for
  // one-shot LLM consumption. Section separators use "---" + the path.
  console.log('prerender: emitting .md mirror routes…')
  const mdRoutes = await emitMarkdownRoutes()
  console.log(`prerender: wrote ${mdRoutes.length} .md files`)

  // Step 7: aggregate every .md into /llms-full.txt — a single file an
  // LLM can fetch once and have the entire site's content.
  await writeAggregate(mdRoutes)
  console.log('prerender: wrote llms-full.txt aggregate')

  // Step 7.5: generate sitemap.xml from the exact set of pre-rendered
  // routes. The previous static public/sitemap.xml was hand-maintained
  // and listed only 7 of ~130 URLs (no /incidents, /use-cases,
  // /changelog, /privacy, /terms, and none of the blog / use-case detail
  // pages) with a frozen lastmod. Deriving it from `routes` here means
  // adding a blog post or use-case in the content repo automatically
  // expands the sitemap with no manual edit.
  await writeSitemap(routes)
  console.log(`prerender: wrote sitemap.xml (${routes.length + 1} urls)`)

  // Step 7.6: B3-P1-7 (BugBash 2026-05-20) — emit an Atom feed for
  // /blog and a separate Atom feed for /changelog. Both surfaces have
  // a visible "Subscribe" CTA but no machine-readable feed before this:
  // /rss.xml, /feed.xml, /blog/rss.xml, /changelog/rss.xml all 404'd.
  // Atom (RFC 4287) over RSS 2.0 because the spec is stricter — most
  // feed readers prefer it for new sites and it avoids the well-known
  // RSS pubDate ambiguity. /blog/rss.xml + /changelog/rss.xml are the
  // canonical URLs (mirroring the GitHub /releases.atom convention).
  await writeBlogAtomFeed()
  await writeChangelogAtomFeed()
  console.log('prerender: wrote /blog/rss.xml + /changelog/rss.xml Atom feeds')

  // Step 8: clean up the SSR bundle — it's only needed during this script.
  // Leaving it in dist-ssr would inflate the GH Pages upload by ~400 KB.
  await rm(SSR_DIST, { recursive: true, force: true })

  console.log(`prerender: ${written} files written. SEO-ready.`)
}

/* emitMarkdownRoutes — writes the .md mirror for every HTML route.
 *
 * Returns an array of {route, path, content} for the aggregate step. */
async function emitMarkdownRoutes() {
  const out = []

  // Helper: write a .md file at a given route path.
  // route '/foo'   → dist/foo.md
  // route '/foo/bar' → dist/foo/bar.md
  // route '/'      → dist/index.md
  //
  // includeInAggregate (default true): whether the route's content is also
  // concatenated into /llms-full.txt. The per-section docs mirrors pass false
  // because their content already appears verbatim in the /docs.md
  // concatenated mirror — including them too would duplicate every docs
  // section in the one-shot aggregate.
  async function writeRouteMd(route, content, includeInAggregate = true) {
    const fileSubpath = route === '/' ? 'index.md' : route.replace(/^\//, '') + '.md'
    const outPath = resolve(DIST, fileSubpath)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, content, 'utf-8')
    if (includeInAggregate) {
      out.push({ route: route === '/' ? '/index.md' : route + '.md', content })
    }
  }

  // 1. React-only pages — read from .content/pages/<name>.md
  const reactPageMap = {
    '/': 'home.md',
    '/pricing': 'pricing.md',
    '/for-agents': 'for-agents.md',
    '/status': 'status.md',
  }
  for (const [route, filename] of Object.entries(reactPageMap)) {
    const src = resolve(ROOT, `.content/pages/${filename}`)
    if (!existsSync(src)) {
      console.warn(`  skip ${route}: no ${filename}`)
      continue
    }
    const text = await readFile(src, 'utf-8')
    await writeRouteMd(route, text)
  }

  // 2. Blog posts — copy verbatim
  const blogDir = resolve(ROOT, '.content/blog')
  const blogFiles = existsSync(blogDir)
    ? readdirSync(blogDir).filter((f) => f.endsWith('.md'))
    : []
  for (const f of blogFiles) {
    const slug = f.replace(/\.md$/, '')
    const text = await readFile(resolve(blogDir, f), 'utf-8')
    await writeRouteMd(`/blog/${slug}`, text)
  }

  // 3. /blog index — generated from blog post filenames + frontmatter
  if (blogFiles.length > 0) {
    const blogIndex = await buildBlogIndex(blogDir, blogFiles)
    await writeRouteMd('/blog', blogIndex)
  }

  // 4. Use cases — copy verbatim per file
  const useCaseDir = resolve(ROOT, '.content/use-cases')
  const useCaseFiles = existsSync(useCaseDir)
    ? readdirSync(useCaseDir).filter((f) => f.endsWith('.md'))
    : []
  for (const f of useCaseFiles) {
    const slug = f.replace(/\.md$/, '')
    const text = await readFile(resolve(useCaseDir, f), 'utf-8')
    await writeRouteMd(`/use-cases/${slug}`, text)
  }

  // 5. /use-cases index — generated, grouped by category
  if (useCaseFiles.length > 0) {
    const useCaseIndex = await buildUseCasesIndex(useCaseDir, useCaseFiles)
    await writeRouteMd('/use-cases', useCaseIndex)
  }

  // 6. /docs — concatenate all docs sections into one markdown page
  const docsDir = resolve(ROOT, '.content/docs')
  const docsFiles = existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    : []
  if (docsFiles.length > 0) {
    const docsPage = await buildDocsPage(docsDir, docsFiles)
    await writeRouteMd('/docs', docsPage)

    // 6b. Per-section .md mirrors — /docs/<slug>.md for every docs section.
    //
    // The /docs HTML page renders all sections under one route with anchor
    // ids equal to the source filename slug (buildDocsPage sets s.id =
    // filename, matching the `#troubleshooting-deploys` HTML anchor). The
    // /llms.txt agent contract links the section directly as
    // `/docs/<slug>.md` (e.g. the troubleshooting-deploys auto-debug guide).
    // Without these per-section mirrors that URL 404s — only /docs.md (the
    // concatenated mirror) and the legal /docs/public/*.md statics resolved.
    //
    // Each mirror is the standalone section: an H1 title (from frontmatter)
    // + the section body with its YAML frontmatter stripped. This mirrors the
    // blog/use-case per-slug .md pattern above so an agent can fetch ONE
    // section instead of the whole concatenated doc. GH Pages serves the
    // nested file directly (proven by the existing /docs/public/*.md statics).
    for (const f of docsFiles) {
      const slug = f.replace(/\.md$/, '')
      const src = await readFile(resolve(docsDir, f), 'utf-8')
      const meta = parseFrontmatter(src)
      const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
      const title = meta.title || slug
      // includeInAggregate=false: the content is already in /docs.md (the
      // concatenated mirror that IS in the aggregate).
      await writeRouteMd(`/docs/${slug}`, `# ${title}\n\n${body}\n`, false)
    }
  }

  return out
}

/* writeSitemap — emit dist/sitemap.xml covering every pre-rendered route
 * plus /llms.txt. Per-route priority/changefreq are derived from the path
 * shape; lastmod is the build date so the file is never stale. */
async function writeSitemap(routes) {
  const today = new Date().toISOString().slice(0, 10)

  function hints(route) {
    if (route === '/') return { priority: '1.0', changefreq: 'weekly' }
    if (route === '/pricing') return { priority: '0.9', changefreq: 'weekly' }
    if (route === '/status') return { priority: '0.6', changefreq: 'hourly' }
    if (route === '/changelog' || route === '/incidents')
      return { priority: '0.6', changefreq: 'weekly' }
    if (route === '/privacy' || route === '/terms')
      return { priority: '0.3', changefreq: 'yearly' }
    if (route.startsWith('/blog/') || route.startsWith('/use-cases/'))
      return { priority: '0.6', changefreq: 'monthly' }
    return { priority: '0.7', changefreq: 'weekly' }
  }

  // Every pre-rendered route + the llms.txt manifest. B3-P1-10 (BugBash
  // 2026-05-20): emit the trailing-slash variant so the sitemap matches
  // the canonical link emitted in rewriteHead (no 301 hop between
  // sitemap, canonical, and the actual served file).
  const entries = [
    ...routes.map((route) => ({
      loc: route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}/`,
      ...hints(route),
    })),
    { loc: `${SITE_ORIGIN}/llms.txt`, priority: '0.6', changefreq: 'monthly' },
  ]

  const body = entries
    .map(
      (e) =>
        `  <url>\n` +
        `    <loc>${e.loc}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${e.changefreq}</changefreq>\n` +
        `    <priority>${e.priority}</priority>\n` +
        `  </url>`,
    )
    .join('\n')

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${body}\n` +
    `</urlset>\n`

  await writeFile(resolve(DIST, 'sitemap.xml'), xml, 'utf-8')
}

/* writeBlogAtomFeed — emit dist/blog/rss.xml as an Atom 1.0 feed listing
 * every post from .content/blog/<slug>.md (frontmatter title + date +
 * author + excerpt). Sorted newest-first. The URL is /blog/rss.xml
 * (matching the "rss.xml" filename convention used by every major blog
 * platform) even though the payload is Atom — feed readers sniff the
 * format from the response body. Self-link points at the canonical
 * /blog/rss.xml so reader software can find updates. */
async function writeBlogAtomFeed() {
  const blogDir = resolve(ROOT, '.content/blog')
  if (!existsSync(blogDir)) return
  const files = readdirSync(blogDir).filter((f) => f.endsWith('.md'))
  if (files.length === 0) return

  const posts = []
  for (const f of files) {
    const src = await readFile(resolve(blogDir, f), 'utf-8')
    const meta = parseFrontmatter(src)
    if (!meta.title || !meta.date) continue
    posts.push({
      slug: f.replace(/\.md$/, ''),
      title: meta.title,
      date: meta.date,
      author: meta.author || 'instanode.dev',
      excerpt: meta.excerpt || '',
    })
  }
  posts.sort((a, b) => b.date.localeCompare(a.date))

  const updated = posts[0]?.date
    ? new Date(`${posts[0].date}T00:00:00Z`).toISOString()
    : new Date().toISOString()

  const entries = posts.map((p) => {
    const url = `${SITE_ORIGIN}/blog/${p.slug}`
    const ts = new Date(`${p.date}T00:00:00Z`).toISOString()
    return (
      `  <entry>\n` +
      `    <id>${url}</id>\n` +
      `    <title type="text">${escapeXmlText(p.title)}</title>\n` +
      `    <link href="${url}" />\n` +
      `    <updated>${ts}</updated>\n` +
      `    <published>${ts}</published>\n` +
      `    <author><name>${escapeXmlText(p.author)}</name></author>\n` +
      `    <summary type="text">${escapeXmlText(p.excerpt)}</summary>\n` +
      `  </entry>`
    )
  }).join('\n')

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <id>${SITE_ORIGIN}/blog/</id>\n` +
    `  <title>instanode blog</title>\n` +
    `  <subtitle>Build notes, retrospectives, and engineering writing.</subtitle>\n` +
    `  <link rel="self" href="${SITE_ORIGIN}/blog/rss.xml" />\n` +
    `  <link rel="alternate" type="text/html" href="${SITE_ORIGIN}/blog" />\n` +
    `  <updated>${updated}</updated>\n` +
    `  <author><name>instanode.dev</name></author>\n` +
    `${entries}\n` +
    `</feed>\n`

  const outPath = resolve(DIST, 'blog', 'rss.xml')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, xml, 'utf-8')
}

/* writeChangelogAtomFeed — emit /changelog/rss.xml from the
 * hardcoded ChangelogPage entries. Source duplicates the array
 * inlined in src/pages/ChangelogPage.tsx because the page renders in
 * the browser and prerender runs in Node — no shared loader yet.
 * If you add an entry to ChangelogPage.tsx, mirror it here. The
 * coupling is documented in CLAUDE.md (sister to plans.yaml). */
const CHANGELOG_ENTRIES = [
  {
    date: '2026-05-18',
    title: 'Marketing + dashboard hardening pass',
    summary:
      'Pricing grid corrected to four tier columns, mobile nav restored, per-page Helmet meta + canonical, sitemap.xml at build time, claim flow + billing checkout fixes.',
  },
  {
    date: '2026-05-17',
    title: 'Bug-hunt remediation — P0/P1 fixes',
    summary:
      'Hardened POST /claim against account-takeover, large-tarball ReadAll, vault:// redeploy re-resolve, NetworkPolicy egress, api+worker+provisioner auto-deploy.',
  },
  {
    date: '2026-05-16',
    title: 'Tier enforcement + billing resilience',
    summary:
      'Secret-bearing env values redacted, storage-quota revoke + auto-unsuspend, deploy/stack tier elevation, 15-minute Razorpay reconciler, dedicated Redis maxmemory cap.',
  },
  {
    date: '2026-05-15',
    title: 'Pro storage bump + annual pricing',
    summary:
      'Pro raised to 10 GB Postgres / 512 MB Redis / 5 GB Mongo. Annual billing for Hobby, Hobby Plus, Pro, Team. Free + Hobby Plus + Growth tiers reconciled across surfaces. Default env now development.',
  },
  {
    date: '2026-05-14',
    title: 'Trust + marketing accuracy pass (W12)',
    summary:
      'DPA + trust-residency align on SCCs Module Two. Subprocessor list expanded. Step-02 encryption claim narrowed. /changelog live as a real route. llms.txt calls out DO Spaces.',
  },
  {
    date: '2026-05-13',
    title: 'Hobby Plus tier + W11 dashboard honesty pass',
    summary:
      'Hobby Plus tier ($19/mo) shipped as triple-tier-pricing decoy. Agent error envelope standardised. security.md + DPA + subprocessor list at /docs/public/*. Per-tenant MinIO IAM.',
  },
  {
    date: '2026-05-12',
    title: 'DO Spaces production cutover + deploy wedge live',
    summary:
      'Object storage cut from in-cluster MinIO to DO Spaces. POST /deploy/new end-to-end. Idempotency-Key replay header. dashboard-api retired — agent API serves dashboard directly.',
  },
]
async function writeChangelogAtomFeed() {
  const sorted = [...CHANGELOG_ENTRIES].sort((a, b) => b.date.localeCompare(a.date))
  const updated = sorted[0]?.date
    ? new Date(`${sorted[0].date}T00:00:00Z`).toISOString()
    : new Date().toISOString()

  const entries = sorted.map((e) => {
    // Entry IDs use a tag: URI to give every entry a stable opaque
    // identifier independent of URL (we don't have per-entry permalinks
    // on the changelog page yet — they're all on /changelog).
    const id = `tag:instanode.dev,${e.date}:changelog-${e.date.replace(/-/g, '')}`
    const ts = new Date(`${e.date}T00:00:00Z`).toISOString()
    return (
      `  <entry>\n` +
      `    <id>${id}</id>\n` +
      `    <title type="text">${escapeXmlText(e.title)}</title>\n` +
      `    <link href="${SITE_ORIGIN}/changelog#${e.date}" />\n` +
      `    <updated>${ts}</updated>\n` +
      `    <published>${ts}</published>\n` +
      `    <summary type="text">${escapeXmlText(e.summary)}</summary>\n` +
      `  </entry>`
    )
  }).join('\n')

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <id>${SITE_ORIGIN}/changelog/</id>\n` +
    `  <title>instanode changelog</title>\n` +
    `  <subtitle>What changed on instanode — subprocessor adds, material posture changes.</subtitle>\n` +
    `  <link rel="self" href="${SITE_ORIGIN}/changelog/rss.xml" />\n` +
    `  <link rel="alternate" type="text/html" href="${SITE_ORIGIN}/changelog" />\n` +
    `  <updated>${updated}</updated>\n` +
    `  <author><name>instanode.dev</name></author>\n` +
    `${entries}\n` +
    `</feed>\n`

  const outPath = resolve(DIST, 'changelog', 'rss.xml')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, xml, 'utf-8')
}

/* escapeXmlText — minimal XML-character-data escape (NOT attribute
 * escape — that's escapeHtmlAttr above). Atom feed bodies use it for
 * <title>, <summary>, <name> text payloads where authors may legitimately
 * include & < >. */
function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/* writeAggregate — bundle every .md mirror into one llms-full.txt at
 * dist root. Each section is prefixed with a separator that includes
 * the URL path the section came from. */
async function writeAggregate(mdRoutes) {
  const header = `# instanode.dev — full text dump\n\n` +
    `This file is the concatenation of every .md route on instanode.dev.\n` +
    `For the per-route URLs and an LLM-oriented index, see\n` +
    `https://instanode.dev/llms.txt — that's the manifest pointing here.\n\n` +
    `Each section below is delimited by an HTTP-style header line\n` +
    `(\`URL: <path>\`) and a horizontal rule. There are ${mdRoutes.length} sections\n` +
    `in this file.\n\n`

  const sections = mdRoutes.map(({ route, content }) =>
    `\n\n---\nURL: ${route}\n---\n\n${content.trim()}\n`,
  )

  await writeFile(resolve(DIST, 'llms-full.txt'), header + sections.join(''), 'utf-8')
}

/* buildBlogIndex — emit a markdown index of every blog post: title,
 * date, excerpt, link to the .md detail. */
async function buildBlogIndex(dir, files) {
  const posts = []
  for (const f of files) {
    const src = await readFile(resolve(dir, f), 'utf-8')
    const meta = parseFrontmatter(src)
    if (!meta.title || !meta.date) continue
    posts.push({
      slug: f.replace(/\.md$/, ''),
      title: meta.title,
      date: meta.date,
      excerpt: meta.excerpt || '',
    })
  }
  posts.sort((a, b) => b.date.localeCompare(a.date))

  let out = `# Blog — instanode.dev\n\n`
  out += `> Build notes, retrospectives, and the occasional rant on what "frictionless for AI agents" actually means.\n\n`
  out += `## Posts\n\n`
  for (const p of posts) {
    out += `### [${p.title}](/blog/${p.slug}.md)\n\n`
    out += `*${p.date}*\n\n`
    if (p.excerpt) out += `${p.excerpt}\n\n`
  }
  return out
}

/* buildUseCasesIndex — emit a markdown catalogue of every use case
 * grouped by category, each linking to its .md detail page. */
async function buildUseCasesIndex(dir, files) {
  const cases = []
  for (const f of files) {
    const src = await readFile(resolve(dir, f), 'utf-8')
    const meta = parseFrontmatter(src)
    if (!meta.title || !meta.category) continue
    cases.push({
      slug: f.replace(/\.md$/, ''),
      title: meta.title,
      category: meta.category,
      scenario: meta.scenario || '',
    })
  }

  const grouped = new Map()
  for (const c of cases) {
    if (!grouped.has(c.category)) grouped.set(c.category, [])
    grouped.get(c.category).push(c)
  }
  const cats = Array.from(grouped.keys()).sort()

  let out = `# Use cases — instanode.dev\n\n`
  out += `> ${cases.length} unique scenarios across ${cats.length} archetypes. Each detail page includes a paste-ready prompt that any vanilla LLM (ChatGPT, Claude, Gemini) can act on with no MCP and no installation — point the LLM at https://instanode.dev/llms.txt for the API contract and it generates a runnable script.\n\n`
  for (const cat of cats) {
    out += `## ${cat}\n\n`
    const list = grouped.get(cat).sort((a, b) => a.title.localeCompare(b.title))
    for (const c of list) {
      out += `- [${c.title}](/use-cases/${c.slug}.md)`
      if (c.scenario) out += ` — ${c.scenario}`
      out += `\n`
    }
    out += `\n`
  }
  return out
}

/* buildDocsPage — concatenate all docs sections (ordered by frontmatter
 * 'order') into one markdown page mirroring the HTML /docs page. */
async function buildDocsPage(dir, files) {
  const sections = []
  for (const f of files) {
    const src = await readFile(resolve(dir, f), 'utf-8')
    const meta = parseFrontmatter(src)
    const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    sections.push({
      id: f.replace(/\.md$/, ''),
      title: meta.title || f,
      order: Number(meta.order) || 0,
      body: body.trim(),
    })
  }
  sections.sort((a, b) => a.order - b.order)

  let out = `# Documentation — instanode.dev\n\n`
  out += `> Everything you need to provision, deploy, and claim. Every curl below works against \`https://api.instanode.dev\` as-is.\n\n`
  for (const s of sections) {
    out += `## ${s.title}\n\n${s.body}\n\n`
  }
  return out
}

/* parseFrontmatter — tiny YAML subset for blog/use-case/docs headers.
 * Mirrors the runtime parsers in src/content/*.ts. */
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return {}
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key) meta[key] = value
  }
  return meta
}

main().catch((err) => {
  console.error('prerender failed:', err)
  process.exit(1)
})
