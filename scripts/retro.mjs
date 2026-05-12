// Standalone retro script — uses Playwright lib directly (no test runner).
// Captures screenshots + DOM evidence for every dashboard route.
import { chromium } from 'playwright'
import fs from 'fs'

const OUT = '/tmp/dashboard-retro'
const BASE = 'http://localhost:5173'

const FAKE_TEAM = '00000000-1111-2222-3333-444444444444'
const FAKE_USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const FAKE_RESOURCES = [
  { id: '11111111-aaaa-bbbb-cccc-000000000001', token: '11111111-aaaa-bbbb-cccc-000000000001',
    resource_type: 'postgres', name: 'flashcards-db', env: 'production', tier: 'hobby',
    status: 'active', storage_bytes: 47_500_000, storage_limit_bytes: 500_000_000,
    storage_exceeded: false, connections_in_use: 2, connections_limit: 5,
    created_at: '2026-04-22T18:42:11Z', team_id: FAKE_TEAM, expires_at: null },
  { id: '22222222-aaaa-bbbb-cccc-000000000002', token: '22222222-aaaa-bbbb-cccc-000000000002',
    resource_type: 'redis', name: 'flashcards-cache', env: 'production', tier: 'hobby',
    status: 'active', storage_bytes: 1_200_000, storage_limit_bytes: 25_000_000,
    storage_exceeded: false, connections_in_use: 1, connections_limit: 5,
    created_at: '2026-04-22T18:42:25Z', team_id: FAKE_TEAM, expires_at: null },
]

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function installFakes(page) {
  await page.route('**/auth/me', (r) => r.fulfill(json({
    ok: true, user_id: FAKE_USER, team_id: FAKE_TEAM,
    email: 'aanya@example.com', tier: 'hobby', trial_ends_at: null,
  })))
  await page.route('**/api/v1/resources', (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill(json({ ok: true, items: FAKE_RESOURCES, total: FAKE_RESOURCES.length }))
    }
    return r.continue()
  })
  for (const res of FAKE_RESOURCES) {
    await page.route(`**/api/v1/resources/${res.token}`, (r) =>
      r.fulfill(json({ ok: true, item: res })))
    await page.route(`**/api/v1/resources/${res.token}/credentials`, (r) =>
      r.fulfill(json({ ok: true, id: res.id, token: res.token,
        resource_type: res.resource_type, env: res.env,
        connection_url: res.resource_type === 'postgres'
          ? 'postgres://usr:pw@pg.instanode.dev:5432/db'
          : 'redis://usr:pw@redis.instanode.dev:6379/0' })))
  }
  await page.route('**/api/v1/vault/production', (r) => r.fulfill(json({ ok: true, keys: ['RAZORPAY_KEY_SECRET','OPENAI_API_KEY'] })))
  await page.route('**/api/v1/vault/staging', (r) => r.fulfill(json({ ok: true, keys: [] })))
  await page.route('**/api/v1/vault/development', (r) => r.fulfill(json({ ok: true, keys: [] })))
  await page.route('**/api/v1/auth/api-keys', (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill(json({ ok: true, items: [
        { id: 'k1111111-1111-1111-1111-111111111111', name: 'laptop',
          scopes: ['read','write'], created_at: '2026-05-01T10:00:00Z',
          last_used_at: '2026-05-09T18:00:00Z', revoked: false }
      ]}))
    }
    return r.continue()
  })
  await page.route('**/api/v1/stacks', (r) => r.fulfill(json({
    ok: true, items: [
      { id: 'stk_flashcards', slug: 'flashcards', name: 'flashcards',
        status: 'running', env: 'production', tier: 'hobby',
        url: 'https://flashcards.deployment.instanode.dev',
        last_deploy_at: new Date(Date.now() - 12*60_000).toISOString(),
        build_duration_s: 38, created_at: new Date(Date.now() - 86400_000).toISOString() },
      { id: 'stk_worker', slug: 'worker', name: 'worker',
        status: 'building', env: 'production', tier: 'hobby',
        url: null, last_deploy_at: new Date(Date.now() - 5*60_000).toISOString(),
        build_duration_s: 14, created_at: new Date(Date.now() - 2*86400_000).toISOString() },
    ], total: 2,
  })))
  await page.route('**/api/v1/team/members', (r) => r.fulfill(json({
    ok: true, members: [
      { id: 'u1', email: 'aanya@example.com', role: 'owner', display_name: 'Aanya', created_at: new Date().toISOString() }
    ]
  })))
  await page.route('**/api/v1/team/invitations', (r) => r.fulfill(json({ ok: true, invitations: [] })))
  await page.route('**/api/v1/billing', (r) => r.fulfill(json({
    ok: true, billing: {
      tier: 'hobby', payment_network: 'visa', payment_last4: '4242',
      payment_exp_month: 12, payment_exp_year: 2028,
      current_period_end: new Date(Date.now() + 9*86400_000).toISOString()
    }
  })))
  await page.route('**/api/v1/billing/invoices', (r) => r.fulfill(json({ ok: true, invoices: [] })))
  await page.route('**/api/v1/activity', (r) => r.fulfill(json({ ok: true, items: [] })))
}

async function audit(page, route, slug) {
  const screenshot = `${OUT}/${slug}.png`
  try { await page.screenshot({ path: screenshot, fullPage: true, timeout: 10000 }) }
  catch (e) { console.log(`  screenshot fail: ${e.message}`) }

  const buttons = await page.$$eval('button', (btns) =>
    btns.filter(b => !b.hasAttribute('onclick') && b.getAttribute('type') !== 'submit')
        .map(b => (b.getAttribute('aria-label') || b.textContent || '').trim())
        .filter(Boolean)
  ).catch(() => [])
  const anchorsNoHref = await page.$$eval('a:not([href])', (as) =>
    as.map(a => (a.getAttribute('aria-label') || a.textContent || '').trim()).filter(Boolean)
  ).catch(() => [])

  const text = await page.locator('body').innerText().catch(() => '')
  const count = (re) => (text.match(re) || []).length
  const shortcuts = {
    kbk: count(/⌘K/g),
    kbslash: count(/⌘\//g),
    sparkle: count(/✦/g),
    askAgent: count(/ask agent/gi),
  }
  const hard = {
    acme: count(/acme-corp|acme\.dev|acme\.com/gi),
    aanya: count(/aanya|kavya@|marcus/gi),
    flashcards: count(/flashcards|render-queue|events-store|cache-sessions/g),
    fixtures: count(/d_xY9z2k7m|r_5tYn2k|m_2a8f10|q_cb091f|a31fc8de/g),
    renewal: count(/9 days to renewal|auto-charges|May 19/g),
    comingSoon: count(/coming soon|mocked|stubbed/gi),
  }
  const placeholders = (text.match(/\b(TODO|WIP|CHANGE_ME|FIXME|XXX|mocked|stubbed|FIXTURE)\b/g) || [])
  const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || ''

  console.log(`\n## ${route}`)
  console.log(`  screenshot: ${screenshot}`)
  console.log(`  H1: ${h1.trim().slice(0, 80)}`)
  console.log(`  shortcuts: ⌘K=${shortcuts.kbk} ⌘/=${shortcuts.kbslash} ✦=${shortcuts.sparkle} "ask agent"=${shortcuts.askAgent}`)
  console.log(`  hardcoded: acme=${hard.acme} aanya/kavya/marcus=${hard.aanya} fixtures=${hard.flashcards} fixture-IDs=${hard.fixtures} renewal=${hard.renewal} comingSoon=${hard.comingSoon}`)
  console.log(`  placeholders: ${placeholders.join(', ') || '—'}`)
  console.log(`  buttons-no-onclick: ${buttons.length}`)
  if (buttons.length) console.log(`    sample: ${buttons.slice(0, 12).map(s => s.replace(/\s+/g,' ').slice(0,40)).join(' | ')}`)
  console.log(`  anchors-no-href: ${anchorsNoHref.length}`)
  if (anchorsNoHref.length) console.log(`    sample: ${anchorsNoHref.slice(0, 8).map(s => s.replace(/\s+/g,' ').slice(0,40)).join(' | ')}`)

  return { route, screenshot, h1: h1.trim(), shortcuts, hardcoded: hard, placeholders, buttonsNoHandler: buttons, anchorsNoHref }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { localStorage.setItem('instanode.token', 'ink_FAKE_RETRO') })
  const page = await ctx.newPage()
  await installFakes(page)

  const routes = [
    ['/', 'marketing'],
    ['/pricing', 'pricing'],
    ['/for-agents', 'for-agents'],
    ['/docs', 'docs'],
    ['/blog', 'blog'],
    ['/status', 'status'],
    ['/use-cases', 'use-cases'],
    ['/login', 'login'],
    ['/claim?t=eyJhbGciOiJIUzI1NiJ9.fake.fake', 'claim'],
    // Re-arm the token (claim flow may clear it), then enter /app.
    ['__reset__', null],
    ['/app', 'app-overview'],
    ['/app/resources', 'app-resources'],
    [`/app/resources/${FAKE_RESOURCES[0].id}`, 'app-resource-detail'],
    ['/app/deployments', 'app-deployments'],
    ['/app/deployments/stk_flashcards', 'app-deployment-detail'],
    ['/app/billing', 'app-billing'],
    ['/app/team', 'app-team'],
    ['/app/vault', 'app-vault'],
    ['/app/settings', 'app-settings'],
    ['/app/stacks', 'app-stacks'],
    ['/app/agent', 'app-agent'],
    ['/app/contracts', 'app-contracts'],
  ]
  const results = []
  for (const [route, slug] of routes) {
    if (route === '__reset__') continue
    try {
      const isApp = route.startsWith('/app')
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 15000 })
      if (isApp) {
        // After AuthGate runs once with no token (synchronously), re-seed and reload.
        const onLogin = await page.locator('h1').first().textContent().catch(() => '')
        if ((onLogin || '').includes('Sign in')) {
          await page.evaluate(() => localStorage.setItem('instanode.token', 'ink_FAKE_RETRO'))
          await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 15000 })
        }
      }
      await page.waitForTimeout(900)
      results.push(await audit(page, route, slug))
    } catch (e) {
      console.log(`FAIL ${route}: ${e.message}`)
    }
  }
  fs.writeFileSync(`${OUT}/audit.json`, JSON.stringify(results, null, 2))
  await ctx.close()
  await browser.close()
  console.log(`\nDONE — ${results.length} routes audited`)
}

main().catch((e) => { console.error(e); process.exit(1) })
