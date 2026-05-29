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
