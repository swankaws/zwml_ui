import { describe, expect, it } from 'vitest'
import { clampScale, readInitialScale } from './useDisplayScale'

const round = (n: number) => Math.round(n * 100) / 100

describe('clampScale', () => {
  it('holds inside the usable range', () => {
    expect(clampScale(3)).toBe(2)
    expect(clampScale(0.1)).toBe(0.6)
  })

  it('snaps to the step so repeated nudges do not drift', () => {
    expect(round(clampScale(1.13))).toBe(1.15)
  })

  it('falls back to 1 for values that are not finite numbers', () => {
    // All three reach here from a hand-typed ?scale=. 1 rather than the nearest
    // bound: a garbage value is not a request for the largest possible type.
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(1)
  })
})

describe('readInitialScale', () => {
  it('defaults to 1 with nothing set', () => {
    expect(readInitialScale('', null)).toBe(1)
  })

  it('reads the query string', () => {
    expect(round(readInitialScale('?scale=1.25', null))).toBe(1.25)
  })

  it('reads it without the leading question mark too', () => {
    expect(round(readInitialScale('scale=1.25', null))).toBe(1.25)
  })

  it('prefers the query string over the stored value', () => {
    // A URL has to be able to force a value on a projector browser that already
    // has a tuned scale saved from a previous session.
    expect(round(readInitialScale('?scale=1.5', '0.8'))).toBe(1.5)
  })

  it('falls back to the stored value, which is the point of persisting it', () => {
    expect(round(readInitialScale('', '1.35'))).toBe(1.35)
  })

  it('clamps whatever it reads', () => {
    expect(readInitialScale('?scale=99', null)).toBe(2)
    expect(readInitialScale('', '-4')).toBe(0.6)
  })

  it('ignores junk rather than rendering an unreadable board', () => {
    expect(readInitialScale('?scale=huge', null)).toBe(1)
    expect(readInitialScale('', 'null')).toBe(1)
  })

  it('ignores an empty scale param', () => {
    expect(readInitialScale('?scale=', null)).toBe(1)
  })
})
