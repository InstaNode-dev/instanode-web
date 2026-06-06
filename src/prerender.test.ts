/* prerender.test.ts — UI-3 regression guard for the SPA-fallback HTTP 404
 * bug on /app/checkout and /app/billing.
 *
 * GH Pages serves dist/404.html with HTTP 404 for every URL that doesn't
 * match a real file under dist/. Direct hits to /app/checkout?plan=...
 * (external CTA from /pricing → "Start Pro") therefore shipped HTTP 404
 * even though the SPA shell hydrated and CheckoutPage rendered correctly.
 *
 * Fix: prerender.mjs Step 4.6 now emits dist/app/checkout/index.html and
 * dist/app/billing/index.html as pre-generated SPA shells. GH Pages
 * serves those with HTTP 200.
 *
 * This test pins the source-of-truth list in prerender.mjs so a future
 * refactor of Step 4.6 can't silently regress either route. (We don't
 * shell out to the prerender script itself — the gate's `npm run build`
 * already exercises the writeFile path; this is a fast static check.)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const PRERENDER = resolve(__dirname, '..', 'scripts', 'prerender.mjs')

describe('prerender.mjs Step 4.6 — authShellRoutes (UI-3)', () => {
  const src = readFileSync(PRERENDER, 'utf-8')

  it('emits an SPA shell for /app/checkout (external CTA destination from /pricing)', () => {
    expect(src).toMatch(/['"]\/app\/checkout['"]/)
  })

  it('emits an SPA shell for /app/billing (external CTA destination from magic-link)', () => {
    expect(src).toMatch(/['"]\/app\/billing['"]/)
  })

  it('still emits the original auth shells (/login, /login/callback, /claim, /cli-auth)', () => {
    expect(src).toMatch(/['"]\/login['"]/)
    expect(src).toMatch(/['"]\/login\/callback['"]/)
    expect(src).toMatch(/['"]\/claim['"]/)
    expect(src).toMatch(/['"]\/cli-auth['"]/)
  })

  it('ROUTE_META carries titles for both new auth shells (so /app/checkout and /app/billing get sensible <title> tags, not the homepage default)', () => {
    expect(src).toMatch(/['"]\/app\/checkout['"]:\s*{[^}]*title:/)
    expect(src).toMatch(/['"]\/app\/billing['"]:\s*{[^}]*title:/)
  })
})

/* Bug-3 (2026-06-06): the agent-facing troubleshooting page is linked from
 * llms.txt as https://instanode.dev/docs/troubleshooting-deploys.md, but that
 * nested per-section .md route 404'd — only /docs.md (concatenated) and the
 * legal /docs/public/*.md statics resolved. Step 6b of emitMarkdownRoutes now
 * emits /docs/<slug>.md for every docs section so the contract URL 200s.
 *
 * These are source guards (deterministic, no filesystem/build dependency) so
 * they run identically under `npm run gate` (build-then-vitest) and the
 * coverage job (vitest only, no build) — every line is always executed. The
 * real-file emission is exercised by `npm run build` in the gate; the existing
 * llmsContract.test.ts already pins the `troubleshooting-deploys` reference in
 * public/llms.txt, so URL and contract stay in lock-step. */
describe('prerender.mjs Step 6b — per-section docs .md mirrors (Bug-3)', () => {
  const src = readFileSync(PRERENDER, 'utf-8')

  it('emits /docs/<slug>.md from each .content/docs section file', () => {
    // The loop derives the slug from the docs filename and writes /docs/<slug>.
    expect(src).toMatch(/writeRouteMd\(`\/docs\/\$\{slug\}`/)
  })

  it('excludes per-section docs from the aggregate (content already in /docs.md)', () => {
    // The per-section mirror call passes includeInAggregate=false (third arg)
    // so /llms-full.txt does not duplicate every docs section.
    expect(src).toMatch(/writeRouteMd\(`\/docs\/\$\{slug\}`,[^)]*,\s*false\)/)
  })

  it('builds each section mirror from the section title + frontmatter-stripped body', () => {
    // The mirror is the standalone section: an H1 from frontmatter title and
    // the body with its YAML frontmatter removed (mirrors buildDocsPage).
    expect(src).toMatch(/const title = meta\.title \|\| slug/)
    expect(src).toMatch(/`# \$\{title\}\\n\\n\$\{body\}\\n`/)
  })
})
