// currency.ts — money formatting helpers for the founder admin console.
//
// Background: Track A's agent API returns MRR fields (`mrr_monthly`,
// `mrr_yearly`) as integers in INR **paise** — i.e. ₹1 = 100 paise. This
// matches Razorpay's wire format. Track B's first cut (PR #45) rendered
// everything as INR because that's what the data was, but the founder
// convention for SaaS dashboards is USD. Track H makes USD the default
// and exposes an INR toggle for India-context glance.
//
// Conversion strategy:
//   - We use a **static** INR→USD rate baked in at build time. This is
//     fine for a founder-internal MRR view because the operator only
//     needs **directional signal** ("which customer is biggest, is MRR
//     growing"), not penny-accurate FX.
//   - `VITE_INR_TO_USD` lets ops override the rate at build/deploy time
//     if the static default drifts too far from reality.
//   - For penny-accurate, daily-refreshed FX, fetch from
//     openexchangerates.org (or a similar provider) and cache server-side.
//     That's a follow-up only if conversion accuracy ever matters — for a
//     founder-internal dashboard it shouldn't.
//
// Helpers:
//   - `formatINR(paise)` — ₹-prefixed, en-IN locale grouping (lakh/crore).
//   - `formatUSD(paise)` — $-prefixed, en-US grouping, paise→USD via rate.
//   - `formatMoney(paise, currency)` — generic switch; this is what
//     callsites use so the toggle reads cleanly.

/**
 * Static fallback exchange rate for INR → USD.
 *
 * As of 2026-05 the spot rate hovers around 1 INR ≈ $0.012 USD. This is
 * intentionally a constant — see file header for the "static is fine"
 * argument. Set `VITE_INR_TO_USD` in the build env to override.
 */
export const INR_TO_USD = 0.012

/**
 * Resolves an INR→USD rate from a raw env-style value with sensible
 * fallback semantics:
 *   - missing / empty → static {@link INR_TO_USD}
 *   - non-numeric    → static {@link INR_TO_USD}
 *   - zero / negative → static {@link INR_TO_USD}
 *   - positive number → that value
 *
 * Exported so tests can exercise the parsing rules without fighting
 * Vite's compile-time `import.meta.env` substitution.
 */
export function resolveInrToUsd(raw: unknown): number {
  if (raw == null || raw === '') return INR_TO_USD
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return INR_TO_USD
  return n
}

/**
 * Resolved rate at module load time. Reads `VITE_INR_TO_USD` from Vite's
 * inlined env; falls back to {@link INR_TO_USD} when unset or unparseable.
 *
 * Vite replaces `import.meta.env.VITE_*` at build time, so this is
 * effectively a compile-time constant per build — no runtime cost. The
 * downside is that tests can't override it after the module has been
 * transformed; use {@link resolveInrToUsd} directly to verify the parser.
 */
export const ACTIVE_INR_TO_USD = resolveInrToUsd(
  typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta).env?.VITE_INR_TO_USD
    : undefined,
)

export type CurrencyCode = 'USD' | 'INR'

/** localStorage key for the founder console's currency preference. */
export const CURRENCY_STORAGE_KEY = 'instant.admin.currency'

/** Default currency for the admin console — founder convention is USD. */
export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

/**
 * Format a paise amount as INR — e.g. 490000 paise → "₹4,900".
 * Returns an em dash for zero / non-finite so blank cells don't read as
 * "₹0" (zero is real signal: this customer is not paying us anything).
 */
export function formatINR(paise: number | null | undefined): string {
  if (paise == null || !Number.isFinite(paise) || paise === 0) return '—'
  const rupees = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees)
}

/**
 * Format a paise amount as USD — e.g. 490000 paise → "$58.80".
 * paise → rupees (÷100) → USD (× {@link ACTIVE_INR_TO_USD}). Returns em
 * dash for zero / non-finite, same as {@link formatINR}.
 *
 * We render two decimals for USD because the converted values are
 * typically small (under $200/mo for hobby+pro), and rounding to whole
 * dollars throws away meaningful precision.
 */
export function formatUSD(paise: number | null | undefined): string {
  if (paise == null || !Number.isFinite(paise) || paise === 0) return '—'
  const rupees = paise / 100
  const usd = rupees * ACTIVE_INR_TO_USD
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(usd)
}

/**
 * Generic dispatcher used by callsites that toggle between currencies.
 * Keeping the switch here means the page/drawer just hand off `currency`
 * and never branch on it themselves.
 */
export function formatMoney(
  paise: number | null | undefined,
  currency: CurrencyCode,
): string {
  return currency === 'USD' ? formatUSD(paise) : formatINR(paise)
}

/**
 * Read the persisted currency choice. Falls back to {@link DEFAULT_CURRENCY}
 * when nothing is stored or the value is corrupt. Safe to call during
 * useState initialisation — guards SSR / no-`window` environments.
 */
export function readStoredCurrency(): CurrencyCode {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_CURRENCY
  }
  try {
    const v = window.localStorage.getItem(CURRENCY_STORAGE_KEY)
    if (v === 'USD' || v === 'INR') return v
  } catch {
    // localStorage can throw (private mode, quota). Silent fallback is
    // fine — the toggle still works in-memory for this session.
  }
  return DEFAULT_CURRENCY
}

/** Persist the currency choice. Silent on failure (see {@link readStoredCurrency}). */
export function writeStoredCurrency(c: CurrencyCode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, c)
  } catch {
    // Ignore — see readStoredCurrency.
  }
}

/**
 * formatInvoiceAmount — defensive `$NN.NN` renderer for invoice rows.
 *
 * BugBash T15-P1-4 (2026-05-20): BillingPage.tsx invoice grid rendered
 * `${(i.amount_cents/100).toFixed(2)}` unguarded. A partial / legacy invoice
 * row with `amount_cents = null | undefined | string` produced `$NaN` — a
 * money-UI showing `$NaN` destroys trust on contact. Centralise the guard
 * here so every invoice-amount call site uses the same fallback.
 *
 * Returns `'—'` for any non-finite input. Matches the em-dash convention
 * the existing formatINR / formatUSD use.
 */
export function formatInvoiceAmount(amountCents: number | null | undefined): string {
  if (amountCents == null || !Number.isFinite(amountCents)) return '—'
  return `$${(amountCents / 100).toFixed(2)}`
}

/**
 * formatInvoiceDate — defensive `MM/DD/YYYY` renderer for invoice rows.
 *
 * BugBash T15-P1-4 (2026-05-20): BillingPage.tsx rendered
 * `new Date(i.issued_at).toLocaleDateString()` unguarded. A row with a
 * missing/empty/malformed timestamp produced the user-visible string
 * `'Invalid Date'`. Mirror AdminCustomersPage's `formatDate`: parse first,
 * `isNaN(d.getTime())` check, em-dash on failure.
 */
export function formatInvoiceDate(iso: string | null | undefined): string {
  if (iso == null || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}
