import { describe, it, expect } from 'vitest'
import { parseServices, SERVICES } from './useCases'

/* Regression coverage for the 2026-05-19 prerender break: a use-case .md
 * (fetched from the external `content` repo) carried a `services` value
 * outside the SERVICES allow-list. The old parseServices cast `as Service[]`
 * without validating, so the bad value reached SERVICE_INFO[...] → undefined
 * → `.curl` of undefined → the `npm run build` prerender step crashed. */
describe('parseServices', () => {
  it('keeps every known service', () => {
    expect(parseServices(JSON.stringify(SERVICES))).toEqual([...SERVICES])
  })

  it('drops values not in the SERVICES allow-list', () => {
    // "storage"/"queue" are plausible misspellings of "minio"/"nats".
    expect(parseServices('["pg", "storage", "queue", "redis", "bogus"]')).toEqual(['pg', 'redis'])
  })

  it('returns [] for missing, non-array, or non-JSON frontmatter', () => {
    expect(parseServices(undefined)).toEqual([])
    expect(parseServices('"pg"')).toEqual([])
    expect(parseServices('not json at all')).toEqual([])
    expect(parseServices('[1, 2, 3]')).toEqual([])
  })
})
