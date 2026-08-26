import { describe, expect, it } from 'vitest'
import { NO_REVISIONS, bumpRevisions } from './revisions'
import type { LeagueState, ManagerState } from './derive'

function manager(name: string, over: Partial<ManagerState> = {}): ManagerState {
  return {
    name,
    picks: [],
    spent: 0,
    bonus: 0,
    remaining: 200,
    slotsFilled: 0,
    needs: 15,
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

function state(...managers: ManagerState[]): LeagueState {
  return {
    managers,
    unmatched: [],
    duplicated: [],
    leagueSpent: 0,
    leagueBonus: 0,
    leagueRemaining: 0,
    leagueNeeds: 0,
    slotsFilled: 0,
    totalSlots: managers.length * 15,
    avgPerRemainingSlot: null,
    draftComplete: false,
  }
}

const FIELD = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Fay'] as const
const field = (over: Record<string, Partial<ManagerState>> = {}) =>
  state(...FIELD.map((n) => manager(n, over[n] ?? {})))

describe('bumpRevisions', () => {
  it('flashes nothing on the first parse of a session', () => {
    /*
     * `before === null` is a page that has just appeared -- including after a watchdog reload. Every
     * figure on it is new, so flashing all twelve would announce nothing.
     */
    expect(bumpRevisions(NO_REVISIONS, null, field())).toBe(NO_REVISIONS)
  })

  it('returns the SAME object when nothing moved', () => {
    /*
     * Reference identity, not just equality. This goes into the board snapshot and `equivalent`
     * compares it by reference to decide whether to notify -- a fresh object every poll would
     * re-render the board once a second forever.
     */
    const before = field()
    const previous = { Alice: 3 }
    expect(bumpRevisions(previous, before, field())).toBe(previous)
  })

  it('bumps only the manager who bought someone', () => {
    const after = field({ Alice: { spent: 40, slotsFilled: 1 } })
    expect(bumpRevisions(NO_REVISIONS, field(), after)).toEqual({ Alice: 1 })
  })

  it('bumps again for a second sale, which a boolean could not do', () => {
    const one = field({ Alice: { spent: 40, slotsFilled: 1 } })
    const two = field({ Alice: { spent: 95, slotsFilled: 2 } })
    const first = bumpRevisions(NO_REVISIONS, field(), one)
    expect(bumpRevisions(first, one, two)).toEqual({ Alice: 2 })
  })

  it('bumps on a bonus award, which moves money without a sale', () => {
    const after = field({ Bob: { bonus: 25, remaining: 225 } })
    expect(bumpRevisions(NO_REVISIONS, field(), after)).toEqual({ Bob: 1 })
  })

  it('bumps on a price correction, which moves spent without a new slot', () => {
    const before = field({ Cara: { spent: 40, slotsFilled: 1 } })
    const after = field({ Cara: { spent: 32, slotsFilled: 1 } })
    expect(bumpRevisions(NO_REVISIONS, before, after)).toEqual({ Cara: 1 })
  })

  it('bumps on a retraction, so an undo is as visible as a sale', () => {
    const before = field({ Dan: { spent: 40, slotsFilled: 1 } })
    expect(bumpRevisions(NO_REVISIONS, before, field())).toEqual({ Dan: 1 })
  })

  /*
   * A DEF row edit must be invisible. Defenses are drafted before the auction and are free (Q5), so
   * the whole field gets a team name entered at once -- and none of it touches spent, bonus or
   * slotsFilled, which is precisely why those are the three inputs watched.
   */
  it('does not flash for anything that leaves spent, bonus and slots alone', () => {
    const after = field({ Eve: { disagreements: [{ field: 'maxBid', ours: 1, sheet: 2 }] } })
    expect(bumpRevisions(NO_REVISIONS, field(), after)).toBe(NO_REVISIONS)
  })

  it('does not flash a manager who was not on the previous board', () => {
    // A blank name cell recovering is an arrival, not a change. Flashing it announces a sale that
    // never happened -- and that block's real picks were never sold, they were always there.
    const before = state(manager('Alice'), manager('Bob'))
    const after = state(manager('Alice'), manager('Bob'), manager('Cara', { spent: 50 }))
    expect(bumpRevisions(NO_REVISIONS, before, after)).toBe(NO_REVISIONS)
  })

  /*
   * The strobe guard. One good poll after an outage, or a restored session reconciling, can move most
   * of the board in a single frame -- and six rows lighting up together is not a signal, it is a
   * flicker. 7.7 asks for motion that is purposeful.
   */
  it('flashes nobody when more than half the board moves at once', () => {
    const after = field({
      Alice: { spent: 10 },
      Bob: { spent: 10 },
      Cara: { spent: 10 },
      Dan: { spent: 10 },
    })
    expect(bumpRevisions(NO_REVISIONS, field(), after)).toBe(NO_REVISIONS)
  })

  it('still flashes exactly half, which is a plausible two-sale poll', () => {
    const after = field({ Alice: { spent: 10 }, Bob: { spent: 10 }, Cara: { spent: 10 } })
    expect(bumpRevisions(NO_REVISIONS, field(), after)).toEqual({ Alice: 1, Bob: 1, Cara: 1 })
  })

  it('carries forward revisions for managers who did not move', () => {
    const before = field()
    const after = field({ Fay: { spent: 5 } })
    expect(bumpRevisions({ Alice: 7 }, before, after)).toEqual({ Alice: 7, Fay: 1 })
  })
})
