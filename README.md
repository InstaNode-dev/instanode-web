# instanode.dev Dashboard

React 18 + TypeScript + Vite frontend for the customer dashboard. This is where users log in, view their provisioned resources, upgrade their plan, and manage their team. It talks directly to the agent-facing API at `api.instanode.dev`.

---

## Architecture

The dashboard is a single-page app that calls the agent API at `api.instanode.dev` for every operation: auth, claim, billing, team management, resource CRUD, and stacks. There is no intermediate backend — the browser holds a bearer token (`localStorage.instanode.token`) and includes it on every request.

In dev, Vite proxies `/api`, `/auth`, `/claim`, `/db`, `/cache`, `/nosql`, `/queue`, `/storage`, `/webhook`, `/.well-known` to `AGENT_API_URL` (default `http://api.instanode.dev`). In prod, the dashboard ships as a static bundle on GitHub Pages and issues cross-origin fetches directly to `https://api.instanode.dev` (set via the `VITE_API_URL` build env).

---

## Local Dev Setup

```bash
cd dashboard
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

To point the dev proxy at a local k8s cluster (the Service is ClusterIP — NodePort
retired 2026-05-11 — so port-forward `svc/instant-api` first):
```bash
kubectl port-forward -n instant svc/instant-api 8080:8080 &
AGENT_API_URL=http://localhost:8080 npm run dev
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
│   ├── useAuth.ts          # Bearer-token session management
│   └── useResources.ts     # Fetches and caches the resource list
├── pages/
│   ├── LoginPage.tsx       # Email magic link / PAT entry point
│   ├── DashboardPage.tsx   # Main resource list view
│   ├── ClaimPage.tsx       # Anonymous → account conversion (arrives via /start?t=jwt)
│   ├── BillingPage.tsx     # Plan status + upgrade flow
│   ├── SettingsPage.tsx    # Team name, member management
│   ├── ResourceDetailPage.tsx  # Per-resource view + rotate credentials
│   └── DeployPage.tsx      # Container deploy entrypoint
└── components/
    ├── Layout/             # Sidebar + top nav shell
    ├── ResourceCard/       # Resource summary card used in DashboardPage
    ├── StatusBadge/        # Active / expired / migrating badge
    ├── UpgradeBanner/      # Shown when approaching free-tier limits
    └── UsageBar/           # Storage usage visualization
```

---

## API contract types (OpenAPI codegen — contract-drift gate)

The UI↔API wire contract is no longer hand-mirrored. It is **generated** from the
api's committed OpenAPI snapshot, so a backend field rename fails `tsc` at PR time
instead of breaking prod at runtime (the class that broke login).
Design ref: `docs/ci/01-CI-INTEGRATION-DESIGN.md` (Wave 1).

```
openapi.snapshot.json        # committed copy, synced from the api repo (byte-identical)
        │  npm run gen:api-types  (openapi-typescript)
        ▼
src/api/generated.ts         # GENERATED — do not hand-edit
        │  Wire* aliases derive from components['schemas'][...]
        ▼
src/api/types.ts             # WireAuthMe / WireResourceItem / WireBillingState / WireDeployItem
        │  consumed by the adapters
        ▼
src/api/index.ts             # fetchMe / listResources / fetchBilling / listDeployments ...
```

- **Regenerate:** `npm run gen:api-types` (also runs automatically in `prebuild`).
- **Up-to-date gate:** `npm run gen:api-types:check` fails if `generated.ts` is
  stale vs the snapshot (runs in CI — `.github/workflows/ci.yml`).
- **Drift bite:** if the api renames/removes a field, regenerating `generated.ts`
  changes the derived `Wire*` type and `tsc` (in `npm run gate`) fails at every
  consumer site using the old field.

### Syncing the snapshot from the api repo

`openapi.snapshot.json` here is a **committed copy** of the api repo's
`openapi.snapshot.json` (chosen over fetching `https://api.instanode.dev/openapi.json`
at gen time so CI is deterministic and doesn't depend on prod being up). When the
api contract changes:

```sh
cp ../api/openapi.snapshot.json ./openapi.snapshot.json   # re-sync the copy
npm run gen:api-types                                      # regenerate types
npm run gate                                               # tsc will red at any UI site using a removed/renamed field
```

The api side gates the snapshot's faithfulness to its handlers (openapi-snapshot.yml)
and reds any breaking change at PR time (openapi-breaking.yml, oasdiff). See
`api/docs/OPENAPI-CONTRACT-GATES.md`.

Conversion is incremental — the highest-value wire shapes (auth/me, resources,
billing, deployments) derive from `generated.ts` today; see the TODO at the bottom
of `src/api/types.ts` for the remaining hand-typed wire types and known gate blind
spots (e.g. `/api/v1/capabilities` has no web consumer).

---

## Auth Flow

1. User pastes a PAT or completes the email magic-link flow on `LoginPage`.
2. The bearer token is stored in `localStorage.instanode.token` and attached as `Authorization: Bearer <token>` on every subsequent request.
3. `useAuth.ts` calls `GET /auth/me` on mount to hydrate session state.
4. On 401, the client clears the token, stores the current path under `instanode.return_to`, and redirects to `/login`.

---

## The Claim Page (Anonymous to Account)

When an anonymous user hits a resource limit, the agent API embeds an upgrade URL in the response:
```
https://instanode.dev/start?t=<signed-jwt>
```

That URL hits `GET /start` on the agent API, which validates the JWT and issues a 302 redirect to:
```
http://localhost:5173/claim?t=<jwt>
```

`ClaimPage.tsx` picks up the `t` parameter, lets the user choose a login method, and calls `POST /claim` on the agent API to atomically convert the anonymous session into a full account. The JWT in the claim is single-use — a second call returns 409 Conflict, preventing double-conversion.

---

## E2E Tests (Playwright)

107 tests covering auth guards, the upgrade journey, and resource interactions.

```bash
# Requires: Vite dev server running (npm run dev) + agent API port-forwarded
# (Service is ClusterIP; NodePort retired):
#   kubectl port-forward -n instant svc/instant-api 8080:8080
E2E_API_URL=http://localhost:8080 npx playwright test --project=chromium

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
| `AGENT_API_URL` | Upstream the Vite dev proxy points at | `http://api.instanode.dev` |
| `VITE_API_URL` | Build-time override for the production bundle | `https://api.instanode.dev` |
| `VITE_NO_PROXY` | Disables Vite proxy (set to `1` in E2E) | unset |
| `E2E_API_URL` | Agent API base URL used by Playwright tests (port-forward `svc/instant-api` first) | `http://localhost:8080` |

---

## Known Gaps

- **RotateCredentials**: the UI calls `POST /api/v1/resources/:id/rotate-credentials` on the agent API. Rotation is implemented for Postgres, Redis, and MongoDB.
- **Razorpay Checkout**: the "Upgrade to Pro" button calls `POST /api/v1/billing/checkout` on the agent API and redirects to the returned Razorpay short URL. When Razorpay isn't configured (503), the button falls back to `instanode.dev/pricing`.
