/* TeamPage.test.tsx — defensive render coverage for the Team page.
 *
 * BugBash T15-P1-2 (2026-05-20) regression gate: the old
 * `(m.display_name ?? m.email)[0].toUpperCase()` expression crashed the entire
 * dashboard via ErrorBoundary when a member row arrived with `display_name:
 * null, email: ''`. `??` only catches null/undefined, so an empty-string
 * email survived the coalesce; `''[0]` is `undefined`; `.toUpperCase()`
 * threw at render time.
 *
 * These tests pin the defensive helpers (avatarInitial + memberDisplayName)
 * in place so any future regression on the indexed-access pattern fails CI
 * before reaching prod.
 */

import { describe, it, expect } from 'vitest'
import { avatarInitial, memberDisplayName } from './TeamPage'

describe('TeamPage avatarInitial — BugBash T15-P1-2 regression gate', () => {
  it('prefers the first character of display_name when present', () => {
    expect(avatarInitial('Aanya Patel', 'aanya@acme.dev')).toBe('A')
  })

  it('uppercases lowercase display_name initials', () => {
    expect(avatarInitial('aanya patel', 'aanya@acme.dev')).toBe('A')
  })

  it('falls back to email when display_name is null', () => {
    expect(avatarInitial(null, 'bobby@acme.dev')).toBe('B')
  })

  it('falls back to email when display_name is undefined', () => {
    expect(avatarInitial(undefined, 'cara@acme.dev')).toBe('C')
  })

  it('falls back to email when display_name is an empty string', () => {
    expect(avatarInitial('', 'dev@acme.dev')).toBe('D')
  })

  it('falls back to email when display_name is whitespace-only', () => {
    expect(avatarInitial('   ', 'eli@acme.dev')).toBe('E')
  })

  // ── the regression case that crashed render in prod ──
  it('returns "?" when display_name is null AND email is an empty string', () => {
    // Pre-fix this expression: `(null ?? '')[0].toUpperCase()` →
    // `(''[0]).toUpperCase()` → `undefined.toUpperCase()` → TypeError.
    expect(avatarInitial(null, '')).toBe('?')
  })

  it('returns "?" when display_name is null AND email is null', () => {
    expect(avatarInitial(null, null)).toBe('?')
  })

  it('returns "?" when display_name is undefined AND email is undefined', () => {
    expect(avatarInitial(undefined, undefined)).toBe('?')
  })

  it('returns "?" when both display_name and email are whitespace-only', () => {
    expect(avatarInitial('   ', '\t\n')).toBe('?')
  })
})

describe('TeamPage memberDisplayName — defensive row label', () => {
  it('returns trimmed display_name when present', () => {
    expect(memberDisplayName('Aanya Patel', 'aanya@acme.dev')).toBe('Aanya Patel')
  })

  it('returns email local-part when display_name is null', () => {
    expect(memberDisplayName(null, 'bobby@acme.dev')).toBe('bobby')
  })

  it('returns email local-part when display_name is empty', () => {
    expect(memberDisplayName('', 'cara@example.com')).toBe('cara')
  })

  it('returns the full email when there is no @ separator', () => {
    expect(memberDisplayName(null, 'plain-handle')).toBe('plain-handle')
  })

  // ── regression case ──
  it('returns em-dash when both display_name and email are blank', () => {
    // Renders a visible em-dash rather than a layout-glitch empty cell.
    expect(memberDisplayName(null, '')).toBe('—')
    expect(memberDisplayName('', null)).toBe('—')
    expect(memberDisplayName(undefined, undefined)).toBe('—')
  })
})
