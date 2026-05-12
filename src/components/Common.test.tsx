/* Common.test.tsx — unit tests for shared component helpers.
 *
 * Currently focused on the clipboard helper (§10.10). The helper has two
 * paths: the modern async Clipboard API and the legacy execCommand
 * fallback for HTTP origins / older Safari. We verify both paths and the
 * total-failure case so the v1 console.warn surface in callers is the
 * only thing surfacing the miss.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard } from './Common'

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
