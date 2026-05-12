// IpAllowList — tag-input for IPv4 addresses / CIDR blocks used by the
// private-deploy (Track B) UI.
//
// Behaviour contract:
//   - Each entry is rendered as a chip with a × button to remove.
//   - The input box at the end of the chip row accepts new entries.
//     Enter, comma, or space commits the pending text as a chip.
//     Backspace on an empty input removes the last chip.
//   - Inline client-side validation: a regex distinguishes "looks valid"
//     from "looks bogus" so the user gets red-border feedback instantly.
//     The authoritative validator runs server-side in `POST /deploy/new`,
//     so the regex stays intentionally simple (don't pretend to know IPv6
//     edge cases the API has to handle anyway).
//   - Max 32 entries — matches the backend cap (see Track A spec). The
//     input is disabled once the cap is reached and a hint reveals why.
//   - Disabled mode renders chips without × buttons and hides the input;
//     used by the read-only Pro+ surface on DeployDetailPage when the
//     PATCH endpoint isn't shipped yet.
//
// Stable test ids:
//   - `ip-allow-list`               root container
//   - `ip-allow-list-chip-<value>`  one per chip
//   - `ip-allow-list-chip-remove-<value>` remove button per chip
//   - `ip-allow-list-input`         the trailing input
//   - `ip-allow-list-error`         the inline error banner (when present)

import { useState, type KeyboardEvent } from 'react'

/** Hard cap matches the backend's `allowed_ips` array length limit
 *  (Track A: api/internal/handlers/deploy.go). Keeping the constant
 *  named instead of inlining the literal so a future bump is one edit. */
export const IP_ALLOW_LIST_MAX = 32

// Loose IPv4 + CIDR regex. The backend has the real validator; this is
// only here to give the user an inline red-border signal. We intentionally
// don't try to be exhaustive — e.g. 999.999.999.999 will pass this regex
// and get rejected at submit time, which is honest.
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(\/(\d|[12]\d|3[0-2]))?$/

// Permissive IPv6 form (presence of `:` plus hex chars). The agent API
// accepts IPv6 in `allowed_ips`; the regex stays lenient because IPv6
// address shorthand (`::1`, `2001:db8::/32`) has too many edge cases to
// fight in a regex.
const IPV6_RE = /^[0-9a-fA-F:]+(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/

/** True when the candidate string looks plausibly like an IPv4/CIDR or
 *  IPv6/CIDR. False is a "definitely wrong" signal — the inline error
 *  states "looks invalid" not "is invalid" so the user knows the server
 *  still has the final word. */
export function looksLikeIp(s: string): boolean {
  const v = s.trim()
  if (!v) return false
  if (IPV4_RE.test(v)) {
    // Reject octets > 255 — cheap extra signal so the chip doesn't turn
    // green on "300.300.300.300" before submit.
    const [addr] = v.split('/')
    const octets = addr.split('.').map((n) => Number(n))
    if (octets.length !== 4) return false
    return octets.every((n) => n >= 0 && n <= 255)
  }
  if (v.includes(':') && IPV6_RE.test(v)) return true
  return false
}

export interface IpAllowListProps {
  value: string[]
  onChange: (next: string[]) => void
  /** Read-only mode: hides the input and × buttons. Used by the disabled
   *  Pro+ surface on DeployDetailPage when PATCH isn't shipped yet. */
  disabled?: boolean
  /** Optional override for the placeholder copy. */
  placeholder?: string
}

export function IpAllowList({
  value,
  onChange,
  disabled = false,
  placeholder = 'Add 192.168.1.0/24 or 8.8.8.8',
}: IpAllowListProps) {
  const [pending, setPending] = useState('')
  const [error, setError] = useState<string | null>(null)

  const atCap = value.length >= IP_ALLOW_LIST_MAX

  function commit(raw: string) {
    const cleaned = raw.trim()
    if (!cleaned) return
    if (atCap) {
      setError(`Maximum ${IP_ALLOW_LIST_MAX} entries.`)
      return
    }
    if (value.includes(cleaned)) {
      // De-dupe silently — committing the same value twice is harmless.
      setPending('')
      setError(null)
      return
    }
    if (!looksLikeIp(cleaned)) {
      setError(`"${cleaned}" doesn't look like an IPv4/IPv6 address or CIDR.`)
      // Still commit — the backend has the real validator and the user
      // may know something the regex doesn't. The chip will render with
      // a red border so the bad state is obvious.
    } else {
      setError(null)
    }
    onChange([...value, cleaned])
    setPending('')
  }

  function remove(entry: string) {
    onChange(value.filter((x) => x !== entry))
    setError(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      // Stop the comma/space from being inserted into the input.
      e.preventDefault()
      commit(pending)
      return
    }
    if (e.key === 'Backspace' && pending === '' && value.length > 0) {
      // Backspace on empty input pops the last chip — standard tag-input
      // pattern. We don't prevent default; backspace has no other effect
      // when the input is empty.
      remove(value[value.length - 1])
    }
  }

  return (
    <div data-testid="ip-allow-list">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '8px 10px',
          minHeight: 38,
          alignItems: 'center',
          background: 'var(--surface, rgba(255,255,255,0.02))',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderRadius: 6,
        }}
      >
        {value.map((entry) => {
          const valid = looksLikeIp(entry)
          return (
            <span
              key={entry}
              data-testid={`ip-allow-list-chip-${entry}`}
              data-valid={valid ? 'true' : 'false'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px 2px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: valid ? 'var(--text)' : 'var(--red, #ff7a8a)',
                background: valid
                  ? 'rgba(255,255,255,0.04)'
                  : 'rgba(255,122,138,0.08)',
                border: valid
                  ? '1px solid rgba(255,255,255,0.1)'
                  : '1px solid rgba(255,122,138,0.4)',
                borderRadius: 4,
              }}
              title={valid ? entry : `${entry} — doesn't look valid; server will reject if so`}
            >
              {entry}
              {!disabled && (
                <button
                  type="button"
                  data-testid={`ip-allow-list-chip-remove-${entry}`}
                  aria-label={`Remove ${entry}`}
                  onClick={() => remove(entry)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </span>
          )
        })}
        {!disabled && (
          <input
            data-testid="ip-allow-list-input"
            type="text"
            value={pending}
            onChange={(e) => {
              setPending(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (pending.trim()) commit(pending)
            }}
            disabled={atCap}
            placeholder={
              atCap
                ? `Maximum ${IP_ALLOW_LIST_MAX} entries`
                : value.length === 0
                ? placeholder
                : ''
            }
            style={{
              flex: 1,
              minWidth: 140,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '2px 0',
            }}
          />
        )}
      </div>
      {error && (
        <div
          data-testid="ip-allow-list-error"
          role="alert"
          style={{
            marginTop: 6,
            fontSize: 11.5,
            color: 'var(--red, #ff7a8a)',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
      {!disabled && !error && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--text-faint)',
            lineHeight: 1.4,
          }}
        >
          {value.length}/{IP_ALLOW_LIST_MAX} entries · Enter, comma, or space
          to add · IPv4, IPv6, or CIDR
        </div>
      )}
    </div>
  )
}
