// QuotaWallBanner.test.tsx — Track U1 unit tests.
//
// Three lifecycle moments worth verifying without spinning up a full
// fetch loop:
//   1. With near_wall=true → banner renders, copy is correct.
//   2. With dismiss state at the current percent → banner stays hidden.
//   3. With dismiss state and percent climbed +5pp → banner reappears.
//
// shouldRender is exported as a pure function precisely so these tests
// can exercise the decision logic directly. We also do one rendering
// test to confirm the JSX wires up testids and the dismiss writes to
// localStorage.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuotaWallBanner, shouldRender } from './QuotaWallBanner'
import type { QuotaWallResponse } from '../api'

const fakeWall: QuotaWallResponse = {
  ok: true,
  near_wall: true,
  tier: 'hobby',
  axis: 'storage',
  service: 'postgres',
  current: 471859200,
  limit: 536870912,
  percent_used: 87,
  at: '2026-05-12T11:02:00Z',
}

describe('shouldRender', () => {
  it('returns false when there is no wall payload', () => {
    expect(shouldRender(null, null)).toBe(false)
  })

  it('returns false when near_wall is false', () => {
    expect(shouldRender({ ok: true, near_wall: false }, null)).toBe(false)
  })

  it('returns true when near_wall is true and no dismiss state exists', () => {
    expect(shouldRender(fakeWall, null)).toBe(true)
  })

  it('returns false when dismissed at the same percent the response reports', () => {
    expect(
      shouldRender(fakeWall, { percent: 87, at: '2026-05-12T11:05:00Z' }),
    ).toBe(false)
  })

  it('returns false when usage climbed less than 5pp after dismiss', () => {
    // Dismissed at 85, current 87 → +2pp → still hidden.
    expect(
      shouldRender({ ...fakeWall, percent_used: 87 }, { percent: 85, at: '2026-05-12T11:05:00Z' }),
    ).toBe(false)
  })

  it('returns true when usage climbed 5pp or more after dismiss', () => {
    // Dismissed at 82, current 87 → +5pp → reappears.
    expect(
      shouldRender({ ...fakeWall, percent_used: 87 }, { percent: 82, at: '2026-05-12T11:05:00Z' }),
    ).toBe(true)
  })
})

describe('QuotaWallBanner rendering', () => {
  beforeEach(() => {
    // Reset localStorage between tests so dismiss state doesn't leak.
    if (typeof localStorage !== 'undefined') localStorage.clear()
    // Suppress real fetch — disablePolling covers the interval, but the
    // initial render's fetch path can also fire when initialWall is
    // undefined. We pass initialWall in every test below to keep it
    // hermetic.
  })

  it('renders the banner copy with axis-aware text when near_wall=true', () => {
    render(
      <QuotaWallBanner
        teamId="team-1"
        initialWall={fakeWall}
        disablePolling
      />,
    )
    const banner = screen.getByTestId('quota-wall-banner')
    expect(banner).toBeTruthy()
    expect(banner.textContent ?? '').toContain('87%')
    expect(banner.textContent ?? '').toContain('hobby')
    expect(banner.textContent ?? '').toContain('postgres')
    expect(screen.getByTestId('quota-wall-upgrade').getAttribute('href')).toBe('/app/billing')
  })

  it('hides the banner after dismiss is clicked', () => {
    render(
      <QuotaWallBanner
        teamId="team-1"
        initialWall={fakeWall}
        disablePolling
      />,
    )
    expect(screen.queryByTestId('quota-wall-banner')).toBeTruthy()
    fireEvent.click(screen.getByTestId('quota-wall-dismiss'))
    expect(screen.queryByTestId('quota-wall-banner')).toBeNull()

    // The dismiss state was persisted with the right percent so the
    // reappear-at-+5pp logic can read it back in a fresh mount.
    const raw = localStorage.getItem('instanode.quotaWallDismiss.team-1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.percent).toBe(87)
  })

  it('does not render when near_wall=false', () => {
    render(
      <QuotaWallBanner
        teamId="team-1"
        initialWall={{ ok: true, near_wall: false }}
        disablePolling
      />,
    )
    expect(screen.queryByTestId('quota-wall-banner')).toBeNull()
  })

  it('reappears for a fresh mount if percent climbed +5pp over the dismissed value', () => {
    // Pre-seed a dismiss state at 82%.
    localStorage.setItem(
      'instanode.quotaWallDismiss.team-1',
      JSON.stringify({ percent: 82, at: '2026-05-12T11:00:00Z' }),
    )
    render(
      <QuotaWallBanner
        teamId="team-1"
        initialWall={{ ...fakeWall, percent_used: 88 }}
        disablePolling
      />,
    )
    expect(screen.queryByTestId('quota-wall-banner')).toBeTruthy()
  })

  it('stays hidden for a fresh mount if percent climbed less than +5pp', () => {
    localStorage.setItem(
      'instanode.quotaWallDismiss.team-1',
      JSON.stringify({ percent: 85, at: '2026-05-12T11:00:00Z' }),
    )
    render(
      <QuotaWallBanner
        teamId="team-1"
        initialWall={{ ...fakeWall, percent_used: 87 }}
        disablePolling
      />,
    )
    expect(screen.queryByTestId('quota-wall-banner')).toBeNull()
  })
})

// Sanity test that the unused vi import is intentional — silences the
// "unused import" lint rule when the file is otherwise vi-free.
vi.fn()
