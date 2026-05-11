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
  // Read the posts module's source and pull slug strings out with a regex.
  // We deliberately do NOT import posts.ts here — that would need a TS
  // loader in Node. The SSR bundle handles TS for the render call; this
  // little parse only needs slugs.
  const src = await readFile(resolve(ROOT, 'src/content/posts.ts'), 'utf-8')
  const slugMatches = [...src.matchAll(/slug:\s*['"]([^'"]+)['"]/g)]
  const slugs = slugMatches.map((m) => m[1])
  return [
    '/',
    '/pricing',
    '/for-agents',
    '/status',
    '/docs',
    '/blog',
    ...slugs.map((s) => `/blog/${s}`),
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

  // Step 5: clean up the SSR bundle — it's only needed during this script.
  // Leaving it in dist-ssr would inflate the GH Pages upload by ~400 KB.
  await rm(SSR_DIST, { recursive: true, force: true })

  console.log(`prerender: ${written} files written. SEO-ready.`)
}

main().catch((err) => {
  console.error('prerender failed:', err)
  process.exit(1)
})
