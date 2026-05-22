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
})
