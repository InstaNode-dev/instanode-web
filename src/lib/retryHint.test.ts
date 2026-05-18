import { describe, it, expect } from 'vitest'
import { retryAfterSeconds, isRateLimited, formatRetryHint } from './retryHint'

describe('retryAfterSeconds', () => {
  it('reads a numeric retryAfter field', () => {
    expect(retryAfterSeconds({ retryAfter: 30 })).toBe(30)
  })

  it('ceils a fractional retryAfter to whole seconds', () => {
    expect(retryAfterSeconds({ retryAfter: 12.4 })).toBe(13)
  })

  it('accepts retryAfter of 0', () => {
    expect(retryAfterSeconds({ retryAfter: 0 })).toBe(0)
  })

  it('ignores a negative retryAfter field', () => {
    expect(retryAfterSeconds({ retryAfter: -5 })).toBeNull()
  })

  it('falls back to a "retry after Ns" hint in the message', () => {
    expect(retryAfterSeconds({ message: 'rate limited (retry after 45s)' })).toBe(45)
  })

  it('falls back to a "retry in Ns" hint in the message', () => {
    expect(retryAfterSeconds({ message: 'too many requests, retry in 8 seconds' })).toBe(8)
  })

  it('returns null when no hint is present', () => {
    expect(retryAfterSeconds({ message: 'something else broke' })).toBeNull()
    expect(retryAfterSeconds(new Error('plain error'))).toBeNull()
  })

  it('never throws on non-object input', () => {
    expect(retryAfterSeconds(null)).toBeNull()
    expect(retryAfterSeconds(undefined)).toBeNull()
    expect(retryAfterSeconds('a string')).toBeNull()
  })
})

describe('isRateLimited', () => {
  it('is true for an error with status 429', () => {
    expect(isRateLimited({ status: 429 })).toBe(true)
  })

  it('is false for other statuses and non-objects', () => {
    expect(isRateLimited({ status: 500 })).toBe(false)
    expect(isRateLimited({ status: 402 })).toBe(false)
    expect(isRateLimited(null)).toBe(false)
    expect(isRateLimited('429')).toBe(false)
  })
})

describe('formatRetryHint', () => {
  it('renders sub-minute delays in seconds', () => {
    expect(formatRetryHint(1)).toBe('Please retry in 1 second.')
    expect(formatRetryHint(30)).toBe('Please retry in 30 seconds.')
    expect(formatRetryHint(59)).toBe('Please retry in 59 seconds.')
  })

  it('rolls up minute-plus delays to minutes', () => {
    expect(formatRetryHint(60)).toBe('Please retry in about 1 minute.')
    expect(formatRetryHint(150)).toBe('Please retry in about 3 minutes.')
  })

  it('handles 0 and null', () => {
    expect(formatRetryHint(0)).toBe('You can retry now.')
    expect(formatRetryHint(null)).toBe('Please retry in a moment.')
    expect(formatRetryHint(-1)).toBe('Please retry in a moment.')
  })
})
