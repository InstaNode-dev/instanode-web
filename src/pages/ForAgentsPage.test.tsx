/* ForAgentsPage.test.tsx — agent integration page: cards, copy, highlighters. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const copyMock = vi.fn()
vi.mock('../components/Common', async () => {
  const actual = await vi.importActual<typeof import('../components/Common')>('../components/Common')
  return { ...actual, copyToClipboard: (...args: any[]) => copyMock(...args) }
})

import { ForAgentsPage } from './ForAgentsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <ForAgentsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})
afterEach(() => cleanup())

describe('ForAgentsPage', () => {
  it('renders the hero and three integration cards', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Built for agents')
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText('Cursor')).toBeTruthy()
    expect(screen.getByText('MCP server config')).toBeTruthy()
  })

  it('renders the openapi CTA link', () => {
    renderPage()
    const cta = document.querySelector('a.fa-final-cta[href="https://api.instanode.dev/openapi.json"]')
    expect(cta).toBeTruthy()
  })

  it('copies the command and flips the button label to "copied"', async () => {
    copyMock.mockResolvedValue(true)
    renderPage()
    const btn = screen.getByLabelText('Copy Claude Code command')
    expect(btn.textContent).toBe('copy')
    await userEvent.click(btn)
    expect(copyMock).toHaveBeenCalled()
    await waitFor(() => expect(btn.textContent).toBe('copied'))
  })

  it('leaves the label as "copy" when clipboard is unavailable', async () => {
    copyMock.mockResolvedValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPage()
    const btn = screen.getByLabelText('Copy Cursor command')
    await userEvent.click(btn)
    expect(btn.textContent).toBe('copy')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('reverts "copied" back to "copy" after the timeout', async () => {
    copyMock.mockResolvedValue(true)
    renderPage()
    const btn = screen.getByLabelText('Copy Claude Code command')
    await userEvent.click(btn)
    await waitFor(() => expect(btn.textContent).toBe('copied'))
    // setTimeout(1600) reverts the label.
    await waitFor(() => expect(btn.textContent).toBe('copy'), { timeout: 3000 })
  })

  it('syntax-highlights shell and JSON commands (renders code spans)', () => {
    renderPage()
    // JSON highlighter should produce key spans for the MCP config card.
    expect(document.querySelector('.c-key')).toBeTruthy()
    // Shell highlighter should produce flag/str spans for the curl playground.
    expect(document.querySelector('.c-flag, .c-str')).toBeTruthy()
  })
})
