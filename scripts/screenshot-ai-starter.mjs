/* One-shot screenshot script for the new #ai-starter section.
 *
 * Run with:
 *   node scripts/screenshot-ai-starter.mjs
 *
 * Assumes the Vite dev server is already running on http://localhost:5173
 * (start it with `npm run dev` in another terminal first). Writes the
 * screenshot to test-results/ai-starter-section.png so reviewers can see
 * the rendered section without booting Playwright themselves.
 */

import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const url = process.env.SCREENSHOT_URL || 'http://localhost:5173/'
const out = 'test-results/ai-starter-section.png'

await mkdir('test-results', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
const section = page.locator('#ai-starter')
await section.scrollIntoViewIfNeeded()
await section.screenshot({ path: out })
await browser.close()
console.log(`Wrote ${out}`)
