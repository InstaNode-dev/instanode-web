/* ContractsPage.test.tsx — static API-contract inventory page. */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ContractsPage } from './ContractsPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <ContractsPage />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('ContractsPage', () => {
  it('renders the page heading', () => {
    renderPage()
    expect(screen.getByText('API contracts & gaps')).toBeTruthy()
  })

  it('renders the four summary stats', () => {
    renderPage()
    expect(screen.getByText('locked')).toBeTruthy()
    expect(screen.getByText('blocked')).toBeTruthy()
    expect(screen.getByText('needs lock')).toBeTruthy()
    expect(screen.getByText('delegated')).toBeTruthy()
  })

  it('lists representative endpoint contract lines', () => {
    renderPage()
    expect(screen.getByText('/api/v1/resources')).toBeTruthy()
    expect(screen.getByText('/api/v1/billing/checkout')).toBeTruthy()
  })

  it('surfaces the agent-api delegated section', () => {
    renderPage()
    expect(
      screen.getByText(/Anonymous calls, claim, healthz live on/i),
    ).toBeTruthy()
  })
})
