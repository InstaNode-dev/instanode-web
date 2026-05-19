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
  const canonical = route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}`
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
  const appShellPath = resolve(DIST, 'app', 'index.html')
  await mkdir(dirname(appShellPath), { recursive: true })
  await writeFile(appShellPath, template, 'utf-8')
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
  const authShellRoutes = ['/login', '/login/callback', '/claim']
  for (const route of authShellRoutes) {
    const p = resolve(DIST, route.replace(/^\//, ''), 'index.html')
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, template, 'utf-8')
  }
  console.log(`prerender: wrote ${authShellRoutes.length} auth SPA shells`)

  // Step 4.7: emit dist/404.html as the SPA shell so any unknown route
  // (bookmarks, shared links, search-engine deep links into auth-gated
  // pages, magic-link recipients clicking into a path we haven't enumerated)
  // boots the React app instead of seeing GH Pages's stock 404 page.
  //
  // GH Pages returns HTTP 404 with the body content of 404.html for any
  // unmatched path. Status code is suboptimal for crawlers, but the
  // browser renders the body anyway and the SPA hydrates against the
  // requested URL via window.location — so /login/callback?t=... works
  // even from a cold magic-link click.
  const notFoundPath = resolve(DIST, '404.html')
  await writeFile(notFoundPath, template, 'utf-8')
  console.log('prerender: wrote dist/404.html SPA fallback')

  // Step 5: copy /llms.txt from the content repo to dist root. The
  // llms.txt convention (https://llmstxt.org) expects the file at the
  // domain root.
  const llmsSource = resolve(ROOT, '.content/llms.txt')
  let llmsBaseContent = ''
  if (existsSync(llmsSource)) {
    llmsBaseContent = await readFile(llmsSource, 'utf-8')
    await writeFile(resolve(DIST, 'llms.txt'), llmsBaseContent, 'utf-8')
    console.log('prerender: copied llms.txt to dist root')
  } else {
    console.warn('prerender: no .content/llms.txt found, skipping')
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
  async function writeRouteMd(route, content) {
    const fileSubpath = route === '/' ? 'index.md' : route.replace(/^\//, '') + '.md'
    const outPath = resolve(DIST, fileSubpath)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, content, 'utf-8')
    out.push({ route: route === '/' ? '/index.md' : route + '.md', content })
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

  // Every pre-rendered route + the llms.txt manifest.
  const entries = [
    ...routes.map((route) => ({
      loc: route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}`,
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
