// Stubbed API client — adds a small fake-network delay so loading states
// behave like the real thing. Swap this for `apiFetch()` against
// dashboard-api when backend is ready.
//
// Exact contract reference (when wiring real backend):
//   GET /api/v1/resources               — locked
//   GET /api/v1/resources/:id           — locked
//   POST /api/v1/resources/:id/rotate   — locked
//   DELETE /api/v1/resources/:id        — locked
//   GET /api/v1/team                    — locked
//   PATCH /api/v1/team                  — locked
//   GET /api/v1/team/members            — locked
//   POST /api/v1/team/members/invite    — locked
//   GET /api/v1/team/invitations        — locked
//   GET /api/v1/billing                 — locked
//   POST /api/v1/billing/checkout       — locked
//   GET /api/v1/billing/invoices        — locked
//   GET /api/v1/stacks                  — locked
//   GET /api/v1/stacks/:slug            — locked
//   GET /auth/me                        — locked

const FAKE_LATENCY_MS = 120

/** Returns a promise that resolves to `value` after a small delay */
export function fake<T>(value: T, latency = FAKE_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), latency)
  })
}

/** Fakes a network error after a delay */
export function fakeError(msg: string, latency = FAKE_LATENCY_MS): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(msg)), latency)
  })
}

/** When backend lands, this is the real entrypoint. */
// export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
//   const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${path}`, {
//     credentials: 'include',
//     headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
//     ...init
//   })
//   const json = await res.json()
//   if (!json.ok) throw Object.assign(new Error(json.error), json)
//   return json
// }
