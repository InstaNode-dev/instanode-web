/* retryHint.ts — user-facing "retry in Ns" support for HTTP 429.
 *
 * BugBash: the data layer for 429 / Retry-After handling is wired in the
 * APIError envelope (a `retryAfter` seconds field, parsed from the
 * `Retry-After` response header). This module is the small, presentation-
 * side counterpart — it turns that number into a human countdown string
 * the dashboard can render next to a rate-limited error.
 *
 * It is deliberately defensive about where the number comes from:
 *
 *   1. `err.retryAfter` — the structured field on APIError (preferred).
 *   2. a "(retry after Ns)" / "retry in Ns" fragment in `err.message` —
 *      a fallback for errors that carry the hint only in their text.
 *
 * Reading the field through a loose `unknown` shape (rather than
 * importing APIError) keeps this module decoupled: it works whether or
 * not a given build's APIError exposes `retryAfter`, and never throws on
 * a plain Error or a non-error value.
 */

// RETRY_HINT_RE — matches a retry-delay hint embedded in an error
// message, e.g. "rate limited (retry after 30s)" or "retry in 12
// seconds". Capture group 1 is the integer seconds.
const RETRY_HINT_RE = /retry\s+(?:after|in)\s+(\d+)\s*s/i

/** retryAfterSeconds — best-effort extraction of a non-negative retry
 *  delay (in whole seconds) from a thrown value. Returns null when no
 *  hint is present. */
export function retryAfterSeconds(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null

  const field = (err as { retryAfter?: unknown }).retryAfter
  if (typeof field === 'number' && Number.isFinite(field) && field >= 0) {
    return Math.ceil(field)
  }

  const message = (err as { message?: unknown }).message
  if (typeof message === 'string') {
    const m = message.match(RETRY_HINT_RE)
    if (m) {
      const secs = Number(m[1])
      if (Number.isFinite(secs) && secs >= 0) return secs
    }
  }

  return null
}

/** isRateLimited — true when the error is an HTTP 429. Reads `status`
 *  defensively so it works on APIError without importing it. */
export function isRateLimited(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' &&
    (err as { status?: unknown }).status === 429
}

/** formatRetryHint — turns a seconds count into a short human phrase.
 *  `null`/negative input yields a generic fallback so callers can always
 *  render a non-empty string for a 429. */
export function formatRetryHint(seconds: number | null): string {
  if (seconds == null || seconds < 0) return 'Please retry in a moment.'
  if (seconds === 0) return 'You can retry now.'
  if (seconds < 60) {
    return `Please retry in ${seconds} second${seconds === 1 ? '' : 's'}.`
  }
  const mins = Math.ceil(seconds / 60)
  return `Please retry in about ${mins} minute${mins === 1 ? '' : 's'}.`
}
