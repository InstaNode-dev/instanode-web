/* Common.pills.test.tsx — render coverage for the small Common.tsx
 * presentational exports (StatusPill, RolePill, ScopePill, Sparkline,
 * Skeleton) and the PromptCard copy paths. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  StatusPill,
  RolePill,
  ScopePill,
  Sparkline,
  Skeleton,
  PromptCard,
} from './Common'

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText }, configurable: true, writable: true,
  })
})
afterEach(() => cleanup())

describe('StatusPill', () => {
  it('maps running→healthy and deploying→building', () => {
    const { rerender } = render(<StatusPill status="running" />)
    expect(document.querySelector('.status-pill.healthy')!.textContent).toBe('healthy')
    rerender(<StatusPill status="deploying" />)
    expect(document.querySelector('.status-pill.building')!.textContent).toBe('building')
  })
  it('renders failed, expired (→stopped) and a fallback', () => {
    const { rerender } = render(<StatusPill status="failed" />)
    expect(document.querySelector('.status-pill.failed')).toBeTruthy()
    rerender(<StatusPill status="expired" />)
    expect(document.querySelector('.status-pill.stopped')!.textContent).toBe('expired')
    rerender(<StatusPill status={'stopped' as any} />)
    expect(document.querySelector('.status-pill.stopped')).toBeTruthy()
  })
})

describe('RolePill', () => {
  it('adds the role modifier class only for owner/admin', () => {
    const { rerender } = render(<RolePill role={'owner' as any} />)
    expect(document.querySelector('.role-pill.owner')).toBeTruthy()
    rerender(<RolePill role={'admin' as any} />)
    expect(document.querySelector('.role-pill.admin')).toBeTruthy()
    rerender(<RolePill role={'member' as any} />)
    expect(document.querySelector('.role-pill')!.className.trim()).toBe('role-pill')
  })
})

describe('ScopePill', () => {
  it('renders write, agent, and read variants', () => {
    const { rerender } = render(<ScopePill scope="write" />)
    expect(screen.getByText(/clickable/)).toBeTruthy()
    rerender(<ScopePill scope="agent" />)
    expect(screen.getByText(/agent surface/)).toBeTruthy()
    rerender(<ScopePill scope="read" />)
    expect(screen.getByText(/mirror/)).toBeTruthy()
  })
})

describe('Sparkline + Skeleton', () => {
  it('renders a polyline for the given points', () => {
    render(<Sparkline points={[1, 5, 3, 8]} />)
    const poly = document.querySelector('svg.sparkline polyline')
    expect(poly).toBeTruthy()
    expect(poly!.getAttribute('points')!.split(' ').length).toBe(4)
  })
  it('renders a single-point sparkline without dividing by zero', () => {
    render(<Sparkline points={[4]} />)
    expect(document.querySelector('svg.sparkline polyline')).toBeTruthy()
  })
  it('renders a skeleton with default and custom sizes', () => {
    const { rerender } = render(<Skeleton />)
    expect(document.querySelector('span.skel')).toBeTruthy()
    rerender(<Skeleton width={50} height={8} />)
    expect(document.querySelector('span.skel')).toBeTruthy()
  })
})

describe('PromptCard copy', () => {
  it('copies the fallback prompt when no promptText is given', async () => {
    render(<PromptCard title="Make a DB" prompt="provision pg" method="POST" endpoint="/db/new" hint="hint" />)
    await userEvent.click(screen.getByTestId('copy-prompt'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/db/new'))
    await waitFor(() => expect(screen.getByTestId('copy-prompt').textContent).toContain('copied'))
  })

  it('copies explicit promptText and the curl command', async () => {
    render(<PromptCard title="Get" prompt="x" promptText="custom prompt" method="GET" endpoint="/healthz" danger />)
    await userEvent.click(screen.getByTestId('copy-prompt'))
    expect(writeText).toHaveBeenLastCalledWith('custom prompt')
    await userEvent.click(screen.getByTestId('copy-curl'))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('curl -X GET'))
    await waitFor(() => expect(screen.getByTestId('copy-curl').textContent).toContain('copied'))
  })

  it('warns and does not flash when copy fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    // Force the execCommand fallback to also fail.
    ;(document as any).execCommand = vi.fn(() => false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<PromptCard title="t" prompt="p" method="DELETE" endpoint="/x" />)
    await userEvent.click(screen.getByTestId('copy-curl'))
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.getByTestId('copy-curl').textContent).toContain('copy curl')
    warn.mockRestore()
  })
})
