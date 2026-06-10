/* contrast.test.ts — WCAG AA guard for the de-emphasized text tokens.
 *
 * A live a11y dogfood found the pricing-page sub-labels (.pricing-feature-sub)
 * and the footer column headers (.public-footer-h / .mkt-footer-col h3) using
 * --text-faint (#50505a), which clears only ~2.4:1 on the dark surface — well
 * under WCAG AA's 4.5:1 floor for normal text. The fix routes those READ-content
 * labels through a new --text-muted token.
 *
 * This test reads the actual hex values out of tokens.css (so it can't drift
 * from the stylesheet) and asserts:
 *   - --text-muted clears AA (>=4.5:1) on every dark + light surface
 *   - --text-faint still FAILS AA on the dark surface (documents WHY the
 *     faint tier must not be used for readable text — if someone "fixes" faint
 *     to pass, this assertion flags that the two tiers have merged and the
 *     muted indirection is now redundant)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'tokens.css'), 'utf8')

// Relative luminance + WCAG contrast ratio (WCAG 2.x formula).
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function ratio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// Pull a token value out of the FIRST :root block (dark theme defaults).
function darkToken(name: string): string {
  const root = css.slice(css.indexOf(':root'))
  const m = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`dark token ${name} not found`)
  return m[1]
}
// Pull from the explicit light-theme block.
function lightToken(name: string): string {
  const block = css.slice(css.indexOf("html[data-theme='light']"))
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`light token ${name} not found`)
  return m[1]
}

const AA = 4.5

describe('--text-muted clears WCAG AA on every surface', () => {
  it('dark mode: muted vs --surface and --ink both >= 4.5:1', () => {
    const muted = darkToken('--text-muted')
    expect(ratio(muted, darkToken('--surface'))).toBeGreaterThanOrEqual(AA)
    expect(ratio(muted, darkToken('--ink'))).toBeGreaterThanOrEqual(AA)
  })

  it('light mode: muted vs --surface and --ink both >= 4.5:1', () => {
    const muted = lightToken('--text-muted')
    expect(ratio(muted, lightToken('--surface'))).toBeGreaterThanOrEqual(AA)
    expect(ratio(muted, lightToken('--ink'))).toBeGreaterThanOrEqual(AA)
  })
})

describe('--text-faint documents why it cannot back readable labels', () => {
  it('dark --text-faint still fails AA on --surface (the original bug color)', () => {
    const faint = darkToken('--text-faint')
    const r = ratio(faint, darkToken('--surface'))
    // ~2.4:1 — kept faint on purpose for ghost/decorative use only.
    expect(r).toBeLessThan(AA)
  })
})
