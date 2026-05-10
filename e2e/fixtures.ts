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

  // GET /api/v1/resources
  await page.route('**/api/v1/resources', (route: Route) => {
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
