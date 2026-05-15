/* StackCreatePage.test.tsx — coverage for /app/stacks/new (W9).
 *
 * Scope:
 *   1. Tier wall — anonymous + free can't create stacks; render UpgradePromptCard.
 *   2. Form validation — file size cap, env-var key shape, port range, name.
 *   3. Submit shape — assert FormData fields land in the multipart body.
 *   4. Polling loop — building → healthy and the live URL appears.
 *   5. 402 path — tier-wall banner.
 *
 * Pattern matches DeploymentsPage.test.tsx: mock the api module, mock
 * useDashboardCtx, render with MemoryRouter, drive the form with
 * fireEvent + waitFor. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    createStack: vi.fn(),
    fetchStackStatus: vi.fn(),
  }
})

let mockMe: any = null
vi.mock('../hooks/useDashboardCtx', () => ({
  useDashboardCtx: () => ({
    me: mockMe,
    meErr: null,
    meLoading: false,
    env: 'production',
    envs: ['production'],
    counts: { resources: 0, deployments: 0, vault: 0, team: 1 },
    resources: [],
    billing: null,
    billingLoading: false,
  }),
}))

import { StackCreatePage, MAX_TARBALL_BYTES } from './StackCreatePage'
import * as api from '../api'
import type { Tier } from '../api'

const mockCreateStack = api.createStack as unknown as ReturnType<typeof vi.fn>
const mockFetchStackStatus = api.fetchStackStatus as unknown as ReturnType<typeof vi.fn>

function setTier(tier: Tier) {
  mockMe = {
    user: { id: 'u', email: 'me@test', tier, team_id: 't', created_at: '' },
    team: { id: 't', slug: 't', name: 't', owner_id: 'u', member_count: 1, tier, created_at: '' },
  }
}

function withRouter(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>
}

/** Build a fake File. jsdom's File constructor takes Blob parts + name. */
function makeFile(name: string, sizeBytes: number, type = 'application/gzip'): File {
  // Use a single ArrayBuffer of the requested size. jsdom honors .size on
  // the File so the size cap test can hit the validation branch without
  // allocating real megabytes.
  const buf = new ArrayBuffer(sizeBytes)
  return new File([buf], name, { type })
}

beforeEach(() => {
  mockCreateStack.mockReset()
  mockFetchStackStatus.mockReset()
  setTier('hobby')
  // Fake timers default off — only the polling-loop tests opt in via
  // `vi.useFakeTimers()` because waitFor / async assertions don't play
  // nicely with fake timers across the board.
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('StackCreatePage — tier wall', () => {
  it('renders UpgradePromptCard for anonymous tier (no form)', () => {
    setTier('anonymous')
    render(withRouter(<StackCreatePage />))
    expect(screen.getByTestId('stack-create-tier-wall')).toBeTruthy()
    expect(screen.queryByTestId('stack-create-form')).toBeNull()
    // UpgradePromptCard renders with this stable testId.
    expect(screen.getByTestId('upgrade-prompt-private_deploy')).toBeTruthy()
  })

  it('renders UpgradePromptCard for free tier as well', () => {
    setTier('free')
    render(withRouter(<StackCreatePage />))
    expect(screen.getByTestId('stack-create-tier-wall')).toBeTruthy()
    expect(screen.queryByTestId('stack-create-form')).toBeNull()
  })

  it('renders the form for hobby tier', () => {
    setTier('hobby')
    render(withRouter(<StackCreatePage />))
    expect(screen.getByTestId('stack-create-form')).toBeTruthy()
    expect(screen.queryByTestId('stack-create-tier-wall')).toBeNull()
  })

  it('renders the form for pro tier', () => {
    setTier('pro')
    render(withRouter(<StackCreatePage />))
    expect(screen.getByTestId('stack-create-form')).toBeTruthy()
  })
})

describe('StackCreatePage — file validation', () => {
  it('shows an error when the tarball exceeds 50 MB', () => {
    render(withRouter(<StackCreatePage />))
    const input = screen.getByTestId('stack-create-file') as HTMLInputElement
    // Forge a File that reports size > 50 MB without allocating. Simpler
    // than ArrayBuffer in tests: define `size` directly on a minimal File.
    const fake = makeFile('big.tar.gz', 1) // 1 byte stub
    Object.defineProperty(fake, 'size', { value: MAX_TARBALL_BYTES + 1 })
    fireEvent.change(input, { target: { files: [fake] } })
    // File info row appears.
    expect(screen.getByTestId('stack-create-file-info')).toBeTruthy()
    // Submit stays disabled because validation failed.
    const submit = screen.getByTestId('stack-create-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // Error text mentions the 50 MB limit.
    expect(screen.getByTestId('stack-create-form').textContent).toMatch(/50\.0 MB|limit is/i)
  })

  it('shows an error when the file does not have a .tar.gz / .tgz extension', () => {
    render(withRouter(<StackCreatePage />))
    const input = screen.getByTestId('stack-create-file') as HTMLInputElement
    const bad = makeFile('app.zip', 100)
    fireEvent.change(input, { target: { files: [bad] } })
    expect(screen.getByTestId('stack-create-form').textContent).toMatch(/\.tar\.gz|\.tgz/i)
    const submit = screen.getByTestId('stack-create-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('accepts a small valid .tar.gz', () => {
    render(withRouter(<StackCreatePage />))
    const input = screen.getByTestId('stack-create-file') as HTMLInputElement
    const ok = makeFile('app.tar.gz', 1024)
    fireEvent.change(input, { target: { files: [ok] } })
    // Name is a required field — submit stays disabled until it's filled.
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    const submit = screen.getByTestId('stack-create-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('keeps submit disabled when the name is left blank', () => {
    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('app.tar.gz', 1024)] },
    })
    const submit = screen.getByTestId('stack-create-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})

describe('StackCreatePage — env-var key validation', () => {
  it('rejects lowercase keys + flags an inline error', () => {
    render(withRouter(<StackCreatePage />))
    // First row is rendered by default.
    const keyInput = screen.getByTestId('stack-create-envvar-key-0') as HTMLInputElement
    const valueInput = screen.getByTestId('stack-create-envvar-value-0') as HTMLInputElement
    // The component auto-uppercases keys. Pass a key with a hyphen to
    // dodge the auto-uppercase and hit the regex failure.
    fireEvent.change(keyInput, { target: { value: 'foo-bar' } })
    fireEvent.change(valueInput, { target: { value: '1' } })
    // The component upper-cases the input — assert against what landed.
    expect(keyInput.value).toBe('FOO-BAR')
    // Hyphen fails the regex → error row appears.
    expect(screen.getByTestId('stack-create-envvar-error-0')).toBeTruthy()
  })

  it('accepts a valid uppercase + underscore key', () => {
    render(withRouter(<StackCreatePage />))
    const keyInput = screen.getByTestId('stack-create-envvar-key-0') as HTMLInputElement
    fireEvent.change(keyInput, { target: { value: 'DATABASE_URL' } })
    expect(keyInput.value).toBe('DATABASE_URL')
    expect(screen.queryByTestId('stack-create-envvar-error-0')).toBeNull()
  })

  it('add button appends a row', () => {
    render(withRouter(<StackCreatePage />))
    expect(screen.queryByTestId('stack-create-envvar-row-1')).toBeNull()
    fireEvent.click(screen.getByTestId('stack-create-envvar-add'))
    expect(screen.getByTestId('stack-create-envvar-row-1')).toBeTruthy()
  })
})

describe('StackCreatePage — port validation', () => {
  it('rejects port < 1024', () => {
    render(withRouter(<StackCreatePage />))
    const input = screen.getByTestId('stack-create-port') as HTMLInputElement
    fireEvent.change(input, { target: { value: '80' } })
    // Need to make sure a file is also set so we isolate the port error.
    const fileInput = screen.getByTestId('stack-create-file') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [makeFile('a.tar.gz', 100)] } })
    expect(screen.getByTestId('stack-create-form').textContent).toMatch(/Port must be between 1024/)
  })
})

describe('StackCreatePage — submit shape', () => {
  it('passes the file + form fields to createStack', async () => {
    mockCreateStack.mockResolvedValueOnce({
      ok: true,
      stack: { slug: 'sunny-cat-7', status: 'building', url: null, env: 'development' },
    })
    mockFetchStackStatus.mockResolvedValue({ ok: true, stack: null })

    render(withRouter(<StackCreatePage />))

    const file = makeFile('app.tar.gz', 2048)
    fireEvent.change(screen.getByTestId('stack-create-file'), { target: { files: [file] } })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    fireEvent.change(screen.getByTestId('stack-create-port'), { target: { value: '3000' } })
    fireEvent.change(screen.getByTestId('stack-create-env'), { target: { value: 'staging' } })
    fireEvent.change(screen.getByTestId('stack-create-envvar-key-0'), { target: { value: 'API_KEY' } })
    fireEvent.change(screen.getByTestId('stack-create-envvar-value-0'), { target: { value: 'secret' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })

    expect(mockCreateStack).toHaveBeenCalledTimes(1)
    const [calledFile, calledOpts] = mockCreateStack.mock.calls[0]
    expect(calledFile).toBe(file)
    expect(calledOpts).toMatchObject({
      name: 'my-app',
      port: 3000,
      env: 'staging',
      env_vars: { API_KEY: 'secret' },
    })
  })

  it('defaults env to "development" when the user does not touch it', async () => {
    mockCreateStack.mockResolvedValueOnce({
      ok: true,
      stack: { slug: 's', status: 'building', url: null },
    })
    mockFetchStackStatus.mockResolvedValue({ ok: true, stack: null })
    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    const [, opts] = mockCreateStack.mock.calls[0]
    expect(opts.env).toBe('development')
  })

  it('omits env_vars from createStack input when the form leaves them empty', async () => {
    mockCreateStack.mockResolvedValueOnce({
      ok: true,
      stack: { slug: 's', status: 'building', url: null },
    })
    mockFetchStackStatus.mockResolvedValue({ ok: true, stack: null })
    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    const [, opts] = mockCreateStack.mock.calls[0]
    expect(opts.env_vars).toBeUndefined()
  })
})

describe('StackCreatePage — polling loop', () => {
  it('transitions to live and renders the URL when status flips to running', async () => {
    // Synchronously resolve the very first poll as 'running' so we don't
    // need to drive fake timers — exercising the running-branch is enough
    // to lock the contract. (The "still polling" branch is covered by the
    // building-panel render + the slow-hint elapsed math separately.)
    mockCreateStack.mockResolvedValueOnce({
      ok: true,
      stack: { slug: 'sunny-cat-7', status: 'building', url: null },
    })
    mockFetchStackStatus.mockResolvedValue({
      ok: true,
      stack: { id: 'sunny-cat-7', slug: 'sunny-cat-7', name: '', status: 'running', url: 'https://sunny-cat-7.deployment.instanode.dev', created_at: '', team_id: '', env: 'production', tier: 'hobby' },
    })

    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'sunny-cat-7' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    // Building panel visible immediately after submit.
    expect(screen.getByTestId('stack-create-building')).toBeTruthy()

    // Real timers are running (3s poll interval). Wait up to ~5s for the
    // live panel to mount. waitFor polls so this resolves the moment the
    // first poll completes — well under the budget.
    await waitFor(
      () => expect(screen.getByTestId('stack-create-live')).toBeTruthy(),
      { timeout: 4500 },
    )
    const urlLink = screen.getByTestId('stack-create-live-url') as HTMLAnchorElement
    expect(urlLink.href).toContain('sunny-cat-7.deployment.instanode.dev')
  })

  it('renders the failed panel when the polled status is failed', async () => {
    mockCreateStack.mockResolvedValueOnce({
      ok: true,
      stack: { slug: 'sad-stack', status: 'building', url: null },
    })
    mockFetchStackStatus.mockResolvedValue({
      ok: true,
      stack: { id: 'sad-stack', slug: 'sad-stack', name: '', status: 'failed', url: null, created_at: '', team_id: '', env: 'production', tier: 'hobby' },
    })

    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'sad-stack' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    await waitFor(
      () => expect(screen.getByTestId('stack-create-failed')).toBeTruthy(),
      { timeout: 4500 },
    )
  })
})

describe('StackCreatePage — error paths', () => {
  it('shows the tier banner on 402', async () => {
    const err: any = new Error('upgrade required')
    err.status = 402
    err.code = 'tier_limit'
    mockCreateStack.mockRejectedValueOnce(err)

    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    await waitFor(() => expect(screen.getByTestId('stack-create-tier-banner')).toBeTruthy())
  })

  it('shows a generic error message on 400 / 500', async () => {
    const err: any = new Error('invalid_tarball: missing Dockerfile')
    err.status = 400
    err.code = 'invalid_tarball'
    mockCreateStack.mockRejectedValueOnce(err)

    render(withRouter(<StackCreatePage />))
    fireEvent.change(screen.getByTestId('stack-create-file'), {
      target: { files: [makeFile('a.tar.gz', 100)] },
    })
    fireEvent.change(screen.getByTestId('stack-create-name'), { target: { value: 'my-app' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('stack-create-submit'))
    })
    await waitFor(() => expect(screen.getByTestId('stack-create-error')).toBeTruthy())
    expect(screen.getByTestId('stack-create-error').textContent).toMatch(/invalid_tarball|missing Dockerfile/)
  })
})
