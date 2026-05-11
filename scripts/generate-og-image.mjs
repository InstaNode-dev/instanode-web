/* generate-og-image.mjs — one-shot generator for dashboard/public/og-default.png.
 *
 * Why this exists:
 *   When someone pastes https://instanode.dev into Slack, Discord, Twitter, or
 *   Hacker News, the platform fetches the og:image referenced in <head> and
 *   shows it as the link preview card. The canonical OG dimensions are
 *   1200x630 px (the "summary_large_image" Twitter card uses the same).
 *   A default image with the wordmark + value prop dramatically lifts CTR
 *   vs. the favicon thumbnail browsers fall back to.
 *
 * How it works:
 *   1. Build an HTML page in-memory that paints the OG composition
 *      (dark background matching --ink, mint-green wordmark and tagline).
 *   2. Launch headless Chromium via Playwright (already a dev dep here).
 *   3. Set the viewport to exactly 1200x630 and screenshot the body.
 *   4. Write the PNG to public/og-default.png so Vite copies it to dist/
 *      at the site root: https://instanode.dev/og-default.png.
 *
 * Run via:  node scripts/generate-og-image.mjs
 * Idempotent. Re-run anytime the brand or tagline changes. Not part of the
 * build pipeline — the PNG is committed to source so CI doesn't need a
 * browser. Regenerate manually if you change the design.
 */

import { chromium } from 'playwright'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdir } from 'fs/promises'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = resolve(ROOT, 'public/og-default.png')

const WIDTH = 1200
const HEIGHT = 630

// Inline HTML — keep this in lockstep with the brand tokens in src/styles
// (--ink: #08080a is the global dark canvas; --mint: #00e48e is the brand
// accent). Embedding the font via Google Fonts keeps the PNG matching the
// site's actual typography (Bricolage Grotesque for display, JetBrains
// Mono for the monospaced .dev suffix).
const HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      background: #08080a;
      color: #f5f5f7;
      font-family: 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
    }
    /* Subtle radial vignette so the dark background has depth rather than
       reading as a flat black rectangle. The mint tint matches the brand. */
    body::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 25% 30%, rgba(0, 228, 142, 0.10) 0%, transparent 55%);
      pointer-events: none;
    }
    /* Faint grid overlay — gives the card a "infra/terminal" texture
       without dominating. Two repeating linear-gradients form 80px cells. */
    body::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px);
      background-size: 80px 80px;
      pointer-events: none;
    }
    .frame {
      position: absolute;
      inset: 64px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      z-index: 2;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 22px;
      color: #00e48e;
      letter-spacing: 0.02em;
    }
    .badge .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #00e48e;
      box-shadow: 0 0 12px rgba(0, 228, 142, 0.7);
    }
    .wordmark {
      font-size: 116px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.045em;
      color: #f5f5f7;
      margin: 0;
    }
    .wordmark .dev {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 600;
      color: #00e48e;
      font-size: 0.78em;
      letter-spacing: -0.02em;
    }
    .tagline {
      font-size: 44px;
      font-weight: 500;
      line-height: 1.18;
      color: #c9c9d1;
      letter-spacing: -0.02em;
      max-width: 1000px;
      margin: 24px 0 0 0;
    }
    .tagline em {
      font-style: normal;
      color: #00e48e;
      font-weight: 600;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 22px;
      color: #6e6e76;
    }
    .footer .curl {
      color: #c9c9d1;
    }
    .footer .curl .verb { color: #00e48e; }
  </style>
</head>
<body>
  <div class="frame">
    <div class="badge"><span class="dot"></span>instanode.dev</div>
    <div>
      <h1 class="wordmark">instanode<span class="dev">.dev</span></h1>
      <p class="tagline">Real infrastructure for <em>AI agents</em> — Postgres, Redis, Mongo, queues, storage, and deployed apps from a single HTTP call.</p>
    </div>
    <div class="footer">
      <span class="curl"><span class="verb">curl -X POST</span> https://api.instanode.dev/db/new</span>
      <span>no account · no docker · no setup</span>
    </div>
  </div>
</body>
</html>`

async function main() {
  console.log('og-image: launching headless Chromium…')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    })
    await page.setContent(HTML, { waitUntil: 'networkidle' })
    // Give Google Fonts an extra beat to settle the layout — networkidle
    // returns once requests stop, but font-display: swap means the first
    // paint may use a fallback face. 400 ms is enough on a warm cache.
    await page.waitForTimeout(400)

    await mkdir(dirname(OUT_PATH), { recursive: true })
    await page.screenshot({
      path: OUT_PATH,
      type: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    })
    console.log(`og-image: wrote ${OUT_PATH} (${WIDTH}x${HEIGHT})`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('og-image: failed:', err)
  process.exit(1)
})
