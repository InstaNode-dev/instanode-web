/* IncidentsPage.test.tsx — public incident log: loading/empty/active/resolved. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { IncidentsPage, fetchIncidents, type Incident } from './IncidentsPage'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, getAPIBaseURL: vi.fn(() => '') }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <IncidentsPage />
    </MemoryRouter>,
  )
}

const ACTIVE: Incident = {
  id: 'inc_1', title: 'Postgres provisioning slow', severity: 'major',
  state: 'investigating', started_at: '2026-05-22T00:00:00Z', resolved_at: null,
  summary: 'New /db/new calls are queueing.',
}
const RESOLVED: Incident = {
  id: 'inc_2', title: 'Redis latency spike', severity: 'minor',
  state: 'resolved', started_at: '2026-05-20T00:00:00Z', resolved_at: '2026-05-20T01:00:00Z',
  summary: 'Resolved after node restart.',
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('IncidentsPage', () => {
  it('shows a loading state before data resolves', () => {
    ;(globalThis as any).fetch = vi.fn(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('incidents-loading')).toBeTruthy()
  })

  it('shows the empty state when no incidents exist', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, items: [] }),
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('incidents-empty')).toBeTruthy())
  })

  it('renders active and resolved incident sections', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, items: [ACTIVE, RESOLVED] }),
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('incidents-active')).toBeTruthy())
    expect(screen.getByTestId('incidents-resolved')).toBeTruthy()
    expect(screen.getByText('Postgres provisioning slow')).toBeTruthy()
    expect(screen.getByText('Redis latency spike')).toBeTruthy()
  })

  it('renders only active section when nothing is resolved', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, items: [ACTIVE] }),
    })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('incidents-active')).toBeTruthy())
    expect(screen.queryByTestId('incidents-resolved')).toBeNull()
  })
})

describe('fetchIncidents', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns [] on a non-ok response', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false })
    expect(await fetchIncidents()).toEqual([])
  })

  it('returns [] on a fetch throw', async () => {
    ;(globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('net'))
    expect(await fetchIncidents()).toEqual([])
  })

  it('returns [] when body has no items array', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true }),
    })
    expect(await fetchIncidents()).toEqual([])
  })

  it('returns items when the body is well-formed', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ok: true, items: [ACTIVE] }),
    })
    const out = await fetchIncidents()
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('inc_1')
  })

  it('returns [] when json parsing throws', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => { throw new Error('bad json') },
    })
    expect(await fetchIncidents()).toEqual([])
  })
})
