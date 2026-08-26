import { describe, expect, it } from 'vitest'
import { pressureLevel } from './columns'
import { league } from '../config/league'
import type { ManagerState } from '../model/derive'

function manager(over: Partial<ManagerState> = {}): ManagerState {
  return {
    name: 'Kevin',
    picks: [],
    spent: 0,
    remaining: league.budget,
    slotsFilled: 0,
    needs: league.auctionSlots,
    maxBid: 186,
    pctRemaining: 1,
    avgPerSlot: 13,
    positionCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0 },
    overspent: false,
    overRostered: false,
    disagreements: [],
    ...over,
  }
}

describe('pressureLevel', () => {
  it('is quiet at the open, when every manager is identical', () => {
    /*
     * The property that makes this worth having at all. Twelve managers at $200 with fifteen needs
     * is the state the board sits in for the first minutes of every draft, and a colour that
     * appears on all twelve rows conveys nothing -- the same argument the leader highlight makes.
     */
    const fresh = manager()
    for (const column of ['maxBid', 'left', 'needs', 'spent', 'perSlot'] as const) {
      expect(pressureLevel(column, fresh), column).toBe('none')
    }
  })

  it('marks a $1 max bid critical: they cannot outbid anybody', () => {
    expect(pressureLevel('maxBid', manager({ maxBid: league.minBid }))).toBe('critical')
  })

  it('marks a nearly-spent max bid low', () => {
    expect(pressureLevel('maxBid', manager({ maxBid: 5 }))).toBe('low')
    expect(pressureLevel('maxBid', manager({ maxBid: 6 }))).toBe('none')
  })

  it('says nothing about a FULL roster, which is finished rather than under pressure', () => {
    // It already has its own row state, and dimming plus a warning colour would say two things.
    expect(pressureLevel('maxBid', manager({ maxBid: null, needs: 0 }))).toBe('none')
  })

  it('grades LEFT by the share of the budget still in hand', () => {
    expect(pressureLevel('left', manager({ remaining: 60 }))).toBe('none')
    expect(pressureLevel('left', manager({ remaining: 50 }))).toBe('low')
    expect(pressureLevel('left', manager({ remaining: 21 }))).toBe('low')
    expect(pressureLevel('left', manager({ remaining: 20 }))).toBe('critical')
    expect(pressureLevel('left', manager({ remaining: 0 }))).toBe('critical')
  })

  it('leaves overspent money to the row marker rather than colouring it twice', () => {
    // `.negative` and the invalid row bar already carry it; a third signal is noise.
    expect(pressureLevel('left', manager({ remaining: -6, overspent: true }))).toBe('none')
  })

  it('does not colour NEEDS', () => {
    /*
     * A low NEEDS is not a warning -- it means nearly done, which is neither good nor bad and is
     * already legible in the digit. The interesting case is high NEEDS against low LEFT, which is a
     * relationship between two cells that a per-cell colour cannot express.
     */
    for (const needs of [0, 1, 2, 8, 15]) {
      expect(pressureLevel('needs', manager({ needs }))).toBe('none')
    }
  })
})
