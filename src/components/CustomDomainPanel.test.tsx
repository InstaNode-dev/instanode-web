/* CustomDomainPanel.test.tsx — Pro+ custom-domain binding lifecycle. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CustomDomain, CustomDomainStatus } from '../api'

const copyMock = vi.fn()
vi.mock('./Common', async () => {
  const actual = await vi.importActual<typeof import('./Common')>('./Common')
  return { ...actual, copyToClipboard: (...a: any[]) => copyMock(...a) }
})

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    listCustomDomains: vi.fn(),
    createCustomDomain: vi.fn(),
    verifyCustomDomain: vi.fn(),
    deleteCustomDomain: vi.fn(),
  }
})

import * as api from '../api'
import { CustomDomainPanel } from './CustomDomainPanel'

function makeDomain(over: Partial<CustomDomain> = {}): CustomDomain {
  return {
    id: 'cd_1',
    hostname: 'app.acme.com',
    status: 'pending_verification' as CustomDomainStatus,
    verified: false,
    certificate_ready: false,
    verification: {
      txt: { record_type: 'TXT', record_name: '_instanode.app.acme.com', record_value: 'verify=abc' },
      cname: { record_type: 'CNAME', record_name: 'app.acme.com', record_value: 'ingress.instanode.dev' },
    },
    last_check_err: null,
    ...over,
  }
}

function renderPanel(slug = 'my-stack') {
  return render(
    <MemoryRouter>
      <CustomDomainPanel stackSlug={slug} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(api.listCustomDomains as any).mockResolvedValue([])
})
afterEach(() => cleanup())

describe('CustomDomainPanel — load states', () => {
  it('shows the loading state then the empty state', async () => {
    let resolve!: (v: CustomDomain[]) => void
    ;(api.listCustomDomains as any).mockReturnValue(new Promise((r) => { resolve = r }))
    renderPanel()
    expect(screen.getByText('loading custom domains…')).toBeTruthy()
    resolve([])
    await waitFor(() => expect(screen.getByText(/No custom domains yet/)).toBeTruthy())
  })

  it('surfaces a load error', async () => {
    ;(api.listCustomDomains as any).mockRejectedValue(new Error('boom load'))
    renderPanel()
    await waitFor(() => expect(screen.getByText('boom load')).toBeTruthy())
  })

  it('renders a list of domains', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    renderPanel()
    await waitFor(() => expect(screen.getByText('app.acme.com')).toBeTruthy())
    expect(screen.getByText('Awaiting TXT')).toBeTruthy()
  })
})

describe('CustomDomainPanel — add domain', () => {
  it('opens and cancels the add form', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    expect(screen.getByLabelText('hostname')).toBeTruthy()
    await userEvent.click(screen.getByText('cancel'))
    await waitFor(() => expect(screen.queryByLabelText('hostname')).toBeNull())
  })

  it('creates a domain and prepends it to the list', async () => {
    ;(api.createCustomDomain as any).mockResolvedValue(makeDomain({ id: 'cd_new', hostname: 'new.acme.com' }))
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    await userEvent.type(screen.getByLabelText('hostname'), 'New.Acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }))
    await waitFor(() => expect(api.createCustomDomain).toHaveBeenCalledWith('my-stack', 'new.acme.com'))
    await waitFor(() => expect(screen.getByText('new.acme.com')).toBeTruthy())
  })

  it('does not submit a blank hostname', async () => {
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    const form = screen.getByLabelText('hostname').closest('form')!
    fireEvent.submit(form)
    expect(api.createCustomDomain).not.toHaveBeenCalled()
  })

  it('shows the upgrade banner on a 402', async () => {
    ;(api.createCustomDomain as any).mockRejectedValue({ status: 402 })
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    await userEvent.type(screen.getByLabelText('hostname'), 'x.acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }))
    await waitFor(() => expect(screen.getByTestId('custom-domain-upgrade-banner')).toBeTruthy())
  })

  it('shows hostname_taken error', async () => {
    ;(api.createCustomDomain as any).mockRejectedValue({ code: 'hostname_taken' })
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    await userEvent.type(screen.getByLabelText('hostname'), 'x.acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }))
    await waitFor(() => expect(screen.getByText(/already bound/)).toBeTruthy())
  })

  it('shows invalid_hostname error', async () => {
    ;(api.createCustomDomain as any).mockRejectedValue({ code: 'invalid_hostname' })
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    await userEvent.type(screen.getByLabelText('hostname'), 'x.acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }))
    await waitFor(() => expect(screen.getByText(/not valid/)).toBeTruthy())
  })

  it('shows a generic error otherwise', async () => {
    ;(api.createCustomDomain as any).mockRejectedValue({ message: 'weird' })
    renderPanel()
    await waitFor(() => screen.getByText('+ add domain'))
    await userEvent.click(screen.getByText('+ add domain'))
    await userEvent.type(screen.getByLabelText('hostname'), 'x.acme.com')
    await userEvent.click(screen.getByRole('button', { name: 'add domain' }))
    await waitFor(() => expect(screen.getByText('weird')).toBeTruthy())
  })
})

describe('CustomDomainPanel — verify / delete', () => {
  it('verifies a domain and updates its status', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    ;(api.verifyCustomDomain as any).mockResolvedValue(makeDomain({ status: 'verified', verified: true }))
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByRole('button', { name: 'verify' }))
    await waitFor(() => expect(screen.getByText('TXT verified — issuing cert')).toBeTruthy())
  })

  it('records a last_check_err on a failed verify', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    ;(api.verifyCustomDomain as any).mockRejectedValue(new Error('TXT not found'))
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByRole('button', { name: 'verify' }))
    await waitFor(() => expect(screen.getByText(/last check: TXT not found/)).toBeTruthy())
  })

  it('deletes a domain after confirmation', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    ;(api.deleteCustomDomain as any).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(screen.queryByText('app.acme.com')).toBeNull())
  })

  it('does not delete when confirmation is cancelled', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByRole('button', { name: 'delete' }))
    expect(api.deleteCustomDomain).not.toHaveBeenCalled()
  })

  it('surfaces a delete error', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    ;(api.deleteCustomDomain as any).mockRejectedValue(new Error('cannot delete'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByRole('button', { name: 'delete' }))
    await waitFor(() => expect(screen.getByText('cannot delete')).toBeTruthy())
  })

  it('hides verify button and shows CNAME for live domains', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([
      makeDomain({ status: 'live', verified: true }),
    ])
    renderPanel()
    await waitFor(() => screen.getByText('✓ Live'))
    expect(screen.queryByRole('button', { name: 'verify' })).toBeNull()
    expect(screen.getByText('ingress.instanode.dev')).toBeTruthy()
  })
})

describe('CustomDomainPanel — status pill variants', () => {
  it('renders ingress_ready and failed pills', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([
      makeDomain({ id: 'a', hostname: 'a.acme.com', status: 'ingress_ready', verified: true }),
      makeDomain({ id: 'b', hostname: 'b.acme.com', status: 'failed', last_check_err: 'cert issue' }),
    ])
    renderPanel()
    await waitFor(() => screen.getByText('Ingress live — issuing cert'))
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('renders an unknown status label via the default branch', async () => {
    ;(api.listCustomDomains as any).mockResolvedValue([
      makeDomain({ status: 'mystery' as CustomDomainStatus }),
    ])
    renderPanel()
    await waitFor(() => expect(screen.getByText('mystery')).toBeTruthy())
  })
})

describe('CustomDomainPanel — DNS row copy', () => {
  it('copies a DNS value and flips the label', async () => {
    copyMock.mockResolvedValue(true)
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    const copyBtn = screen.getByLabelText('copy value')
    await userEvent.click(copyBtn)
    expect(copyMock).toHaveBeenCalledWith('verify=abc')
    await waitFor(() => expect(copyBtn.textContent).toBe('copied'))
  })

  it('warns when the clipboard is unavailable', async () => {
    copyMock.mockResolvedValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(api.listCustomDomains as any).mockResolvedValue([makeDomain()])
    renderPanel()
    await waitFor(() => screen.getByText('app.acme.com'))
    await userEvent.click(screen.getByLabelText('copy value'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
