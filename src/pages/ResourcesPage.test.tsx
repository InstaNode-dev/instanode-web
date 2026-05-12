/* ResourcesPage.test.tsx — expiry-badge integration on resource rows.
 *
 * The badge wraps formatTimeUntil() — those primitives are tested in
 * OverviewPage.test.tsx. Here we assert that the row UI:
 *   1. renders a badge on resources with expires_at !== null,
 *   2. hides the badge on permanent resources (expires_at: null),
 *   3. picks the urgent variant for <1h-to-expiry resources. */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ExpiryBadge } from '../components/Common'

const NOW = new Date('2026-05-12T12:00:00Z').getTime()
const inHours = (h: number) => new Date(NOW + h * 60 * 60 * 1000).toISOString()
const inMinutes = (m: number) => new Date(NOW + m * 60 * 1000).toISOString()
const agoHours = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString()

afterEach(() => cleanup())

describe('ExpiryBadge — visibility', () => {
  it('renders nothing when expires_at is null (permanent resource)', () => {
    const { container } = render(<ExpiryBadge expiresAt={null} now={NOW} />)
    expect(container.querySelector('[data-testid="expiry-badge"]')).toBeNull()
  })

  it('renders nothing when expires_at is undefined', () => {
    const { container } = render(<ExpiryBadge expiresAt={undefined} now={NOW} />)
    expect(container.querySelector('[data-testid="expiry-badge"]')).toBeNull()
  })

  it('renders a badge when expires_at is set', () => {
    render(<ExpiryBadge expiresAt={inHours(20)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge')).toBeTruthy()
  })
})

describe('ExpiryBadge — copy formats correctly across thresholds', () => {
  it('<1h: shows "expires in Xm"', () => {
    render(<ExpiryBadge expiresAt={inMinutes(45)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge').textContent).toContain('expires in 45m')
  })

  it('1-3h: shows "expires in Xh Ym"', () => {
    render(<ExpiryBadge expiresAt={inMinutes(60 + 14)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge').textContent).toContain('expires in 1h 14m')
  })

  it('3-6h: shows "expires in 5h 15m"', () => {
    render(<ExpiryBadge expiresAt={inMinutes(60 * 5 + 15)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge').textContent).toContain('expires in 5h 15m')
  })

  it('6-12h: shows "expires in 9h 45m"', () => {
    render(<ExpiryBadge expiresAt={inMinutes(60 * 9 + 45)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge').textContent).toContain('expires in 9h 45m')
  })

  it('12-24h: shows "expires in 18h 5m"', () => {
    render(<ExpiryBadge expiresAt={inMinutes(60 * 18 + 5)} now={NOW} />)
    expect(screen.getByTestId('expiry-badge').textContent).toContain('expires in 18h 5m')
  })

  it('expired: shows just "expired" (no "in")', () => {
    render(<ExpiryBadge expiresAt={agoHours(1)} now={NOW} />)
    const badge = screen.getByTestId('expiry-badge')
    expect(badge.textContent?.trim()).toMatch(/^⚠?\s*expired$/)
  })
})

describe('ExpiryBadge — urgent variant', () => {
  it('applies .urgent class when <1h to expiry', () => {
    render(<ExpiryBadge expiresAt={inMinutes(30)} now={NOW} />)
    const badge = screen.getByTestId('expiry-badge')
    expect(badge.className).toContain('urgent')
    expect(badge.getAttribute('data-level')).toBe('urgent')
  })

  it('does NOT apply .urgent when 2h to expiry', () => {
    render(<ExpiryBadge expiresAt={inHours(2)} now={NOW} />)
    const badge = screen.getByTestId('expiry-badge')
    expect(badge.className).not.toContain('urgent')
    expect(badge.getAttribute('data-level')).toBe('soon')
  })

  it('applies .urgent when already expired', () => {
    render(<ExpiryBadge expiresAt={agoHours(1)} now={NOW} />)
    const badge = screen.getByTestId('expiry-badge')
    expect(badge.className).toContain('urgent')
  })
})
