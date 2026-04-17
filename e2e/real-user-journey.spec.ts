/**
 * real-user-journey.spec.ts
 *
 * Full end-to-end journey — ZERO MOCKS.
 *
 * All requests hit the live instant-api at E2E_API_URL.
 * No page.route() content mocking — only a routing shim that forwards
 * https://instanode.dev/* to http://localhost:30080/* so the upgrade URL
 * from the API response can be opened in a real browser tab.
 *
 * dashboard-api is not required — this tests the agent-facing API and
 * the browser-rendered /start landing page directly.
 *
 * ─────────────────────────────────────────────────────────────────
 * Phase 1 · Discovery      — anonymous developer provisions 4 services
 * Phase 2 · Usage          — cache key prefix, connection URL verification
 * Phase 3 · Limits / CTA   — upgrade URL in every response, JWT shape
 * Phase 4 · Landing page   — /start?t= opens in real browser
 * Phase 5 · Integrity      — delete invalidation, 404 shape, metrics, openapi
 * Phase 6 · Full flow      — complete journey chained in one test
 * ─────────────────────────────────────────────────────────────────
 *
 * Run (against live k8s):
 *   E2E_API_URL=http://localhost:30080 \
 *   npx playwright test e2e/real-user-journey.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:30080';

// ── Unique IP per test — prevents fingerprint dedup collisions between runs. ─
let ipCounter = 0;
function uniqueIP(): string {
  const n = ((Date.now() >> 4) + ipCounter++) % (254 * 254);
  const b = (Math.floor(n / 254) % 254) + 1;
  const c = (n % 254) + 1;
  return `10.${b}.${c}.1`;
}

// ── Thin HTTP helpers — plain Playwright request, zero response mocking. ─────
type AnyObj = Record<string, unknown>;
type Ctx = import('@playwright/test').APIRequestContext;

async function apiPost(ctx: Ctx, path: string, ip: string, body?: AnyObj) {
  const r = await ctx.post(`${API}${path}`, {
    data: body ?? null,
    headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' },
  });
  return { status: r.status(), body: (await r.json()) as AnyObj, headers: r.headers() };
}

async function apiGet(ctx: Ctx, path: string, ip = '10.1.1.1') {
  const r = await ctx.get(`${API}${path}`, { headers: { 'X-Forwarded-For': ip } });
  const text = await r.text();
  let body: AnyObj;
  try { body = JSON.parse(text) as AnyObj; } catch { body = { _raw: text }; }
  return { status: r.status(), body, headers: r.headers() };
}

/** Assert status is 2xx — provisioning endpoints return 201, action endpoints 200. */
function expect2xx(status: number, context = '') {
  expect(status, `Expected 2xx${context ? ` for ${context}` : ''}, got ${status}`)
    .toBeGreaterThanOrEqual(200);
  expect(status, `Expected 2xx${context ? ` for ${context}` : ''}, got ${status}`)
    .toBeLessThan(300);
}

/**
 * Route shim: forward https://instanode.dev/* → http://localhost:30080/*
 * This is NOT a mock — the real API at localhost handles every request.
 * We only do this so the test can navigate to the exact upgrade URL that
 * appears in API responses (which point to https://instanode.dev).
 */
async function withInstantDevRouting(page: import('@playwright/test').Page) {
  await page.route('https://instanode.dev/**', async route => {
    const url = new URL(route.request().url());
    const localURL = `${API}${url.pathname}${url.search}${url.hash}`;
    try {
      // Forward to real local API — no fabricated responses.
      const response = await page.request.fetch(localURL, {
        method: route.request().method(),
        headers: { ...route.request().headers(), host: new URL(API).host },
        data: route.request().postDataBuffer() ?? undefined,
        failOnStatusCode: false,
      });
      await route.fulfill({ response });
    } catch {
      await route.abort();
    }
  });
}

// =============================================================================
// PHASE 1 · DISCOVERY — Anonymous developer provisions all 4 services
// =============================================================================

test.describe('Phase 1 · Anonymous provisioning — all 4 services', () => {
  /**
   * A developer runs a new project.
   * POST /cache/new → Redis token + connection URL. No account, no Docker.
   */
  test('1.1 · Provision a Redis cache (POST /cache/new)', async ({ request }) => {
    const ip = uniqueIP();
    const { status, body } = await apiPost(request, '/cache/new', ip);

    expect2xx(status, '/cache/new');
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.tier).toBe('anonymous');

    const limits = body.limits as AnyObj;
    expect(typeof limits.memory_mb).toBe('number');
    expect(limits.memory_mb as number).toBeLessThanOrEqual(5);
    expect(limits.expires_in).toBe('24h');

    // Key prefix — unique namespace in the shared Redis cluster
    expect(typeof body.key_prefix).toBe('string');
    expect((body.key_prefix as string).length).toBeGreaterThan(0);

    // Upgrade CTA in every anonymous response
    expect(typeof body.note).toBe('string');
    expect((body.note as string).includes('instanode.dev/start?t=')).toBe(true);

    console.log(`✓ Cache token: ${body.token}`);
    console.log(`  Key prefix: ${body.key_prefix}`);
  });

  /**
   * Developer provisions a Postgres database — real DB, already created.
   */
  test('1.2 · Provision Postgres DB (POST /db/new)', async ({ request }) => {
    const ip = uniqueIP();
    const { status, body } = await apiPost(request, '/db/new', ip);

    expect2xx(status, '/db/new');
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('anonymous');

    const url = body.connection_url as string;
    expect(url.startsWith('postgres://')).toBe(true);
    expect(url.includes('usr_')).toBe(true);
    expect(url.includes('db_')).toBe(true);

    const limits = body.limits as AnyObj;
    expect(limits.storage_mb).toBe(10);
    expect(limits.connections).toBe(2);
    expect(limits.expires_in).toBe('24h');

    console.log(`✓ DB token: ${body.token}`);
    console.log(`  URL: postgres://usr_...`);
    console.log(`  Limits: ${JSON.stringify(limits)}`);
  });

  /**
   * Developer provisions a Redis cache.
   */
  test('1.3 · Provision Redis cache (POST /cache/new)', async ({ request }) => {
    const ip = uniqueIP();
    const { status, body } = await apiPost(request, '/cache/new', ip);

    expect2xx(status, '/cache/new');
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('anonymous');

    const url = body.connection_url as string;
    expect(url.startsWith('redis://')).toBe(true);

    // Key prefix isolates this tenant in the shared Redis cluster
    expect(typeof body.key_prefix).toBe('string');
    expect((body.key_prefix as string).length).toBeGreaterThan(0);

    const limits = body.limits as AnyObj;
    expect(limits.memory_mb).toBe(5);
    expect(limits.expires_in).toBe('24h');

    console.log(`✓ Cache token: ${body.token}`);
    console.log(`  Key prefix: ${body.key_prefix}`);
  });

  /**
   * Developer provisions MongoDB for a document store.
   */
  test('1.4 · Provision MongoDB (POST /nosql/new)', async ({ request }) => {
    const ip = uniqueIP();
    const { status, body } = await apiPost(request, '/nosql/new', ip);

    expect2xx(status, '/nosql/new');
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('anonymous');

    const url = body.connection_url as string;
    expect(url.startsWith('mongodb://')).toBe(true);
    expect(url.includes('usr_')).toBe(true);
    expect(url.includes('db_')).toBe(true);

    const limits = body.limits as AnyObj;
    expect(limits.storage_mb).toBe(5);
    expect(limits.connections).toBe(2);

    console.log(`✓ NoSQL token: ${body.token}`);
  });

  /**
   * Developer provisions a NATS JetStream queue for async jobs.
   */
  test('1.5 · Provision NATS queue (POST /queue/new)', async ({ request }) => {
    const ip = uniqueIP();
    const { status, body } = await apiPost(request, '/queue/new', ip);

    expect2xx(status, '/queue/new');
    expect(body.ok).toBe(true);
    expect(body.tier).toBe('anonymous');

    const url = body.connection_url as string;
    expect(url.startsWith('nats://')).toBe(true);
    expect(url.includes('usr_')).toBe(true);

    const limits = body.limits as AnyObj;
    expect(limits.storage_mb).toBeDefined();

    console.log(`✓ Queue token: ${body.token}`);
  });
});

// =============================================================================
// PHASE 2 · USAGE — Developer uses provisioned services
// =============================================================================

test.describe('Phase 2 · Using the Redis cache', () => {
  /**
   * 2.1: Provision a cache and verify key prefix uniqueness.
   * Two separate IPs must produce two distinct key prefixes.
   */
  test('2.1 · Two cache provisions from different IPs get distinct key prefixes', async ({ request }) => {
    const ipA = uniqueIP();
    const ipB = uniqueIP();

    const provA = await apiPost(request, '/cache/new', ipA);
    expect2xx(provA.status, '/cache/new A');
    expect(provA.body.ok).toBe(true);
    const prefixA = provA.body.key_prefix as string;

    const provB = await apiPost(request, '/cache/new', ipB);
    expect2xx(provB.status, '/cache/new B');
    expect(provB.body.ok).toBe(true);
    const prefixB = provB.body.key_prefix as string;

    expect(prefixA).not.toBe(prefixB);
    console.log(`✓ Prefix A: ${prefixA}, Prefix B: ${prefixB} (distinct)`);
  });

  /**
   * 2.2: Cache connection URL is always a valid redis:// URL.
   */
  test('2.2 · Cache connection URL is always a valid redis:// URL', async ({ request }) => {
    const ip = uniqueIP();
    const prov = await apiPost(request, '/cache/new', ip);
    expect2xx(prov.status, '/cache/new');
    const url = prov.body.connection_url as string;
    expect(url.startsWith('redis://')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.hostname.length).toBeGreaterThan(0);
    expect(Number(parsed.port) || 6379).toBeGreaterThan(0);
    console.log(`✓ Redis URL: redis://<creds>@${parsed.hostname}:${parsed.port || 6379}`);
  });
});

// =============================================================================
// PHASE 3 · LIMITS / CTA — Upgrade URL surfaced organically
// =============================================================================

test.describe('Phase 3 · Upgrade CTA embedded in every response', () => {
  /**
   * Every anonymous provision response contains a signed JWT upgrade URL.
   * This is what appears in curl output, Claude Code logs, and CI output.
   */
  test('3.1 · Every provision response contains an upgrade URL with JWT', async ({ request }) => {
    const ip = uniqueIP();
    const services = ['/db/new', '/cache/new', '/nosql/new', '/queue/new'];

    for (const path of services) {
      const { body } = await apiPost(request, path, ip);
      expect(body.ok).toBe(true);

      const note = body.note as string;
      expect(note).toBeTruthy();

      const match = note.match(/instant\.dev\/start\?t=([A-Za-z0-9_\-.]+)/);
      expect(match, `${path}: note must contain upgrade URL`).not.toBeNull();

      const jwt = match![1];
      const parts = jwt.split('.');
      expect(parts, `${path}: JWT must have 3 parts`).toHaveLength(3);

      // Decode payload
      const padded = parts[1].padEnd(parts[1].length + (4 - parts[1].length % 4) % 4, '=');
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString()) as AnyObj;

      expect(typeof payload.fp).toBe('string');
      expect(Array.isArray(payload.tok)).toBe(true);
      expect(Array.isArray(payload.rt)).toBe(true);
      expect(typeof payload.exp).toBe('number');
      expect(typeof payload.jti).toBe('string');
      expect(['hobby', 'pro']).toContain(payload.plan);

      console.log(`✓ ${path}: JWT has ${(payload.tok as string[]).length} tokens, plan=${payload.plan}`);
    }
  });

  /**
   * Fingerprint dedup: after 5 provisions from the same IP,
   * the 6th call returns an existing token (not 429, not a new resource).
   */
  test('3.2 · Fingerprint dedup — 6th provision returns existing token', async ({ request }) => {
    const ip = uniqueIP();
    const tokens: string[] = [];

    for (let i = 0; i < 5; i++) {
      const { body } = await apiPost(request, '/cache/new', ip);
      expect(body.ok).toBe(true);
      tokens.push(body.token as string);
    }

    const { body: dedupBody } = await apiPost(request, '/cache/new', ip);
    expect(dedupBody.ok).toBe(true);
    const dedupToken = dedupBody.token as string;
    expect(tokens).toContain(dedupToken);
    console.log(`✓ Dedup returned existing token: ${dedupToken}`);
  });
});

// =============================================================================
// PHASE 4 · LANDING PAGE — /start?t=<jwt> opens in real browser
// =============================================================================

test.describe('Phase 4 · Upgrade landing page (real browser)', () => {
  /**
   * Developer clicks the upgrade URL from their terminal output.
   * We route https://instanode.dev → localhost (the real local API).
   * No response content is fabricated — the real API handles the request.
   */
  test('4.1 · Upgrade URL from API response loads in browser (no 5xx)', async ({ request, page }) => {
    const ip = uniqueIP();

    // Provision a cache — upgrade URL appears in response
    const prov = await apiPost(request, '/cache/new', ip);
    expect2xx(prov.status, '/cache/new');

    // Extract the exact upgrade URL from the API response note
    const note = prov.body.note as string;
    const match = note.match(/(https?:\/\/instant\.dev\/start\?t=[A-Za-z0-9_\-.]+)/);
    expect(match, 'note must contain an upgrade URL').not.toBeNull();
    const upgradeURL = match![1];

    console.log(`Upgrade URL from API: ${upgradeURL.slice(0, 80)}...`);

    // Route https://instanode.dev/* → our local API (not mocking content — just DNS routing)
    await withInstantDevRouting(page);

    // Navigate to the exact URL the developer would click
    const response = await page.goto(upgradeURL, { waitUntil: 'commit' });
    expect(response?.status(), '/start must not 5xx').toBeLessThan(500);
    console.log(`✓ /start page HTTP status: ${response?.status()}`);
  });

  /**
   * An invalid JWT returns a structured 400 — not a 500 crash.
   */
  test('4.2 · /start?t=<invalid-jwt> returns 400 structured error', async ({ request }) => {
    const { status, body } = await apiGet(request, '/start?t=invalid.jwt.here');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(['invalid_token', 'not_found']).toContain(body.error);
    console.log(`✓ Invalid JWT → 400 ${body.error}`);
  });
});

// =============================================================================
// PHASE 5 · INTEGRITY — Core system guarantees
// =============================================================================

test.describe('Phase 5 · System integrity', () => {
  /**
   * An unknown token returns 404 with structured JSON.
   * The all-zeros UUID is never provisioned → exercises the not-found path.
   */
  test('5.1 · Unauthenticated resource API does not return 5xx for unknown id', async ({ request }) => {
    const fakeToken = '00000000-0000-0000-0000-000000000001';
    const r = await request.get(`${API}/api/v1/resources/${fakeToken}`, {
      headers: { 'X-Forwarded-For': '10.1.1.1' },
    });
    expect(r.status()).not.toBe(500);
    expect([401, 403, 404]).toContain(r.status());
    console.log(`✓ Unknown resource id → HTTP ${r.status()} (not 5xx)`);
  });

  /**
   * 404 responses return structured JSON with "not_found" error code.
   * (Previously broken — Fiber global handler was returning "internal_error" for 404s.)
   */
  test('5.2 · 404 returns structured JSON {ok:false, error:"not_found"}', async ({ request }) => {
    const { status, body } = await apiGet(request, '/nonexistent/route/does/not/exist');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_found');
    expect(typeof body.message).toBe('string');
    console.log(`✓ 404 → error=${body.error}`);
  });

  /**
   * Health check returns {ok: true}.
   */
  test('5.3 · GET /healthz returns {ok:true, service:"instanode.dev"}', async ({ request }) => {
    const { status, body } = await apiGet(request, '/healthz');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('instanode.dev');
    console.log(`✓ /healthz OK`);
  });

  /**
   * Prometheus metrics endpoint serves valid Prometheus text format.
   */
  test('5.4 · GET /metrics returns Prometheus text format', async ({ request }) => {
    const r = await request.get(`${API}/metrics`);
    expect(r.status()).toBe(200);
    const text = await r.text();
    expect(text).toContain('go_gc_duration_seconds');
    expect(text).toContain('# TYPE');
    console.log(`✓ /metrics: ${text.length} bytes`);
  });

  /**
   * OpenAPI 3.1 spec is served and has the correct structure.
   */
  test('5.5 · GET /openapi.json returns valid OpenAPI 3.1 document', async ({ request }) => {
    const { status, body } = await apiGet(request, '/openapi.json');
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(typeof body.info).toBe('object');
    const paths = body.paths as AnyObj;
    expect(paths['/db/new']).toBeDefined();
    expect(paths['/cache/new']).toBeDefined();
    expect(paths['/nosql/new']).toBeDefined();
    expect(paths['/queue/new']).toBeDefined();
    console.log(`✓ /openapi.json: ${Object.keys(paths).length} paths`);
  });

  /**
   * Every provision response includes X-Request-Id for tracing.
   */
  test('5.6 · Every provision response includes X-Request-Id header', async ({ request }) => {
    const ip = uniqueIP();
    const services = ['/db/new', '/cache/new', '/nosql/new', '/queue/new'];

    for (const path of services) {
      const { headers } = await apiPost(request, path, ip);
      const requestId = headers['x-request-id'];
      expect(requestId, `${path} must have X-Request-Id`).toBeTruthy();
      expect(/^[0-9a-f-]{36}$/.test(requestId)).toBe(true);
      console.log(`✓ ${path} → X-Request-Id: ${requestId}`);
    }
  });

  /**
   * Wrong Content-Type does not crash the server.
   */
  test('5.7 · Non-JSON body does not cause 500', async ({ request }) => {
    const ip = uniqueIP();
    const r = await request.post(`${API}/cache/new`, {
      data: 'not json at all',
      headers: { 'X-Forwarded-For': ip, 'Content-Type': 'text/plain' },
    });
    // Must not 500 — body is optional for /cache/new
    expect(r.status()).not.toBe(500);
    console.log(`✓ Non-JSON body → HTTP ${r.status()} (not 500)`);
  });

  /**
   * Concurrent provisions from 5 different IPs all get unique tokens.
   */
  test('5.8 · Concurrent provisions from 5 different IPs produce 5 unique tokens', async ({ request }) => {
    const promises = Array.from({ length: 5 }, () =>
      apiPost(request, '/cache/new', uniqueIP()),
    );
    const results = await Promise.all(promises);

    const tokens = results.map(r => {
      expect2xx(r.status, 'concurrent /cache/new');
      expect(r.body.ok).toBe(true);
      return r.body.token as string;
    });

    const unique = new Set(tokens);
    expect(unique.size).toBe(5);
    console.log(`✓ 5 concurrent provisions → 5 unique tokens`);
  });
});

// =============================================================================
// PHASE 6 · FULL FLOW — Complete journey chained in one test
// =============================================================================

test.describe('Phase 6 · Complete developer journey (single chained flow)', () => {
  /**
   * The definitive end-to-end test: chains every step in the order
   * a real developer (or AI agent) would experience them.
   *
   *  1.  Provision Redis cache       → get token + connection URL + key prefix
   *  2.  Verify connection URL       → valid redis:// URL
   *  3.  Provision Postgres         → get connection string
   *  4.  Provision MongoDB          → get connection string
   *  5.  Provision NATS queue       → get connection string
   *  6.  Inspect upgrade JWT        → verify payload has all tokens
   *  7.  Open /start in browser     → no 5xx (routes to local API)
   *  8.  Invalid JWT → 400          → structured error, not crash
   *  9.  Unknown route → 404        → structured error
   */
  test('6.0 · Anonymous developer builds an app with instanode.dev', async ({ request, page }) => {
    const ip = uniqueIP();
    console.log(`\n=== Complete developer journey (IP: ${ip}) ===\n`);

    // ── Step 1: Provision Redis cache ────────────────────────────────────────
    const cacheResult = await apiPost(request, '/cache/new', ip);
    expect2xx(cacheResult.status, '/cache/new');
    const cacheToken = cacheResult.body.token as string;
    const cacheURL = cacheResult.body.connection_url as string;
    expect(cacheURL.startsWith('redis://')).toBe(true);
    console.log(`[1] ✓ Redis: ${cacheToken}`);
    console.log(`    Key prefix: ${cacheResult.body.key_prefix}`);
    console.log(`    Limits: ${JSON.stringify(cacheResult.body.limits)}`);

    // ── Step 2: Verify connection URL is reachable format ─────────────────────
    const parsedURL = new URL(cacheURL);
    expect(parsedURL.hostname.length).toBeGreaterThan(0);
    console.log(`[2] ✓ Connection URL valid: redis://<creds>@${parsedURL.hostname}`);

    // ── Step 3: Provision Postgres ────────────────────────────────────────────
    const dbResult = await apiPost(request, '/db/new', ip);
    expect2xx(dbResult.status, '/db/new');
    const dbToken = dbResult.body.token as string;
    const dbURL = dbResult.body.connection_url as string;
    expect(dbURL.startsWith('postgres://')).toBe(true);
    console.log(`[3] ✓ Postgres: ${dbToken}`);
    console.log(`    Limits: ${JSON.stringify(dbResult.body.limits)}`);

    // ── Step 4: Provision MongoDB ─────────────────────────────────────────────
    const nosqlResult = await apiPost(request, '/nosql/new', ip);
    expect2xx(nosqlResult.status, '/nosql/new');
    const nosqlURL = nosqlResult.body.connection_url as string;
    expect(nosqlURL.startsWith('mongodb://')).toBe(true);
    console.log(`[4] ✓ MongoDB: ${nosqlResult.body.token}`);

    // ── Step 5: Provision NATS queue ─────────────────────────────────────────
    const queueResult = await apiPost(request, '/queue/new', ip);
    expect2xx(queueResult.status, '/queue/new');
    const queueURL = queueResult.body.connection_url as string;
    expect(queueURL.startsWith('nats://')).toBe(true);
    console.log(`[5] ✓ NATS: ${queueResult.body.token}`);

    // ── Step 6: Inspect upgrade JWT — payload has all 4 tokens ───────────────
    const note = queueResult.body.note as string;
    const jwtMatch = note.match(/instant\.dev\/start\?t=([A-Za-z0-9_\-.]+)/);
    expect(jwtMatch, 'note must contain upgrade URL').not.toBeNull();
    const jwt = jwtMatch![1];
    const [, payloadB64] = jwt.split('.');
    const padded = payloadB64.padEnd(payloadB64.length + (4 - payloadB64.length % 4) % 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString()) as AnyObj;

    const tokList = payload.tok as string[];
    expect(tokList.length).toBeGreaterThanOrEqual(4); // cache + db + nosql + queue
    expect(tokList).toContain(cacheToken);
    expect(tokList).toContain(dbToken);
    console.log(`[6] ✓ Upgrade JWT: ${tokList.length} tokens, plan=${payload.plan}`);
    console.log(`    fp=${payload.fp}, services=${(payload.rt as string[]).join(',')}`);

    // ── Step 7: Open /start in real browser ──────────────────────────────────
    const upgradeURL = `https://instanode.dev/start?t=${jwt}`;
    await withInstantDevRouting(page);
    const startResp = await page.goto(upgradeURL, { waitUntil: 'commit' });
    expect(startResp?.status(), '/start must not 5xx').toBeLessThan(500);
    console.log(`[7] ✓ /start page → HTTP ${startResp?.status()}`);

    // ── Step 8: Invalid JWT → 400 ────────────────────────────────────────────
    const badJWT = await apiGet(request, '/start?t=bad.token.here');
    expect(badJWT.status).toBe(400);
    expect(badJWT.body.ok).toBe(false);
    console.log(`[8] ✓ Invalid JWT → 400 ${badJWT.body.error}`);

    // ── Step 9: Unknown route → 404 ──────────────────────────────────────────
    const notFound = await apiGet(request, '/this/does/not/exist');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error).toBe('not_found');
    console.log(`[9] ✓ Unknown route → 404 not_found`);

    console.log('\n=== Journey complete ===');
    console.log(`Redis:   ${cacheToken}`);
    console.log(`DB:      ${dbToken}`);
    console.log(`MongoDB: ${nosqlResult.body.token}`);
    console.log(`NATS:    ${queueResult.body.token}`);
    console.log(`Upgrade: https://instanode.dev/start?t=${jwt.slice(0, 40)}...`);
  });
});
