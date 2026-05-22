/* LoginCallbackPage.test.tsx — OAuth/magic-link session-token callback. */

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
  }
})

import * as api from '../api'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route path="/app" element={<div>APP HOME</div>} />
        <Route path="/app/team" element={<div>TEAM PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  try { localStorage.clear() } catch {}
})
afterEach(() => cleanup())

describe('LoginCallbackPage', () => {
  it('shows the verifying state initially', () => {
    ;(api.fetchMe as any).mockReturnValue(new Promise(() => {}))
    renderAt('/login/callback?session_token=tok_abc')
    expect(screen.getByText('Signing you in.')).toBeTruthy()
    expect(api.setToken).toHaveBeenCalledWith('tok_abc')
  })

  it('errors when no session_token is present', () => {
    renderAt('/login/callback')
    expect(screen.getByText('Sign-in failed.')).toBeTruthy()
    expect(screen.getByText('No session token in callback URL.')).toBeTruthy()
    const retry = document.querySelector('a[href="/login"]')
    expect(retry).toBeTruthy()
  })

  it('navigates to /app on successful verification', async () => {
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderAt('/login/callback?session_token=tok_ok')
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeTruthy())
  })

  it('honors a stored /app return_to destination', async () => {
    localStorage.setItem('instanode.return_to', '/app/team')
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderAt('/login/callback?session_token=tok_ok')
    await waitFor(() => expect(screen.getByText('TEAM PAGE')).toBeTruthy())
    expect(localStorage.getItem('instanode.return_to')).toBeNull()
  })

  it('ignores a non-/app return_to and defaults to /app', async () => {
    localStorage.setItem('instanode.return_to', 'https://evil.example/phish')
    ;(api.fetchMe as any).mockResolvedValue({ ok: true })
    renderAt('/login/callback?session_token=tok_ok')
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeTruthy())
  })

  it('surfaces a rejected token as an error', async () => {
    ;(api.fetchMe as any).mockRejectedValue(new Error('token bad'))
    renderAt('/login/callback?session_token=tok_bad')
    await waitFor(() => expect(screen.getByText('Sign-in failed.')).toBeTruthy())
    expect(screen.getByText('token bad')).toBeTruthy()
  })
})
