/* StackCreatePage.extra.test.tsx — coverage supplement.
 *
 * The sibling StackCreatePage.test.tsx drives tier wall / validation /
 * submit / polling / errors. This file covers the two remaining branches:
 * the success-panel copy-URL button (copyToClipboard happy path) and the
 * formatBytes GB branch (an oversized >1GB tarball). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, createStack: vi.fn(), fetchStackStatus: vi.fn() }
})

vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: { user: { id: 'u', email: 'me@test', tier: 'hobby', team_id: 't', created_at: '' }, team: { id: 't', slug: 't', name: 't', owner_id: 'u', member_count: 1, tier: 'hobby', created_at: '' } },
    meErr: null, meLoading: false, env: 'production', envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 }, resources: [], billing: null, billingLoading: false,
  }),
}))

vi.mock('../components/Common', async () => {
  const actual = await vi.importActual<typeof import('../components/Common')>('../components/Common')
  return { ...actual, copyToClipboard: vi.fn() }
})

import { StackCreatePage } from './StackCreatePage'
import * as api from '../api'
import * as common from '../components/Common'

const createStack = api.createStack as unknown as ReturnType<typeof vi.fn>
const fetchStackStatus = api.fetchStackStatus as unknown as ReturnType<typeof vi.fn>
const copyToClipboard = common.copyToClipboard as unknown as ReturnType<typeof vi.fn>

function makeFile(name: string, sizeBytes: number): File {
  const f = new File([new ArrayBuffer(8)], name, { type: 'application/gzip' })
  // Override .size so we can test the >1GB formatBytes branch without
  // allocating gigabytes.
  Object.defineProperty(f, 'size', { value: sizeBytes })
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  copyToClipboard.mockResolvedValue(true)
})
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('StackCreatePage — success panel copy', () => {
  it('copies the live URL and flips the button label', async () => {
    createStack.mockResolvedValueOnce({ ok: true, stack: { slug: 'sunny-7', status: 'building', url: null } })
    fetchStackStatus.mockResolvedValue({
      ok: true,
      stack: { id: 'sunny-7', slug: 'sunny-7', name: '', status: 'running', url: 'https://sunny-7.deployment.instanode.dev', created_at: '', team_id: '', env: 'production', tier: 'hobby' },
    })
    render(<MemoryRouter><StackCreatePage /></MemoryRouter>)
    fireEvent.change(screen.getByTestId('stack-create-file'), { target: { files: [makeFile('a.tar.gz', 100)] } })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'sunny-7' } })
    await act(async () => { fireEvent.click(screen.getByTestId('stack-create-submit')) })
    await waitFor(() => expect(screen.getByTestId('stack-create-live')).toBeTruthy(), { timeout: 4500 })

    fireEvent.click(screen.getByTestId('stack-create-copy-url'))
    await waitFor(() => expect(screen.getByText(/copied/)).toBeTruthy())
    expect(copyToClipboard).toHaveBeenCalledWith('https://sunny-7.deployment.instanode.dev')
  })
})

describe('StackCreatePage — env-var row removal', () => {
  it('removes an env-var row, and resets to a single empty row when the last is removed', () => {
    render(<MemoryRouter><StackCreatePage /></MemoryRouter>)
    // One row exists by default. Add a second.
    fireEvent.click(screen.getByTestId('stack-create-envvar-add'))
    expect(screen.getByTestId('stack-create-envvar-row-1')).toBeTruthy()
    // Remove the second row.
    fireEvent.click(screen.getByTestId('stack-create-envvar-remove-1'))
    expect(screen.queryByTestId('stack-create-envvar-row-1')).toBeNull()
    // Remove the last remaining row → resets to a single empty row.
    fireEvent.click(screen.getByTestId('stack-create-envvar-remove-0'))
    expect(screen.getByTestId('stack-create-envvar-row-0')).toBeTruthy()
  })
})

describe('StackCreatePage — formatBytes GB branch', () => {
  it('reports an oversized >1GB tarball in GB', () => {
    render(<MemoryRouter><StackCreatePage /></MemoryRouter>)
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('huge.tar.gz', 2 * 1024 * 1024 * 1024)] },
    })
    // formatBytes → "2.00 GB" surfaces in both the file-size line and the
    // oversize validation error.
    expect(screen.getAllByText(/2\.00 GB/).length).toBeGreaterThan(0)
  })
})
