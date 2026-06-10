/* LoginCallbackPage.test.tsx — coverage for the OAuth/magic-link return
 * path. The page accepts EITHER (a) ?session_token=<jwt> [legacy URL
 * token, still used by some flows] OR (b) ?signed_in=1 [AUTH-004 cookie
 * exchange — JWT lives in an HttpOnly cookie on the api origin, page
 * POSTs /auth/exchange to retrieve it]. Either path: setToken, fetchMe,
 * navigate to /app (or saved return_to). On any failure: error state. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LoginCallbackPage } from './LoginCallbackPage'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    setToken: vi.fn(),
    fetchMe: vi.fn(),
    completeCliSession: vi.fn(() => Promise.resolve({ ok: true })),
  }
})

import * as api from '../api'

beforeEach(() => {
  vi.clearAllMocks()
  try { localStorage.clear() } catch {}
  ;(globalThis as any).fetch = vi.fn(() => Promise.reject(new Error('fetch not stubbed')))
})
afterEach(() => {
  cleanup()
  delete (globalThis as any).fetch
})

function renderCallback(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/login/callback${search}`]}>
      <Routes>
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/app" element={<div data-testid="app-landed">app</div>} />
        <Route path="/app/billing" element={<div data-testid="billing-landed">billing</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginCallbackPage', () => {
  it('shows error when both session_token and signed_in are missing', async () => {
    renderCallback('')
    await waitFor(() => expect(screen.getByText(/Sign-in failed/i)).toBeTruthy())
    expect(screen.getByText(/No session token in callback URL/i)).toBeTruthy()
  })

  it('verifies legacy ?session_token, navigates to /app on success', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderCallback('?session_token=abc')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())
    expect(api.setToken).toHaveBeenCalledWith('abc')
  })

  it('navigates to saved return_to when it starts with /app', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    localStorage.setItem('instanode.return_to', '/app/billing')
    renderCallback('?session_token=abc')
    await waitFor(() => expect(screen.getByTestId('billing-landed')).toBeTruthy())
    expect(localStorage.getItem('instanode.return_to')).toBeNull()
  })

  it('ignores return_to that does not start with /app', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    localStorage.setItem('instanode.return_to', '/external-evil')
    renderCallback('?session_token=abc')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())
  })

  it('surfaces fetchMe error', async () => {
    ;(api.fetchMe as any).mockRejectedValue(new Error('token rejected'))
    renderCallback('?session_token=bad')
    await waitFor(() => expect(screen.getByText(/Sign-in failed/i)).toBeTruthy())
    expect(screen.getByText(/token rejected/)).toBeTruthy()
  })

  it('falls back to default message on rejection without message', async () => {
    ;(api.fetchMe as any).mockRejectedValue({})
    renderCallback('?session_token=bad')
    await waitFor(() => expect(screen.getByText(/Session token rejected by the API/)).toBeTruthy())
  })

  // ---- AUTH-004 (cookie-exchange) flow ----

  it('AUTH-004: ?signed_in=1 → POSTs /auth/exchange with credentials:include + uses returned token', async () => {
    const fetchSpy = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(new Response(JSON.stringify({ token: 'xyz' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
    )
    ;(globalThis as any).fetch = fetchSpy
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })

    renderCallback('?signed_in=1')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit]
    expect(String(url)).toMatch(/\/auth\/exchange$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(api.setToken).toHaveBeenCalledWith('xyz')
    // Regression guard: NO custom request headers. A POST with only
    // safelisted headers + credentials:include is a "simple cross-origin
    // request" and avoids a CORS preflight. Adding Accept or Content-Type
    // would force an OPTIONS preflight that the api's PreflightAllowlist
    // rejects (those headers aren't in corsAllowHeaders), surfacing as
    // "Failed to fetch" in the browser.
    expect(init.headers).toBeUndefined()
  })

  it('AUTH-004: exchange non-2xx surfaces the api error message', async () => {
    ;(globalThis as any).fetch = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ ok: false, error: 'cookie_expired', message: 'exchange cookie expired' }),
      { status: 400, statusText: 'Bad Request', headers: { 'Content-Type': 'application/json' } },
    )))

    renderCallback('?signed_in=1')
    await waitFor(() => expect(screen.getByText(/Sign-in failed/i)).toBeTruthy())
    expect(screen.getByText(/Session exchange failed/)).toBeTruthy()
    expect(screen.getByText(/exchange cookie expired/)).toBeTruthy()
  })

  it('AUTH-004: exchange returning no token surfaces "no token" error', async () => {
    ;(globalThis as any).fetch = vi.fn(() => Promise.resolve(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    renderCallback('?signed_in=1')
    await waitFor(() => expect(screen.getByText(/Sign-in failed/i)).toBeTruthy())
    expect(screen.getByText(/Session exchange returned no token/)).toBeTruthy()
  })

  it('AUTH-004: exchange non-2xx with non-JSON body still surfaces status', async () => {
    ;(globalThis as any).fetch = vi.fn(() => Promise.resolve(new Response('<html>nginx error</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/html' },
    })))

    renderCallback('?signed_in=1')
    await waitFor(() => expect(screen.getByText(/Sign-in failed/i)).toBeTruthy())
    expect(screen.getByText(/502 Bad Gateway/)).toBeTruthy()
  })

  it('AUTH-004: signed_in=1 + legacy session_token both present → legacy wins (idempotent fallback)', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response('{}', { status: 200 })),
    )
    ;(globalThis as any).fetch = fetchSpy

    renderCallback('?signed_in=1&session_token=legacy123')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(api.setToken).toHaveBeenCalledWith('legacy123')
  })

  // ---- D2: CLI device-flow completion ----
  // When ?cli_session=<id> rides along on the callback, the page must POST
  // /auth/cli/{id}/complete (via completeCliSession) AFTER the session token
  // is stored + verified, then still navigate the browser user to /app.

  it('D2: completes the CLI session when ?cli_session is present, then navigates', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderCallback('?session_token=abc&cli_session=cli_123')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())
    expect(api.completeCliSession).toHaveBeenCalledTimes(1)
    expect(api.completeCliSession).toHaveBeenCalledWith('cli_123')
    // The session token is stored BEFORE the completion call so the api
    // gets the authenticated Bearer.
    expect(api.setToken).toHaveBeenCalledWith('abc')
  })

  it('D2: does NOT call completeCliSession when cli_session is absent', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderCallback('?session_token=abc')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())
    expect(api.completeCliSession).not.toHaveBeenCalled()
  })

  it('D2: a CLI-completion failure never blocks the user sign-in navigation', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    // completeCliSession is best-effort and swallows errors itself, but even
    // if it rejected, the browser user must still land on /app.
    ;(api.completeCliSession as any).mockResolvedValue({ ok: false })
    renderCallback('?session_token=abc&cli_session=cli_dead')
    await waitFor(() => expect(screen.getByTestId('app-landed')).toBeTruthy())
    expect(api.completeCliSession).toHaveBeenCalledWith('cli_dead')
  })
})
