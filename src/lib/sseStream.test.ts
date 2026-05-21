/* sseStream.test.ts — coverage for the SSE-over-fetch consumer.
 *
 * Tests the parser by stubbing global.fetch with a ReadableStream of
 * encoded UTF-8 chunks, then asserting each onLine + onError + onClose
 * branch in turn.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { streamSSE, SSEStreamError } from './sseStream'
import { setToken, clearToken } from '../api'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(enc.encode(chunks[i++]))
    },
  })
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

describe('SSEStreamError', () => {
  it('carries the HTTP status', () => {
    const e = new SSEStreamError(404)
    expect(e.status).toBe(404)
    expect(e.name).toBe('SSEStreamError')
    expect(e.message).toBe('HTTP 404')
  })
})

describe('streamSSE', () => {
  beforeEach(() => {
    clearToken()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits onLine for each `data: <payload>` SSE line and calls onClose at end', async () => {
    const body = makeStream(['data: hello\n', 'data: world\n'])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body })
    ;(globalThis as any).fetch = fetchMock

    const lines: string[] = []
    const closed = new Promise<void>((resolve) => {
      streamSSE('/test', {
        onLine: (l) => lines.push(l),
        onClose: resolve,
      })
    })
    await closed
    expect(lines).toEqual(['hello', 'world'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('strips only ONE space after `data:` (spec-compliant)', async () => {
    const body = makeStream(['data:no-space\n', 'data:  two-spaces\n'])
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body })

    const lines: string[] = []
    await new Promise<void>((resolve) => {
      streamSSE('/x', { onLine: (l) => lines.push(l), onClose: resolve })
    })
    expect(lines).toEqual(['no-space', ' two-spaces'])
  })

  it('ignores non-data lines (event:, id:, blank)', async () => {
    const body = makeStream([
      'event: ping\n',
      ': comment\n',
      '\n',
      'data: keeper\n',
    ])
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body })

    const lines: string[] = []
    await new Promise<void>((resolve) => {
      streamSSE('/x', { onLine: (l) => lines.push(l), onClose: resolve })
    })
    expect(lines).toEqual(['keeper'])
  })

  it('on non-OK response, calls onError with SSEStreamError + onClose', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, body: null })

    let err: unknown = null
    let closed = false
    await new Promise<void>((resolve) => {
      streamSSE('/bad', {
        onLine: () => {},
        onError: (e) => { err = e },
        onClose: () => { closed = true; resolve() },
      })
    })
    expect(err).toBeInstanceOf(SSEStreamError)
    expect((err as SSEStreamError).status).toBe(503)
    expect(closed).toBe(true)
  })

  it('on 401 mid-open, still surfaces SSEStreamError(401)', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, body: null })

    let err: unknown = null
    await new Promise<void>((resolve) => {
      streamSSE('/auth', {
        onLine: () => {},
        onError: (e) => { err = e },
        onClose: resolve,
      })
    })
    expect((err as SSEStreamError).status).toBe(401)
  })

  it('on thrown fetch (e.g. network error), calls onError + onClose', async () => {
    ;(globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('network down'))

    let err: unknown = null
    let closed = false
    await new Promise<void>((resolve) => {
      streamSSE('/x', {
        onLine: () => {},
        onError: (e) => { err = e },
        onClose: () => { closed = true; resolve() },
      })
    })
    expect((err as Error).message).toBe('network down')
    expect(closed).toBe(true)
  })

  it('suppresses AbortError so the caller does not see spurious errors', async () => {
    const ab = new Error('abort')
    ab.name = 'AbortError'
    ;(globalThis as any).fetch = vi.fn().mockRejectedValue(ab)

    const errors: unknown[] = []
    let closed = false
    await new Promise<void>((resolve) => {
      streamSSE('/x', {
        onLine: () => {},
        onError: (e) => errors.push(e),
        onClose: () => { closed = true; resolve() },
      })
    })
    expect(errors).toEqual([])
    expect(closed).toBe(true)
  })

  it('attaches Authorization header when a token is set', async () => {
    setToken('test-bearer-123')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: makeStream([]) })
    ;(globalThis as any).fetch = fetchMock

    await new Promise<void>((resolve) => {
      streamSSE('/x', { onLine: () => {}, onClose: resolve })
    })
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers.Authorization).toBe('Bearer test-bearer-123')
    expect(opts.headers.Accept).toBe('text/event-stream')
    clearToken()
  })

  it('does NOT attach Authorization header when no token is set', async () => {
    clearToken()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: makeStream([]) })
    ;(globalThis as any).fetch = fetchMock

    await new Promise<void>((resolve) => {
      streamSSE('/x', { onLine: () => {}, onClose: resolve })
    })
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers.Authorization).toBeUndefined()
  })

  it('returns a cleanup function that aborts the AbortController', async () => {
    // No need to await — just verify the callable contract.
    ;(globalThis as any).fetch = vi.fn(() => new Promise(() => {}))
    const cleanup = streamSSE('/x', { onLine: () => {} })
    expect(typeof cleanup).toBe('function')
    cleanup() // does not throw
    await flush()
  })

  it('honors an external AbortSignal — aborting it aborts the compound', async () => {
    ;(globalThis as any).fetch = vi.fn(() => new Promise(() => {}))
    const ctl = new AbortController()
    const cleanup = streamSSE('/x', { onLine: () => {} }, ctl.signal)
    expect(typeof cleanup).toBe('function')
    ctl.abort()
    // Just verify no throw + cleanup still callable.
    cleanup()
    await flush()
  })
})
