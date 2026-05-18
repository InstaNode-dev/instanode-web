// Minimal SSE consumer over fetch+ReadableStream so we can pass a Bearer token.
// Yields one line at a time as the stream arrives. Caller decides what to do
// with each line (parse JSON, append to a log buffer, etc.).
//
// Why fetch instead of EventSource:
// The browser's EventSource API does not allow setting custom headers (notably
// Authorization), so cross-origin streams from GitHub Pages → api.instanode.dev
// can't authenticate that way. Fetch + ReadableStream lets us send the bearer
// token while keeping a tiny SSE-compatible parser inline.
import { getAPIBaseURL, getToken } from '../api'

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
        handlers.onError?.(new Error(`HTTP ${res.status}`))
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
          // SSE lines look like `data: <payload>` (or empty between
          // events). BugBash P3: the spec (WHATWG, EventSource §9.2.6)
          // makes the single space after the colon OPTIONAL — a server
          // emitting `data:<payload>` (no space) is conformant. The old
          // `startsWith('data: ')` check silently dropped every
          // no-space line. Match the `data:` prefix and strip at most
          // one leading space from the value, per the spec.
          if (raw.startsWith('data:')) {
            let value = raw.slice(5)
            if (value.startsWith(' ')) value = value.slice(1)
            handlers.onLine(value)
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
