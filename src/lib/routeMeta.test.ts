import { describe, it, expect } from 'vitest'
import { titleForPath } from './routeMeta'

// Per-route document.title for SPA soft navigation (WCAG 2.4.2). Pins the
// behaviour so a new route added to App.tsx without a routeMeta entry is
// caught (it falls through to the homepage default — visible here).
describe('titleForPath', () => {
  it('returns the homepage title for /', () => {
    expect(titleForPath('/')).toBe('instanode · Real infrastructure for AI agents')
  })

  it('returns a distinct title for each static public route', () => {
    expect(titleForPath('/pricing')).toBe('Pricing · instanode')
    expect(titleForPath('/docs')).toBe('Documentation · instanode')
    expect(titleForPath('/blog')).toBe('Blog · instanode')
    expect(titleForPath('/changelog')).toBe('Changelog · instanode')
  })

  it('uses the longest matching prefix for dynamic routes', () => {
    expect(titleForPath('/blog/some-post-slug')).toBe('Blog · instanode')
    expect(titleForPath('/use-cases/24-hour-hackathon-backend')).toBe('Use cases · instanode')
  })

  it('titles the gated /app subtree by section', () => {
    expect(titleForPath('/app')).toBe('Dashboard · instanode')
    expect(titleForPath('/app/deployments')).toBe('Deployments · instanode')
    expect(titleForPath('/app/billing')).toBe('Billing · instanode')
    expect(titleForPath('/app/admin/customers')).toBe('Admin · instanode')
  })

  it('falls back to the default for an unknown path', () => {
    expect(titleForPath('/totally-unknown')).toBe('instanode · Real infrastructure for AI agents')
  })

  it('never returns an empty string', () => {
    for (const p of ['/', '/pricing', '/app', '/blog/x', '/zzz', '']) {
      expect(titleForPath(p).length).toBeGreaterThan(0)
    }
  })
})
