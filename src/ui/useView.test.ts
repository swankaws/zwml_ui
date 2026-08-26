import { describe, expect, it } from 'vitest'
import { IDLE_RETURN_MS, viewFromQuery } from './useView'

describe('viewFromQuery', () => {
  it('pins the roster view, which is how the layout gate reaches it', () => {
    expect(viewFromQuery('?view=roster')).toBe('roster')
    expect(viewFromQuery('?fixture=2025&view=roster')).toBe('roster')
  })

  it('pins the board view too, so a pin can be undone from the URL', () => {
    expect(viewFromQuery('?view=board')).toBe('board')
  })

  it('is null when absent, which is what leaves `R` in charge', () => {
    // Distinct from `'board'`: unpinned ALSO means the idle auto-return is live.
    expect(viewFromQuery('')).toBeNull()
    expect(viewFromQuery('?fixture=2025')).toBeNull()
  })

  it('ignores a value it does not recognize rather than guessing', () => {
    expect(viewFromQuery('?view=rosters')).toBeNull()
    expect(viewFromQuery('?view=')).toBeNull()
  })

  it('tolerates a missing leading question mark', () => {
    expect(viewFromQuery('view=roster')).toBe('roster')
  })
})

describe('the idle auto-return', () => {
  it('is long enough to read twelve squads and short enough to matter', () => {
    /*
     * 7.4 says ~30s. This is 45, because reading twelve rosters takes longer than half a
     * minute and any keypress restarts the clock. The upper bound is what makes the roster
     * view safe to reach for at all: nobody stands at this machine, so a view that stayed up
     * would leave the wall without MAX BID -- the reason the display exists -- for the rest of
     * the auction.
     */
    expect(IDLE_RETURN_MS).toBeGreaterThanOrEqual(30_000)
    expect(IDLE_RETURN_MS).toBeLessThanOrEqual(60_000)
  })
})
