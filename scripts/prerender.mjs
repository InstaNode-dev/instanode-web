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
 *
 * Additional artifacts emitted at dist/ root:
 *   - llms.txt, llms-full.txt — LLM-oriented content manifest + dump
 *   - sitemap.xml — every public URL (HTML + .md mirrors) for crawler
 *     discovery; auth-gated routes excluded
 *   - robots.txt — allow all, disallow auth-gated paths, point at sitemap
 */

import { build } from 'vite'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
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
    '/docs',
    '/blog',
    '/use-cases',
    ...blogSlugs.map((s) => `/blog/${s}`),
    ...useCaseSlugs.map((s) => `/use-cases/${s}`),
  ]
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
    const rendered = template.replace('<div id="root"></div>', `<div id="root">${html}</div>`)
    const outPath = routeToFile(route)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rendered, 'utf-8')
    written++
  }

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

  // Step 8: emit sitemap.xml + robots.txt at the dist root so Google,
  // Bing, and generative-engine crawlers (Perplexity, ChatGPT search)
  // can discover every public URL — both the HTML routes and their
  // .md mirrors. See writeSitemapAndRobots() for the per-route
  // <changefreq> policy and the auth-gated route skip list.
  const sitemapUrlCount = await writeSitemapAndRobots(routes, mdRoutes)
  console.log(`prerender: wrote sitemap.xml (${sitemapUrlCount} URLs) + robots.txt`)

  // Step 9: clean up the SSR bundle — it's only needed during this script.
  // Leaving it in dist-ssr would inflate the GH Pages upload by ~400 KB.
  await rm(SSR_DIST, { recursive: true, force: true })

  console.log(`prerender: ${written} files written. SEO-ready.`)
}

/* SITE_ORIGIN — base URL for every <loc> in sitemap.xml. No trailing slash;
 * route paths already start with '/'. Kept as a const so swapping to a
 * preview origin during testing is a one-line change. */
const SITE_ORIGIN = 'https://instanode.dev'

/* AUTH_GATED_PREFIXES — routes excluded from sitemap.xml AND disallowed in
 * robots.txt. These pages render only behind a logged-in session and have
 * zero crawler value. Even if a crawler stumbled onto one, it would index
 * the empty SPA shell. Keep this list in lockstep with the App.tsx auth
 * guards. */
const AUTH_GATED_PREFIXES = ['/app/', '/login', '/claim']

/* isAuthGated — returns true if `route` is auth-gated and should be
 * excluded from sitemap.xml. Matches by prefix because /app/* has many
 * dynamic children. /login and /claim are exact-match-or-suffix to also
 * catch /login?next=foo (the bare path is what ends up in the sitemap
 * though — query strings are stripped upstream). */
function isAuthGated(route) {
  return AUTH_GATED_PREFIXES.some((p) =>
    p.endsWith('/') ? route.startsWith(p) : route === p || route.startsWith(p + '/'),
  )
}

/* changefreqFor — pick a sensible <changefreq> per route. Search engines
 * treat this as a hint, not a contract — pages that change more often get
 * recrawled sooner. Policy:
 *   - /blog and /use-cases (index pages): daily — new entries appear here
 *   - /blog/:slug, /use-cases/:slug (detail pages): weekly — occasional
 *     fix-ups, mostly stable
 *   - /pricing, /docs, /for-agents: monthly — copy is intentional and rare
 *   - /, /status, anything else: weekly — homepage updates with new posts;
 *     /status is mostly static but reflects incident state
 *
 * .md mirror routes inherit the same policy as their HTML counterparts:
 * /blog.md is `daily` (mirrors /blog), /pricing.md is `monthly`
 * (mirrors /pricing). The trailing `.md` is stripped before matching, and
 * the special root mirror `/index.md` is normalized to `/`. */
function changefreqFor(route) {
  // Normalize .md mirror back to its HTML equivalent for policy lookup.
  // /index.md → /, /pricing.md → /pricing, /blog/foo.md → /blog/foo.
  let key = route
  if (key === '/index.md') key = '/'
  else if (key.endsWith('.md')) key = key.slice(0, -3)

  if (key === '/blog' || key === '/use-cases') return 'daily'
  if (key.startsWith('/blog/') || key.startsWith('/use-cases/')) return 'weekly'
  if (key === '/pricing' || key === '/docs' || key === '/for-agents') return 'monthly'
  return 'weekly'
}

/* writeSitemapAndRobots — emit dist/sitemap.xml and dist/robots.txt.
 *
 *   routes:   the HTML route list from loadRoutes() (e.g. '/blog/foo')
 *   mdRoutes: the .md mirror list from emitMarkdownRoutes()
 *             (e.g. {route: '/blog/foo.md', ...})
 *
 * Returns the total URL count written into sitemap.xml so the caller can
 * log it. Both files live at the dist root; GH Pages / Vite preview serve
 * them as-is at /sitemap.xml and /robots.txt. */
async function writeSitemapAndRobots(routes, mdRoutes) {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD per ISO 8601

  // Build the URL set: every HTML route + every .md mirror, minus
  // auth-gated paths. Deduped via a Set so the order is preserved and a
  // route appearing in both lists (shouldn't happen, but cheap insurance)
  // only emits once.
  const seen = new Set()
  const entries = []
  const addEntry = (route) => {
    if (isAuthGated(route)) return
    if (seen.has(route)) return
    seen.add(route)
    entries.push({ route, changefreq: changefreqFor(route) })
  }
  for (const r of routes) addEntry(r)
  for (const { route } of mdRoutes) addEntry(route)

  // XML body. Each <loc> is SITE_ORIGIN + route — no trailing slash.
  // Stable ordering means the file is diffable across builds.
  const xmlEntries = entries
    .map(({ route, changefreq }) => {
      const loc = `${SITE_ORIGIN}${route}`
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n  </url>`
    })
    .join('\n')

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${xmlEntries}\n` +
    `</urlset>\n`

  await writeFile(resolve(DIST, 'sitemap.xml'), sitemap, 'utf-8')

  // robots.txt — allow everything that isn't auth-gated, then point at
  // the sitemap. Disallow entries match the AUTH_GATED_PREFIXES list so
  // the two stay in sync.
  const robots =
    `User-agent: *\n` +
    `Allow: /\n` +
    AUTH_GATED_PREFIXES.map((p) => `Disallow: ${p}`).join('\n') +
    `\n\n` +
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml\n`

  await writeFile(resolve(DIST, 'robots.txt'), robots, 'utf-8')

  return entries.length
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
