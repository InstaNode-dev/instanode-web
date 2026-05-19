// Minimal SSE consumer over fetch+ReadableStream so we can pass a Bearer token.
// Yields one line at a time as the stream arrives. Caller decides what to do
// with each line (parse JSON, append to a log buffer, etc.).
//
// Why fetch instead of EventSource:
// The browser's EventSource API does not allow setting custom headers (notably
// Authorization), so cross-origin streams from GitHub Pages → api.instanode.dev
// can't authenticate that way. Fetch + ReadableStream lets us send the bearer
// token while keeping a tiny SSE-compatible parser inline.
import { getAPIBaseURL, getToken, handle401 } from '../api'

// SSEStreamError — carries the HTTP status of a failed stream open so the
// caller can distinguish an expired session (401) from a genuine
// "stream not available" (404 / 5xx). A bare Error('HTTP 401') previously
// made every failure render the same misleading "deploy too old" copy.
export class SSEStreamError extends Error {
  status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'SSEStreamError'
    this.status = status
  }
}

export type SSEHandlers = {
  onLine: (line: string) => void
  onError?: (err: unknown) => void
  onClose?: () => void
}

export function streamSSE(path: string, handlers: SSEHandlers, signal?: AbortSignal): () => void {
  const url = (getAPIBaseURL() || window.location.origin) + path
  const ctl = new AbortController()
  const compoundSignal = signal
    ? new AbortController()
    : ctl
  if (signal) signal.addEventListener('abort', () => compoundSignal.abort())

  ;(async () => {
    try {
      const tok = getToken()
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (tok) headers['Authorization'] = `Bearer ${tok}`
      const res = await fetch(url, { headers, signal: compoundSignal.signal })
      if (!res.ok) {
        // A 401 mid-stream means the bearer token expired. Run the same
        // token-clear + (if inside /app) /login redirect that the central
        // fetch interceptor does, so the user isn't stranded on a dead
        // "stream unavailable" panel with an invalid session.
        if (res.status === 401) handle401(res.status)
        handlers.onError?.(new SSEStreamError(res.status))
        handlers.onClose?.()
        return
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, nl).trimEnd()
          buffer = buffer.slice(nl + 1)
          // SSE lines look like: `data: <payload>` (or empty between events).
          if (raw.startsWith('data: ')) {
            handlers.onLine(raw.slice(6))
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') handlers.onError?.(e)
    } finally {
      handlers.onClose?.()
    }
  })()

  // Return a cleanup that aborts the stream.
  return () => compoundSignal.abort()
}
