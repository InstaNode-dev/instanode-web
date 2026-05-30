/* Common.test.tsx — unit tests for shared component helpers.
 *
 * Currently focused on the clipboard helper (§10.10). The helper has two
 * paths: the modern async Clipboard API and the legacy execCommand
 * fallback for HTTP origins / older Safari. We verify both paths and the
 * total-failure case so the v1 console.warn surface in callers is the
 * only thing surfacing the miss.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { copyToClipboard, displayName, isUnnamed, ResourceIcon } from './Common'
import { RESOURCE_TYPES } from '../api/types'
import { CREDENTIALED_RESOURCE_TYPES } from '../api'

describe('displayName / isUnnamed — mandatory-name fallback', () => {
  it('returns the name verbatim when present', () => {
    expect(displayName('my-app-db', 'postgres')).toBe('my-app-db')
    expect(isUnnamed('my-app-db')).toBe(false)
  })

  it('falls back to "(unnamed <type>)" for null / empty / whitespace names', () => {
    expect(displayName(null, 'postgres')).toBe('(unnamed postgres)')
    expect(displayName(undefined, 'redis')).toBe('(unnamed redis)')
    expect(displayName('', 'deploy')).toBe('(unnamed deploy)')
    expect(displayName('   ', 'mongodb')).toBe('(unnamed mongodb)')
  })

  it('falls back to bare "(unnamed)" when no type is supplied', () => {
    expect(displayName(null)).toBe('(unnamed)')
    expect(displayName('')).toBe('(unnamed)')
  })

  it('isUnnamed reports true only for blank names', () => {
    expect(isUnnamed(null)).toBe(true)
    expect(isUnnamed(undefined)).toBe(true)
    expect(isUnnamed('')).toBe(true)
    expect(isUnnamed('  ')).toBe(true)
    expect(isUnnamed('x')).toBe(false)
  })

  it('trims surrounding whitespace from real names', () => {
    expect(displayName('  spaced  ', 'postgres')).toBe('spaced')
  })
})

// Registry-iterating regression: every wire `resource_type` must have a
// real icon class on ResourceIcon AND an explicit decision (in or out) in
// CREDENTIALED_RESOURCE_TYPES. The bug we're guarding: when /vector/new
// shipped on 2026-05-20, the dashboard's typed surface forgot to add
// 'vector' to ResourceType — the icon rendered as `undefined res-name-ico`
// and the detail page silently skipped the credentials fetch, so vector
// users could never see their connection_url. Iterating the registry (vs
// hand-typing a list of cases) means a future POST /foo/new added to
// RESOURCE_TYPES auto-fails the icon test until the map is updated.
describe('ResourceIcon — every ResourceType has a non-empty icon class', () => {
  for (const type of RESOURCE_TYPES) {
    it(`renders a real ico-* class for resource_type="${type}"`, () => {
      const { container } = render(<ResourceIcon type={type} />)
      const span = container.querySelector('span')
      expect(span).not.toBeNull()
      const cls = span?.getAttribute('class') ?? ''
      // Must include a registered ico-* prefix — `undefined` slips
      // through when the map entry is missing, so guard explicitly.
      expect(cls).not.toContain('undefined')
      expect(/\bico-[a-z]{2,}\b/.test(cls)).toBe(true)
    })
  }
})

describe('CREDENTIALED_RESOURCE_TYPES — coverage check', () => {
  it('every wire resource_type has an explicit in/out decision', () => {
    // The set is small enough that an inverted list is the readable form.
    // If a new ResourceType is added, this test forces the author to make
    // an explicit decision: either add it to CREDENTIALED_RESOURCE_TYPES
    // (db-shaped resources where /credentials returns connection_url) or
    // update NON_CREDENTIALED below (webhook/storage/queue/deploy where
    // /credentials 400s — see BugBash P3-02).
    const NON_CREDENTIALED: ReadonlySet<string> = new Set([
      'queue',
      'storage',
      'webhook',
      'deploy',
    ])
    for (const type of RESOURCE_TYPES) {
      const isCredentialed = CREDENTIALED_RESOURCE_TYPES.has(type)
      const isNonCredentialed = NON_CREDENTIALED.has(type)
      expect(
        isCredentialed !== isNonCredentialed,
        `resource_type="${type}" must appear in exactly one of CREDENTIALED_RESOURCE_TYPES or the test's NON_CREDENTIALED list`,
      ).toBe(true)
    }
  })

  it('vector is wired into the credentialed set (regression guard for 2026-05-30)', () => {
    // Standalone marker: the bug surface was specifically vector being
    // dropped. Leaving an explicit assertion makes a future revert
    // surface in the test name, not just a count change.
    expect(CREDENTIALED_RESOURCE_TYPES.has('vector')).toBe(true)
  })
})

describe('copyToClipboard', () => {
  let originalClipboardDescriptor: PropertyDescriptor | undefined
  let originalExecCommand: typeof document.execCommand

  beforeEach(() => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    originalExecCommand = document.execCommand
  })

  afterEach(() => {
    // Restore the original clipboard descriptor (or remove if there
    // wasn't one). jsdom's default is no clipboard, so just leaving the
    // mock would leak into other test files.
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
    } else {
      try { delete (navigator as any).clipboard } catch { /* ignore */ }
    }
    document.execCommand = originalExecCommand
  })

  it('uses navigator.clipboard.writeText on the happy path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const ok = await copyToClipboard('hello')
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when navigator.clipboard.writeText throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand as unknown as typeof document.execCommand

    const ok = await copyToClipboard('fallback-text')
    expect(ok).toBe(true)
    // Modern path was attempted...
    expect(writeText).toHaveBeenCalledTimes(1)
    // ...and the legacy path ran after it threw.
    expect(execCommand).toHaveBeenCalledWith('copy')
    // The transient textarea must be cleaned up so we don't leak DOM.
    expect(document.querySelectorAll('textarea').length).toBe(0)
  })

  it('uses the execCommand fallback when navigator.clipboard is missing entirely', async () => {
    // Simulate HTTP origin / locked-down browser: no clipboard at all.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    const execCommand = vi.fn().mockReturnValue(true)
    document.execCommand = execCommand as unknown as typeof document.execCommand

    const ok = await copyToClipboard('no-clipboard')
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('returns false when both paths fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    document.execCommand = (() => { throw new Error('execCommand denied') }) as unknown as typeof document.execCommand

    const ok = await copyToClipboard('nope')
    expect(ok).toBe(false)
  })

  it('returns false (not throws) when execCommand returns false', async () => {
    // Some browsers refuse silently — execCommand returns false rather
    // than throwing. The helper must propagate that as `false`.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false) as unknown as typeof document.execCommand

    const ok = await copyToClipboard('refused')
    expect(ok).toBe(false)
  })
})
