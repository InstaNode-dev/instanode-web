import { Page, Route } from '@playwright/test'

export const FAKE_TEAM = '00000000-1111-2222-3333-444444444444'
export const FAKE_USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

export const FAKE_RESOURCES = [
  {
    id: '11111111-aaaa-bbbb-cccc-000000000001',
    token: '11111111-aaaa-bbbb-cccc-000000000001',
    resource_type: 'postgres',
    name: 'flashcards-db',
    env: 'production',
    tier: 'hobby',
    status: 'active',
    storage_bytes: 47_500_000,
    storage_limit_bytes: 500_000_000,
    storage_exceeded: false,
    connections_in_use: 2,
    connections_limit: 5,
    created_at: '2026-04-22T18:42:11Z',
    team_id: FAKE_TEAM,
    expires_at: null,
  },
  {
    id: '22222222-aaaa-bbbb-cccc-000000000002',
    token: '22222222-aaaa-bbbb-cccc-000000000002',
    resource_type: 'redis',
    name: 'flashcards-cache',
    env: 'production',
    tier: 'hobby',
    status: 'active',
    storage_bytes: 1_200_000,
    storage_limit_bytes: 25_000_000,
    storage_exceeded: false,
    connections_in_use: 1,
    connections_limit: 5,
    created_at: '2026-04-22T18:42:25Z',
    team_id: FAKE_TEAM,
    expires_at: null,
  },
]

export const FAKE_VAULT_KEYS = ['RAZORPAY_KEY_SECRET', 'OPENAI_API_KEY']

export const FAKE_API_KEYS = [
  {
    id: 'k1111111-1111-1111-1111-111111111111',
    name: 'laptop',
    scopes: ['read', 'write'],
    created_at: '2026-05-01T10:00:00Z',
    last_used_at: '2026-05-09T18:00:00Z',
    revoked: false,
  },
]

// Track A — admin console fixtures. The agent API registers admin endpoints
// under an unguessable URL prefix delivered through /auth/me. For test
// determinism we use a fixed alphanumeric blob that matches the shape of
// what the real API would serve.
export const FAKE_ADMIN_PATH_PREFIX = 'testfixturepathprefix0123456789ab'

// Admin customer list fixture covering each tier the filter pills can
// produce. mrr_monthly is in INR paise (×100) to match the agent contract.
export const FAKE_ADMIN_CUSTOMERS = [
  {
    team_id: 't_founder',
    primary_email: 'founder@x.com',
    name: 'Founder Co',
    tier: 'pro',
    mrr_monthly: 490000, // ₹4,900 → $58.80
    mrr_yearly: 0,
    storage_bytes: 4_800_000_000,
    deployments_active: 2,
    last_active: '2026-05-12T12:00:00Z',
    created_at: '2026-01-04T00:00:00Z',
  },
  {
    team_id: 't_dev',
    primary_email: 'dev@startup.io',
    name: 'Startup',
    tier: 'hobby',
    mrr_monthly: 90000, // ₹900
    mrr_yearly: 0,
    storage_bytes: 220_000_000,
    deployments_active: 1,
    last_active: '2026-05-13T01:00:00Z',
    created_at: '2026-03-01T00:00:00Z',
  },
  {
    team_id: 't_agent',
    primary_email: 'agent@temp.dev',
    name: '',
    tier: 'anonymous',
    mrr_monthly: 0,
    mrr_yearly: 0,
    storage_bytes: 1_000_000,
    deployments_active: 0,
    last_active: null,
    created_at: '2026-05-13T00:00:00Z',
  },
] as const

export const FAKE_ADMIN_DETAIL = {
  ok: true,
  team: {
    id: 't_founder',
    name: 'Founder Co',
    slug: 'founder-co',
    owner_id: 'u_founder',
    member_count: 2,
    tier: 'pro',
    created_at: '2026-01-04T00:00:00Z',
    display_name: 'Founder Co',
    primary_email: 'founder@x.com',
  },
  users: [
    {
      id: 'u_founder',
      email: 'founder@x.com',
      tier: 'pro',
      team_id: 't_founder',
      created_at: '2026-01-04T00:00:00Z',
      role: 'owner',
    },
  ],
  resources: [
    {
      id: 'res_db',
      token: 'tok_db',
      resource_type: 'postgres',
      tier: 'pro',
      status: 'active',
      name: 'orders-db',
      env: 'production',
      storage_bytes: 100_000_000,
      storage_limit_bytes: 5_000_000_000,
      storage_exceeded: false,
      expires_at: null,
      created_at: '2026-01-15T00:00:00Z',
    },
  ],
  audit_log: [
    {
      id: 'a1',
      kind: 'tier.change',
      summary: 'pro tier activated via Razorpay',
      at: '2026-04-01T00:00:00Z',
    },
  ],
  deploys: [],
  subscription: {
    status: 'active',
    next_renewal_at: '2026-06-01T00:00:00Z',
    amount_inr: 490000,
    razorpay_subscription_id: 'sub_1234',
  },
  promos: [],
}

/**
 * Admin /auth/me fixture — sets is_platform_admin=true AND admin_path_prefix
 * so the AdminCustomersPage route gate (which is the intersection of the
 * two signals) lets the page render. The default installAPIFake() also
 * routes /auth/me to a non-admin response; this function should be called
 * AFTER installAPIFake() so the admin response wins (Playwright matches
 * routes in reverse registration order — most recent wins).
 */
export async function installAdminAPIFake(page: Page) {
  // Admin-specific data mocks first so /auth/me re-route below is last.
  await mockAdminListResponse(page)
  await mockAdminDetailResponse(page)
  await mockAdminTierChange(page)
  await mockAdminPromoIssue(page)
  await page.route('**/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user_id: FAKE_USER,
        team_id: FAKE_TEAM,
        email: 'manas@instanode.dev',
        tier: 'team',
        trial_ends_at: null,
        is_platform_admin: true,
        admin_path_prefix: FAKE_ADMIN_PATH_PREFIX,
      }),
    }),
  )
}

/**
 * Mock GET /api/v1/<prefix>/customers. Honours `?tier=` and `?q=` filters
 * so the filter pill + search tests see a real-feeling response shape.
 * Test code can override per-call with page.route() registered AFTER this.
 */
export async function mockAdminListResponse(
  page: Page,
  rows: ReadonlyArray<(typeof FAKE_ADMIN_CUSTOMERS)[number]> = FAKE_ADMIN_CUSTOMERS,
) {
  const pattern = new RegExp(
    `/api/v1/${FAKE_ADMIN_PATH_PREFIX}/customers(\\?[^/]*)?$`,
  )
  await page.route(pattern, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const url = new URL(route.request().url())
    const tier = url.searchParams.get('tier')
    const q = url.searchParams.get('q')
    let filtered = [...rows]
    if (tier && tier !== 'all') {
      filtered = filtered.filter((r) => r.tier === tier)
    }
    if (q) {
      const needle = q.toLowerCase()
      filtered = filtered.filter(
        (r) =>
          r.primary_email.toLowerCase().includes(needle) ||
          (r.name ?? '').toLowerCase().includes(needle),
      )
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: filtered,
        total: filtered.length,
      }),
    })
  })
}

/** Mock GET /api/v1/<prefix>/customers/:team_id. */
export async function mockAdminDetailResponse(
  page: Page,
  detail: typeof FAKE_ADMIN_DETAIL = FAKE_ADMIN_DETAIL,
) {
  const pattern = new RegExp(
    `/api/v1/${FAKE_ADMIN_PATH_PREFIX}/customers/[^/?]+$`,
  )
  await page.route(pattern, (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    })
  })
}

/** Mock POST /api/v1/<prefix>/customers/:team_id/tier. */
export async function mockAdminTierChange(page: Page) {
  const pattern = new RegExp(
    `/api/v1/${FAKE_ADMIN_PATH_PREFIX}/customers/[^/?]+/tier$`,
  )
  await page.route(pattern, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        team: { ...FAKE_ADMIN_DETAIL.team, tier: body.tier ?? 'pro' },
      }),
    })
  })
}

/** Mock POST /api/v1/<prefix>/customers/:team_id/promo. */
export async function mockAdminPromoIssue(
  page: Page,
  code = 'FOUNDER-MAY26',
  expiresAt: string | null = '2026-06-12T00:00:00Z',
) {
  const pattern = new RegExp(
    `/api/v1/${FAKE_ADMIN_PATH_PREFIX}/customers/[^/?]+/promo$`,
  )
  await page.route(pattern, (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, code, expires_at: expiresAt }),
    })
  })
}

export async function installAPIFake(page: Page) {
  // GET /auth/me — agent API shape
  await page.route('**/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user_id: FAKE_USER,
        team_id: FAKE_TEAM,
        email: 'aanya@example.com',
        tier: 'hobby',
        trial_ends_at: null,
      }),
    }),
  )

  // GET /api/v1/resources (optional ?env=... query string — ResourcesPage
  // calls listResources(ctx.env) which produces /api/v1/resources?env=production).
  // A bare-glob `**/api/v1/resources` only matches the no-query path, so we
  // use a regex anchored on the path + optional query string.
  await page.route(/\/api\/v1\/resources(\?[^/]*)?$/, (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: FAKE_RESOURCES, total: FAKE_RESOURCES.length }),
      })
    }
    return route.continue()
  })

  // GET /api/v1/resources/:id and /credentials
  for (const r of FAKE_RESOURCES) {
    await page.route(`**/api/v1/resources/${r.token}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, item: r }),
      }),
    )
    await page.route(`**/api/v1/resources/${r.token}/credentials`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: r.id,
          token: r.token,
          resource_type: r.resource_type,
          env: r.env,
          connection_url:
            r.resource_type === 'postgres'
              ? 'postgres://usr:pw@pg.instanode.dev:5432/db'
              : 'redis://usr:pw@redis.instanode.dev:6379/0',
        }),
      }),
    )
  }

  // Vault
  await page.route('**/api/v1/vault/production', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, keys: FAKE_VAULT_KEYS }),
    }),
  )
  await page.route('**/api/v1/vault/staging', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, keys: [] }) }),
  )
  await page.route('**/api/v1/vault/development', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, keys: [] }) }),
  )

  // PATs
  await page.route('**/api/v1/auth/api-keys', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, items: FAKE_API_KEYS }),
      })
    }
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          id: 'newpat-1111-1111-1111-111111111111',
          name: body.name,
          scopes: body.scopes ?? ['read', 'write'],
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked: false,
          key: 'ink_FAKE-NEW-PAT-PLAINTEXT',
          note: 'Save this key now — it will not be shown again.',
        }),
      })
    }
    return route.continue()
  })
}

export async function signIn(page: Page, token = 'ink_FAKE_TEST_TOKEN') {
  await page.addInitScript((tok) => {
    localStorage.setItem('instanode.token', tok)
  }, token)
}

// ─── Billing / payments fixtures ────────────────────────────────────────
//
// These back the upgrade-journey + billing-page Playwright specs. The
// dashboard never talks to Razorpay directly — it calls the agent API's
// /api/v1/billing/* endpoints, which return a Razorpay-hosted `short_url`.
// So a hermetic test mocks the agent API responses and asserts the
// dashboard navigates to the mock short_url; it never loads Razorpay's
// real page (that stays in the manual Chrome-MCP layer, S5).

/** Razorpay-style hosted checkout URL the mocked /billing/checkout returns.
 *  Tests assert the dashboard navigates here — they do NOT load it. */
export const FAKE_RAZORPAY_SHORT_URL = 'https://rzp.io/i/FAKEcheckout123'

/** GET /api/v1/billing payload — a hobby team with an active subscription
 *  and a saved card. Shaped to api/internal/handlers/billing.go's
 *  BillingStateResp wire contract. */
export const FAKE_BILLING_STATE = {
  ok: true,
  tier: 'hobby',
  subscription_status: 'active' as const,
  next_renewal_at: '2026-06-19T00:00:00Z',
  amount_inr: 90000,
  payment_method: { type: 'card' as const, brand: 'visa', last4: '4242' },
  billing_email: 'aanya@example.com',
  razorpay_subscription_id: 'sub_FAKE123',
  razorpay_customer_id: 'cust_FAKE123',
  razorpay_configured: true,
}

/** GET /api/v1/billing/usage payload — server-side cached aggregate. */
export const FAKE_BILLING_USAGE = {
  ok: true,
  freshness_seconds: 30,
  as_of: new Date(Date.now() - 12_000).toISOString(),
  usage: {
    postgres: { bytes: 47_500_000, limit_bytes: 1_073_741_824 },
    redis: { bytes: 1_200_000, limit_bytes: 52_428_800 },
    mongodb: { bytes: 800_000, limit_bytes: 104_857_600 },
    // Deployment count — the canonical source. The Overview tile reads
    // GET /api/v1/deployments (a list); both must agree (S5-F4 regression).
    deployments: { count: 1, limit: 1 },
    webhooks: { count: 12, limit: 1000 },
    vault: { count: 2, limit: 100 },
    members: { count: 1, limit: 1 },
  },
}

/** GET /api/v1/billing/invoices payload — exercises the null/pending
 *  field paths that produced "Invalid Date" / "$NaN" before mapInvoice()
 *  was hardened (S5-F3 regression). One paid row, one pending row with a
 *  zero amount, one row with no pdf_url. */
export const FAKE_INVOICES_WIRE = {
  ok: true,
  invoices: [
    {
      id: 'inv_PAID001',
      amount: 4900, // cents — $49.00
      currency: 'USD',
      status: 'paid',
      date: '2026-05-19T10:00:00Z',
      pdf_url: 'https://rzp.io/invoice/inv_PAID001.pdf',
    },
    {
      // Pending invoice: zero amount, no pdf — must NOT render "$NaN" or a
      // dead "↓ pdf" link.
      id: 'inv_PENDING002',
      amount: 0,
      currency: 'USD',
      status: 'pending',
      date: '2026-05-19T11:00:00Z',
    },
    {
      // Unknown status from Razorpay ('issued') — collapses to 'pending'.
      id: 'inv_ISSUED003',
      amount: 900,
      currency: 'USD',
      status: 'issued',
      date: '2026-05-19T12:00:00Z',
    },
  ],
}

/**
 * installBillingAPIFake — layers the billing endpoints on top of
 * installAPIFake(). Call AFTER installAPIFake() so the /auth/me tier here
 * (hobby — has an active subscription, can upgrade) wins.
 *
 * Per-test overrides: register a more specific page.route() AFTER this for
 * checkout success/failure/already-on-plan variants — Playwright matches
 * routes most-recent-first.
 */
export async function installBillingAPIFake(page: Page) {
  await page.route('**/api/v1/billing', (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_BILLING_STATE),
    })
  })
  await page.route('**/api/v1/billing/usage', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_BILLING_USAGE),
    }),
  )
  await page.route('**/api/v1/billing/invoices', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_INVOICES_WIRE),
    }),
  )
  // /auth/me — hobby tier so the upgrade CTAs render. installAPIFake()
  // already routes this to hobby, but we re-assert here so a caller can
  // installBillingAPIFake() standalone.
  await page.route('**/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user_id: FAKE_USER,
        team_id: FAKE_TEAM,
        email: 'aanya@example.com',
        tier: 'hobby',
        trial_ends_at: null,
      }),
    }),
  )
}

/** mockCheckoutSuccess — POST /api/v1/billing/checkout returns a Razorpay
 *  short_url. The dashboard navigates the browser to it. */
export async function mockCheckoutSuccess(page: Page, shortUrl = FAKE_RAZORPAY_SHORT_URL) {
  await page.route('**/api/v1/billing/checkout', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, short_url: shortUrl, subscription_id: 'sub_NEW999' }),
    })
  })
}

/** mockCheckoutFailure — POST /api/v1/billing/checkout fails. `kind`
 *  selects which honest failure path the dashboard must render:
 *   - 'billing_not_configured' → 503, CheckoutPage shows the fallback panel
 *   - 'already_on_plan'        → 409, the user already holds this plan
 *   - 'generic'                → 500, inline error banner */
export async function mockCheckoutFailure(
  page: Page,
  kind: 'billing_not_configured' | 'already_on_plan' | 'generic' = 'generic',
) {
  const spec = {
    billing_not_configured: {
      status: 503,
      body: { ok: false, error: 'billing_not_configured', message: 'Razorpay plan not configured for this tier.' },
    },
    already_on_plan: {
      status: 409,
      body: { ok: false, error: 'already_on_plan', message: 'Your team is already on this plan.' },
    },
    generic: {
      status: 500,
      body: { ok: false, error: 'internal', message: 'Checkout could not be created.' },
    },
  }[kind]
  await page.route('**/api/v1/billing/checkout', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.fulfill({
      status: spec.status,
      contentType: 'application/json',
      body: JSON.stringify(spec.body),
    })
  })
}

/** mockChangePlan — POST /api/v1/billing/change-plan. `mode`:
 *   - 'immediate'      → ok with no short_url; modal shows "Plan changed ✓"
 *   - 'short_url'      → ok with a short_url; dashboard redirects to Razorpay
 *   - 'already_on_plan'→ 409; modal surfaces the error inline
 *   - 'server_error'   → 500; modal shows error + Contact-support fallback */
export async function mockChangePlan(
  page: Page,
  mode: 'immediate' | 'short_url' | 'already_on_plan' | 'server_error' = 'immediate',
) {
  await page.route('**/api/v1/billing/change-plan', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue()
    if (mode === 'immediate') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, new_plan: 'pro', effective_date: '2026-05-19T00:00:00Z' }),
      })
    }
    if (mode === 'short_url') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, new_plan: 'pro', short_url: FAKE_RAZORPAY_SHORT_URL }),
      })
    }
    if (mode === 'already_on_plan') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'already_on_plan', message: 'Your team is already on this plan.' }),
      })
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'internal', message: 'Plan change failed upstream.' }),
    })
  })
}
