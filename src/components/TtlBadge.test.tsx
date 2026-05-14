// TtlBadge.test.tsx — Wave FIX-J. Smoke tests for the three visual states
// of the deploy TTL badge (permanent / auto-expire / banner).
//
// Uses raw `screen` queries — vitest doesn't have jest-dom matchers
// loaded across the project, so we go through queryByTestId / textContent
// directly. Consistent with the rest of src/components/*.test.tsx.

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TtlBadge } from './TtlBadge'
import type { DashboardDeployment } from '../api/types'

function deployment(overrides: Partial<DashboardDeployment> = {}): DashboardDeployment {
  return {
    id: 'd-1',
    app_id: 'app',
    name: 'app',
    url: 'https://app.deployment.instanode.dev',
    status: 'healthy',
    env: 'production' as DashboardDeployment['env'],
    port: 8080,
    tier: 'hobby' as DashboardDeployment['tier'],
    env_vars: {},
    created_at: '2026-05-14T00:00:00Z',
    ...overrides,
  } as DashboardDeployment
}

describe('TtlBadge', () => {
  it('renders Permanent badge when ttl_policy=permanent', () => {
    render(
      <TtlBadge
        deployment={deployment({ ttl_policy: 'permanent' })}
        variant="inline"
      />,
    )
    const perm = screen.getByTestId('ttl-permanent')
    expect(perm.textContent).toMatch(/Permanent/)
    expect(screen.queryByTestId('ttl-auto-expire')).toBeNull()
  })

  it('renders Permanent when expires_at is absent (legacy payloads)', () => {
    render(
      <TtlBadge
        deployment={deployment({ ttl_policy: 'auto_24h' })}
        variant="inline"
      />,
    )
    expect(screen.queryByTestId('ttl-permanent')).not.toBeNull()
  })

  it('renders Expires-in-Nh badge when ttl_policy=auto_24h with a future expires_at', () => {
    const inSixHours = new Date(Date.now() + 6 * 3_600_000).toISOString()
    render(
      <TtlBadge
        deployment={deployment({
          ttl_policy: 'auto_24h',
          expires_at: inSixHours,
        })}
        variant="inline"
      />,
    )
    const badge = screen.queryByTestId('ttl-auto-expire')
    expect(badge).not.toBeNull()
    // Hours rendered as a ceiling — 6h is the deterministic floor.
    expect(badge?.textContent).toMatch(/Expires in \d+h/)
  })

  it('banner variant renders the Make Permanent button on auto-expire', () => {
    const inFourHours = new Date(Date.now() + 4 * 3_600_000).toISOString()
    render(
      <TtlBadge
        deployment={deployment({
          ttl_policy: 'auto_24h',
          expires_at: inFourHours,
        })}
        variant="banner"
      />,
    )
    expect(screen.queryByTestId('ttl-banner')).not.toBeNull()
    const button = screen.queryByTestId('make-permanent-button')
    expect(button).not.toBeNull()
    expect(button?.textContent).toMatch(/Keep this deployment/i)
  })

  it('banner variant on permanent renders no button', () => {
    render(
      <TtlBadge
        deployment={deployment({ ttl_policy: 'permanent' })}
        variant="banner"
      />,
    )
    expect(screen.queryByTestId('ttl-banner')).toBeNull()
    expect(screen.queryByTestId('make-permanent-button')).toBeNull()
    expect(screen.queryByTestId('ttl-permanent')).not.toBeNull()
  })
})
