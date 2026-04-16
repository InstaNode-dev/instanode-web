# instant.dev Dashboard

React 18 + TypeScript + Vite frontend for the customer dashboard. This is where users log in, view their provisioned resources, upgrade their plan, and manage their team. It talks exclusively to `dashboard-api/` (port 8081, NodePort 30082) — not directly to the agent-facing `api/`.

---

## Why Two APIs?

`api/` (port 8080) is designed for agents and automation: anonymous-friendly, no sessions, simple HTTP, no cookies. It intentionally has no concept of "logged-in user."

`dashboard-api/` (port 8081) is designed for humans: it manages JWT sessions, team membership, billing state, and exposes resource management UI that proxies reads from the platform database. The two services have different auth models, different latency tolerances, and different security concerns. Keeping them separate means a bug in the human-facing session layer cannot affect agent provisioning, and vice versa.

---

## Local Dev Setup

```bash
cd dashboard
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

Requires `dashboard-api` running and reachable at `http://localhost:30082` (k8s NodePort). If you're not running k8s, start it with docker-compose:
```bash
cd infra && docker compose up -d
```

To run unit tests:
```bash
npm test
```

---

## Key Source Files

```
src/
├── hooks/
│   ├── useAuth.ts          # JWT session management — login, logout, auto-refresh
│   └── useResources.ts     # Fetches and caches the resource list from dashboard-api
├── pages/
│   ├── LoginPage.tsx       # GitHub OAuth / magic link entry point
│   ├── DashboardPage.tsx   # Main resource list view
│   ├── ClaimPage.tsx       # Anonymous → account conversion (arrives via /start?t=jwt)
│   ├── BillingPage.tsx     # Plan status + upgrade flow
│   ├── SettingsPage.tsx    # Team name, member management
│   ├── ResourceDetailPage.tsx  # Per-resource view + rotate credentials
│   └── DeployPage.tsx      # (Phase 6) Container deploy entrypoint
└── components/
    ├── Layout/             # Sidebar + top nav shell
    ├── ResourceCard/       # Resource summary card used in DashboardPage
    ├── StatusBadge/        # Active / expired / migrating badge
    ├── UpgradeBanner/      # Shown when approaching free-tier limits
    └── UsageBar/           # Storage usage visualization
```

---

## Auth Flow

1. User clicks "Login with GitHub" on `LoginPage` — browser goes to `dashboard-api/auth/github`.
2. OAuth redirect returns to `dashboard-api/auth/callback`, which issues a JWT and sets a `__session` HttpOnly cookie.
3. `useAuth.ts` calls `/auth/me` on mount to hydrate session state. The JWT is kept in memory (not localStorage) to avoid XSS exposure.
4. `useAuth.ts` silently calls `/auth/refresh` every 23 hours to extend the session without prompting the user.
5. On logout, `/auth/logout` clears the cookie and the in-memory token.

---

## The Claim Page (Anonymous to Account)

When an anonymous user hits a resource limit, `api/` embeds an upgrade URL in the response:
```
https://instant.dev/start?t=<signed-jwt>
```

That URL hits `api/GET /start`, which validates the JWT and issues a 302 redirect to:
```
http://localhost:5173/claim?t=<jwt>
```

`ClaimPage.tsx` picks up the `t` parameter, lets the user choose a login method, and calls `api/POST /claim` to atomically convert the anonymous session into a full account. The JWT in the claim is single-use — a second call returns 409 Conflict, preventing double-conversion.

---

## E2E Tests (Playwright)

107 tests covering auth guards, the upgrade journey, and resource interactions.

```bash
# Requires: Vite dev server running (npm run dev) + k8s API at localhost:30080
E2E_API_URL=http://localhost:30080 npx playwright test --project=chromium

# Run a single spec
npx playwright test e2e/auth-guards.spec.ts --project=chromium

# Headed mode for debugging
npx playwright test --headed --project=chromium
```

**Note on `VITE_NO_PROXY=1`**: E2E tests set this flag to disable the Vite dev proxy. All API calls in tests go through `page.route()` mocks or directly via the `request` fixture against `E2E_API_URL`. Without this flag, Vite rewrites API URLs and tests break against the real cluster.

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_URL` | dashboard-api base URL | `http://localhost:30082` |
| `VITE_NO_PROXY` | Disables Vite proxy (set to `1` in E2E) | unset |
| `E2E_API_URL` | Agent API base URL used by Playwright tests | `http://localhost:30080` |

---

## Known Gaps

- **RotateCredentials**: the UI calls `POST /api/v1/resources/:id/rotate` on dashboard-api, which proxies to `api/`. Rotation is implemented for Postgres, Redis, and MongoDB.
- **Razorpay Checkout**: the "Upgrade to Pro" button opens `instant.dev/pricing` when checkout is not configured. A real `POST /api/v1/billing/checkout` endpoint in dashboard-api returns a Razorpay short URL when keys are configured.
