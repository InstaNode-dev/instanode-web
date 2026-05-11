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

  // Step 3b: build the route → metadata table once. Pulls frontmatter
  // from .content/blog/<slug>.md and .content/use-cases/<slug>.md so each
  // pre-rendered page gets its own <title>, og:title, og:description,
  // og:url, canonical, and twitter:* tags. The og:image stays on the
  // shared /og-default.png — per-post images can come later.
  const metaByRoute = await loadRouteMeta()

  // Step 4: pre-render each known route.
  const routes = await loadRoutes()
  console.log(`prerender: writing ${routes.length} static HTML files…`)

  let written = 0
  for (const route of routes) {
    const html = render(route)
    const meta = metaByRoute[route] || null
    const withMeta = meta ? applyRouteMeta(template, route, meta) : template
    const rendered = withMeta.replace('<div id="root"></div>', `<div id="root">${html}</div>`)
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

/* SEO defaults — the homepage / fallback OG card. The base
 * dist/index.html already points here; constants live in code so
 * applyRouteMeta can produce a fully replaced <head> for per-route
 * pages without re-stating these strings inline. */
const SITE_ORIGIN = 'https://instanode.dev'
const DEFAULT_DESCRIPTION =
  'Zero-setup infrastructure for AI agents. Provision real Postgres, Redis, MongoDB, queues, storage, and deployed apps with a single HTTP call.'

/* loadRouteMeta — build the route → {title, description, ogType} table
 * the prerender step uses to splice per-route meta tags into each
 * dist/<route>/index.html. Pulls frontmatter from .content/blog and
 * .content/use-cases; hard-codes the marketing pages.
 *
 * The og:image stays on /og-default.png across the site for now; per-post
 * images would need a generator that takes title + theme and stamps a
 * 1200x630 PNG. That's a future iteration — the default card is the
 * single biggest CTR win and the per-route title + description give
 * Slack/Discord/Twitter enough variation to feel curated. */
async function loadRouteMeta() {
  const meta = {}

  /* Marketing pages — keep titles tight and value-prop forward. Each
   * description is ~120-160 chars (Google truncates around 160). */
  meta['/'] = {
    title: 'instanode · Real infrastructure for AI agents',
    description: DEFAULT_DESCRIPTION,
    ogType: 'website',
  }
  meta['/pricing'] = {
    title: 'Pricing — instanode.dev',
    description:
      'Anonymous is free for 24 hours. Hobby is $9/mo, Pro is $49/mo, Team is $199/mo. Self-serve at every tier, no talk-to-sales.',
    ogType: 'website',
  }
  meta['/for-agents'] = {
    title: 'For AI agents — instanode.dev',
    description:
      'Why instanode.dev is designed for AI agents first: anonymous-first endpoints, single-HTTP-call provisioning, llms.txt, predictable JSON.',
    ogType: 'website',
  }
  meta['/status'] = {
    title: 'Status — instanode.dev',
    description:
      'Live operational status for instanode.dev. The same status is served as JSON at api.instanode.dev/api/v1/health for machine consumption.',
    ogType: 'website',
  }
  meta['/docs'] = {
    title: 'Documentation — instanode.dev',
    description:
      'Every curl works against api.instanode.dev as-is. Provision, claim, deploy, query — all from the command line, no account required.',
    ogType: 'website',
  }
  meta['/blog'] = {
    title: 'Blog — instanode.dev',
    description:
      'Build notes, retrospectives, and the occasional rant on what "frictionless for AI agents" actually means.',
    ogType: 'website',
  }
  meta['/use-cases'] = {
    title: 'Use cases — instanode.dev',
    description:
      'Real scenarios across hackathon, agentic, data, and platform workloads — each with a paste-ready prompt any vanilla LLM can execute.',
    ogType: 'website',
  }

  /* Blog posts — title + excerpt from frontmatter. og:type is
   * 'article' so Facebook/LinkedIn render publish dates and bylines. */
  const blogDir = resolve(ROOT, '.content/blog')
  const blogFiles = existsSync(blogDir)
    ? readdirSync(blogDir).filter((f) => f.endsWith('.md'))
    : []
  for (const f of blogFiles) {
    const src = await readFile(resolve(blogDir, f), 'utf-8')
    const fm = parseFrontmatter(src)
    const slug = f.replace(/\.md$/, '')
    const desc = fm.excerpt || firstParagraph(src) || DEFAULT_DESCRIPTION
    meta[`/blog/${slug}`] = {
      title: `${fm.title || slug} — instanode.dev`,
      description: clamp(desc, 200),
      ogType: 'article',
      publishedTime: fm.date || undefined,
      author: fm.author || undefined,
    }
  }

  /* Use cases — title + scenario from frontmatter. Falls back to the
   * first body paragraph if scenario is missing. */
  const useCaseDir = resolve(ROOT, '.content/use-cases')
  const useCaseFiles = existsSync(useCaseDir)
    ? readdirSync(useCaseDir).filter((f) => f.endsWith('.md'))
    : []
  for (const f of useCaseFiles) {
    const src = await readFile(resolve(useCaseDir, f), 'utf-8')
    const fm = parseFrontmatter(src)
    const slug = f.replace(/\.md$/, '')
    const desc = fm.scenario || firstParagraph(src) || DEFAULT_DESCRIPTION
    meta[`/use-cases/${slug}`] = {
      title: `${fm.title || slug} — instanode.dev`,
      description: clamp(desc, 200),
      ogType: 'article',
    }
  }

  return meta
}

/* applyRouteMeta — overwrite the homepage-default <title>, description,
 * og:*, twitter:*, and canonical tags with route-specific values.
 *
 * Strategy: targeted regex replacements against the canonical strings
 * emitted by index.html so the replacement is unambiguous and stable.
 * Adds article:published_time / article:author for blog posts so
 * Facebook/LinkedIn render a byline on the share card.
 *
 * Defensively HTML-escapes substituted text — a description with & or "
 * would otherwise produce malformed HTML.
 */
function applyRouteMeta(template, route, meta) {
  const url = route === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${route}`
  const title = htmlEscape(meta.title)
  const description = htmlEscape(meta.description)
  const ogType = meta.ogType || 'website'

  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${url}" />`,
    )
    .replace(
      /<meta property="og:type" content="[^"]*"\s*\/?>/,
      `<meta property="og:type" content="${ogType}" />`,
    )
    .replace(
      /<meta property="og:url" content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${url}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${title}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${description}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${title}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${description}" />`,
    )

  // Splice in article:published_time + article:author for blog posts.
  // Anchor: right after og:image:alt — a stable line in the base template.
  if (ogType === 'article' && (meta.publishedTime || meta.author)) {
    const extra = []
    if (meta.publishedTime) {
      extra.push(`<meta property="article:published_time" content="${htmlEscape(meta.publishedTime)}" />`)
    }
    if (meta.author) {
      extra.push(`<meta property="article:author" content="${htmlEscape(meta.author)}" />`)
    }
    html = html.replace(
      /(<meta property="og:image:alt" content="[^"]*"\s*\/?>)/,
      `$1\n    ${extra.join('\n    ')}`,
    )
  }

  return html
}

/* firstParagraph — strip frontmatter and pull the first non-heading
 * paragraph from a markdown source, useful as a description fallback
 * when a post has no excerpt. */
function firstParagraph(src) {
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  for (const block of body.split(/\r?\n\r?\n/)) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('>')) continue
    if (trimmed.startsWith('```')) continue
    return trimmed
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return ''
}

/* clamp — truncate at ~max chars on a word boundary, append an ellipsis.
 * Used to keep og:description under the ~200-char limit most platforms
 * impose without chopping mid-word. */
function clamp(s, max) {
  if (!s) return ''
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

/* htmlEscape — minimal escaping for substitution into HTML attributes.
 * The five XML-significant characters are enough; we never inject into
 * a script/style context where stricter rules apply. */
function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

main().catch((err) => {
  console.error('prerender failed:', err)
  process.exit(1)
})
