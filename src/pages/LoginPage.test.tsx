/* LoginPage.test.tsx — sign-in surface: GitHub OAuth, magic-link, PAT. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LoginPage } from './LoginPage'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    setToken: vi.fn(),
    clearToken: vi.fn(),
    fetchMe: vi.fn(),
  }
})

import * as api from '../api'

function renderAt(url = '/login') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<div>APP HOME</div>} />
        {/* BUG-P013 round-trip route — when /login?next=/app/checkout?…
            preserves the plan + frequency, post-signin must land here. */}
        <Route path="/app/checkout" element={<div>CHECKOUT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const originalHref = window.location.href

beforeEach(() => {
  vi.clearAllMocks()
  // stub fetch for magic-link
  ;(globalThis as any).fetch = vi.fn()
  // stub location.href setter
  delete (window as any).location
  ;(window as any).location = { href: originalHref, origin: 'http://localhost', search: '' }
})
afterEach(() => {
  cleanup()
})

describe('LoginPage', () => {
  it('renders the GitHub OAuth button and triggers redirect', async () => {
    renderAt()
    const btn = screen.getByTestId('oauth-github')
    await userEvent.click(btn)
    expect(window.location.href).toContain('/auth/github/start?return_to=')
  })

  it('shows session-expired banner when ?session_expired=1', () => {
    ;(window as any).location.search = '?session_expired=1'
    renderAt()
    expect(screen.getByTestId('session-expired-banner')).toBeTruthy()
  })

  it('validates email before sending magic link', async () => {
    renderAt()
    const input = screen.getByTestId('email-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'notanemail' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(screen.getByTestId('email-error').textContent).toContain('valid email'))
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })

  it('sends a magic link and shows the sent confirmation', async () => {
    ;(globalThis as any).fetch.mockResolvedValue({ status: 202 })
    renderAt()
    await userEvent.type(screen.getByTestId('email-input'), 'founder@acme.dev')
    await userEvent.click(screen.getByTestId('email-submit'))
    await waitFor(() => expect(screen.getByTestId('magic-link-sent')).toBeTruthy())
    expect(screen.getByTestId('magic-link-sent').textContent).toContain('founder@acme.dev')
  })

  it('surfaces a magic-link API error', async () => {
    ;(globalThis as any).fetch.mockResolvedValue({
      status: 500,
      json: async () => ({ message: 'server boom' }),
    })
    renderAt()
    await userEvent.type(screen.getByTestId('email-input'), 'founder@acme.dev')
    await userEvent.click(screen.getByTestId('email-submit'))
    await waitFor(() => expect(screen.getByTestId('email-error').textContent).toContain('server boom'))
  })

  it('toggles the PAT token form', async () => {
    renderAt()
    expect(screen.queryByTestId('token-input')).toBeNull()
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    expect(screen.getByTestId('token-input')).toBeTruthy()
  })

  it('requires a token before submitting the PAT form', async () => {
    renderAt()
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.click(screen.getByTestId('login-submit'))
    expect(screen.getByTestId('login-error').textContent).toContain('Paste a Personal Access Token')
  })

  it('logs in with a valid PAT and navigates to /app', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderAt()
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_secret')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeTruthy())
    expect(api.setToken).toHaveBeenCalledWith('ink_secret')
  })

  it('shows a 401 rejection message and clears the token', async () => {
    ;(api.fetchMe as any).mockRejectedValue({ status: 401 })
    renderAt()
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_bad')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByTestId('login-error').textContent).toContain('Token rejected'))
    expect(api.clearToken).toHaveBeenCalled()
  })

  it('shows a generic error for non-401 failures', async () => {
    ;(api.fetchMe as any).mockRejectedValue({ message: 'network down' })
    renderAt()
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_x')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByTestId('login-error').textContent).toContain('network down'))
  })

  // BUG-P013 (P1, 2026-05-29) — PAT signin with ?next=/app/checkout?... must
  // round-trip the user back to the checkout page they were on, NOT the
  // generic /app dashboard. The CheckoutPage's BUG-P111 fix calls
  // window.location.assign('/login?next=…') which drops React Router
  // state, so LoginPage MUST read the query param.
  it('honors ?next= and round-trips to /app/checkout after PAT signin', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    ;(window as any).location.search = '?next=%2Fapp%2Fcheckout%3Fplan%3Dhobby%26frequency%3Dmonthly'
    renderAt('/login?next=%2Fapp%2Fcheckout%3Fplan%3Dhobby%26frequency%3Dmonthly')
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_secret')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByText('CHECKOUT PAGE')).toBeTruthy())
  })

  // Open-redirect safety — never honour an absolute external URL even
  // if a phishing link drops it into ?next=.
  it('rejects ?next=https://evil.com and falls back to /app', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    ;(window as any).location.search = '?next=https%3A%2F%2Fevil.com'
    renderAt('/login?next=https%3A%2F%2Fevil.com')
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_secret')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeTruthy())
  })

  // Protocol-relative URLs are equally dangerous (//evil.com → browser
  // treats as scheme-inherit absolute). Reject those too.
  it('rejects protocol-relative ?next=//evil.com and falls back to /app', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    ;(window as any).location.search = '?next=%2F%2Fevil.com'
    renderAt('/login?next=%2F%2Fevil.com')
    await userEvent.click(screen.getByTestId('toggle-token-form'))
    await userEvent.type(screen.getByTestId('token-input'), 'ink_secret')
    await userEvent.click(screen.getByTestId('login-submit'))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeTruthy())
  })
})

// ─── F4: magic-link "sent" state is NOT a silent dead-end ────────────────
// Email delivery is 100%-failing (Brevo sender unvalidated, CLAUDE.md P0),
// so the "check your inbox" confirmation must offer a way out: a Resend
// affordance + a GitHub-OAuth fallback to the one working auth path.
describe('LoginPage — F4 magic-link recovery affordances', () => {
  async function reachSentState() {
    ;(globalThis as any).fetch.mockResolvedValue({ status: 202 })
    renderAt()
    await userEvent.type(screen.getByTestId('email-input'), 'founder@acme.dev')
    await userEvent.click(screen.getByTestId('email-submit'))
    await waitFor(() => expect(screen.getByTestId('magic-link-sent')).toBeTruthy())
  }

  it('renders the Resend control in the sent state', async () => {
    await reachSentState()
    expect(screen.getByTestId('magic-link-resend')).toBeTruthy()
  })

  it('renders the GitHub-OAuth fallback control in the sent state', async () => {
    await reachSentState()
    expect(screen.getByTestId('magic-link-github-fallback')).toBeTruthy()
  })

  it('clicking Resend re-POSTs /auth/email/start', async () => {
    await reachSentState()
    // First send already happened (1 call). Click resend → second call.
    ;(globalThis as any).fetch.mockClear()
    ;(globalThis as any).fetch.mockResolvedValue({ status: 202 })
    await userEvent.click(screen.getByTestId('magic-link-resend'))
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (globalThis as any).fetch.mock.calls[0]
    expect(String(url)).toContain('/auth/email/start')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).email).toBe('founder@acme.dev')
  })

  it('clicking the GitHub fallback triggers the OAuth redirect', async () => {
    await reachSentState()
    await userEvent.click(screen.getByTestId('magic-link-github-fallback'))
    expect(window.location.href).toContain('/auth/github/start?return_to=')
  })

  it('surfaces a resend error inline without leaving the sent state', async () => {
    await reachSentState()
    ;(globalThis as any).fetch.mockClear()
    ;(globalThis as any).fetch.mockResolvedValue({
      status: 500,
      json: async () => ({ message: 'relay down' }),
    })
    await userEvent.click(screen.getByTestId('magic-link-resend'))
    await waitFor(() =>
      expect(screen.getByTestId('magic-link-resend-error').textContent).toContain('relay down'),
    )
    // Still in the sent state — the recovery controls remain available.
    expect(screen.getByTestId('magic-link-github-fallback')).toBeTruthy()
  })
})

// ─── D2: cli_session is preserved through the auth round-trip ────────────
// /login?cli_session=<id> must forward the id through the OAuth + magic-link
// return_to so LoginCallbackPage can POST /auth/cli/{id}/complete after
// sign-in. Before this, App.tsx forwarded the param to /login then dropped
// it, and the CLI device-flow never completed from the web side.
describe('LoginPage — D2 cli_session preservation', () => {
  it('appends ?cli_session=<id> to the GitHub OAuth return_to', async () => {
    ;(window as any).location.search = '?cli_session=sess_abc'
    renderAt('/login?cli_session=sess_abc')
    await userEvent.click(screen.getByTestId('oauth-github'))
    // return_to is URL-encoded once on the way into the github/start URL.
    const href = decodeURIComponent(window.location.href)
    expect(href).toContain('/login/callback?cli_session=sess_abc')
  })

  it('appends cli_session to the magic-link return_to', async () => {
    ;(window as any).location.search = '?cli_session=sess_xyz'
    ;(globalThis as any).fetch.mockResolvedValue({ status: 202 })
    renderAt('/login?cli_session=sess_xyz')
    await userEvent.type(screen.getByTestId('email-input'), 'founder@acme.dev')
    await userEvent.click(screen.getByTestId('email-submit'))
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalled())
    const [, init] = (globalThis as any).fetch.mock.calls[0]
    expect(JSON.parse(init.body).return_to).toContain('/login/callback?cli_session=sess_xyz')
  })

  it('omits cli_session from return_to when absent', async () => {
    renderAt()
    await userEvent.click(screen.getByTestId('oauth-github'))
    const href = decodeURIComponent(window.location.href)
    expect(href).toContain('/login/callback')
    expect(href).not.toContain('cli_session')
  })
})
