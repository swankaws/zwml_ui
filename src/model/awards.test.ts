import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { awards } from './awards'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid, type ManagerBlock, type Pick } from '../data/gridParser'
import { deriveLeague } from './derive'
import type { SaleEvent } from './diff'

/** A sale log entry. `seq` is the only chronology the sheet can ever give us (7.3). */
function sale(seq: number, manager: string, price: number, player = `P${seq}`): SaleEvent {
  return { slot: `0:${seq}`, seq, player, price, manager, position: null }
}

const complete = deriveLeague(
  parseAuctionGrid(parseCsv(readFileSync('docs/data-samples/2025-auction.csv', 'utf8'))).blocks,
)

function block(name: string, prices: number[], position: Pick['position'] = 'RB'): ManagerBlock & { name: string } {
  return {
    name,
    rawName: name,
    band: 0,
    row: 1,
    col: 1,
    bonus: 0,
    picks: prices.map((price, i) => ({
      position,
      player: `${name} pick ${i}`,
      price,
      row: 3 + i,
      slot: i < 7 ? 'starter' : 'bench',
      priceSuspect: false,
    })),
    sheet: { total: null, remaining: null, needs: null, maxBid: null, positionCounts: {} },
  }
}

const keys = (state: ReturnType<typeof deriveLeague>, sales: SaleEvent[] = []) =>
  awards(state, sales).map((a) => a.key)

describe('awards', () => {
  it('names the biggest single purchase of the night', () => {
    const state = deriveLeague([block('Alice', [60, 5]), block('Bob', [90, 5])])
    const award = awards(state).find((a) => a.key === 'big-spender')
    expect(award?.manager).toBe('Bob')
    expect(award?.detail).toContain('$90')
  })

  /*
   * The LOOOO-SER is whoever paid the most for their LAST pick -- the consequence of a badly run budget,
   * not merely the symptom. Chronology exists only in the sale log.
   */
  it('names whoever paid the most for their final pick', () => {
    const state = deriveLeague([block('Alice', [40, 30]), block('Bob', [10, 60])])
    const sales = [
      sale(1, 'Alice', 40),
      sale(2, 'Bob', 10),
      // Alice's last pick was cheap; Bob dumped $60 on his.
      sale(3, 'Alice', 30),
      sale(4, 'Bob', 60, 'Leftover Larry'),
    ]
    const award = awards(state, sales).find((a) => a.key === 'loser')
    expect(award?.manager).toBe('Bob')
    expect(award?.detail).toContain('$60')
    expect(award?.detail).toContain('Leftover Larry')
  })

  it('judges the LAST pick, not the biggest one', () => {
    // Alice spent more overall and more on one player, but ended cheaply. That is good management.
    const state = deriveLeague([block('Alice', [90, 2]), block('Bob', [5, 20])])
    const sales = [sale(1, 'Alice', 90), sale(2, 'Bob', 5), sale(3, 'Alice', 2), sale(4, 'Bob', 20)]
    expect(awards(state, sales).find((a) => a.key === 'loser')?.manager).toBe('Bob')
  })

  it('reads chronology from seq, not array order', () => {
    // A batch after an outage arrives in grid order, which says nothing about when anything sold.
    const state = deriveLeague([block('Bob', [5, 20])])
    const sales = [sale(4, 'Bob', 20), sale(2, 'Bob', 5)]
    expect(awards(state, sales).find((a) => a.key === 'loser')?.detail).toContain('$20')
  })

  it('has no LOOOO-SER without a sale log, rather than guessing from roster order', () => {
    /*
     * A board opened after the draft started has a partial log, and roster order carries no chronology
     * at all -- so an empty log means no award rather than an invented one.
     */
    const state = deriveLeague([block('Alice', [190]), block('Bob', [100])])
    expect(keys(state)).not.toContain('loser')
  })

  it('cannot be won by a keeper, which was never bought at the auction', () => {
    /*
     * Alice holds a $95 keeper and Bob an $8 auction pick. Keepers are the baseline and never enter the
     * log (7.3), so the award goes to the only manager who actually bought something -- Alice's is not a
     * last pick at all, it was already hers when the board opened.
     */
    const state = deriveLeague([block('Alice', [95]), block('Bob', [8])])
    const award = awards(state, [sale(1, 'Bob', 8)]).find((a) => a.key === 'loser')
    expect(award?.manager).toBe('Bob')
    expect(award?.manager).not.toBe('Alice')
  })

  /*
   * Every award is optional. A draft the data does not support simply has no winner for it, rather than
   * an arbitrary one -- which is the difference between a joke made of the numbers and a joke bolted on.
   */
  it('has no LOOOO-SER when every final pick was a dollar', () => {
    // Thrift, not a punchline.
    const state = deriveLeague([block('Alice', [50, 1]), block('Bob', [50, 1])])
    const sales = [sale(1, 'Alice', 50), sale(2, 'Bob', 50), sale(3, 'Alice', 1), sale(4, 'Bob', 1)]
    expect(keys(state, sales)).not.toContain('loser')
  })

  it('has no biggest splash when nobody paid more than the minimum', () => {
    const state = deriveLeague([block('Alice', [1, 1]), block('Bob', [1])])
    expect(keys(state)).not.toContain('big-spender')
  })

  it('only calls it dumpster diving past a few dollar players', () => {
    // Two $1 picks is just how a roster fills out; it is only funny as a strategy.
    expect(keys(deriveLeague([block('Alice', [1, 1, 50])]))).not.toContain('bargain-bin')
    expect(keys(deriveLeague([block('Alice', [1, 1, 1, 50])]))).toContain('bargain-bin')
  })

  it('only calls it hoarding past a plausible allocation', () => {
    expect(keys(deriveLeague([block('Alice', [5, 5, 5], 'WR')]))).not.toContain('hoarder')
    const state = deriveLeague([block('Alice', [5, 5, 5, 5], 'WR')])
    expect(awards(state).find((a) => a.key === 'hoarder')?.title).toBe('WR HOARDER')
  })

  it('survives a board with nothing on it', () => {
    // A state the finale can never actually be in -- it only appears once every roster is full -- but a
    // throw here would take the whole tree down, so it is worth knowing it degrades rather than crashes.
    expect(awards(deriveLeague([]))).toEqual([])

    /*
     * A manager with no picks HAS left the whole budget unspent, so a LOOOO-SER here is correct rather
     * than a bug -- the first version of this test asserted an empty list and was simply wrong. What
     * matters is that nothing throws and every award produced is well formed.
     */
    const barren = awards(deriveLeague([block('Alice', [])]), [])
    for (const award of barren) {
      expect(award.manager).toBe('Alice')
      expect(award.detail).not.toBe('')
    }
  })

  it('is deterministic on a tie, so a re-render cannot reshuffle the winners', () => {
    const state = deriveLeague([block('Alice', [90]), block('Bob', [90])])
    const first = awards(state).find((a) => a.key === 'big-spender')?.manager
    expect(awards(state).find((a) => a.key === 'big-spender')?.manager).toBe(first)
  })

  it('produces real awards from the completed 2025 draft', () => {
    /*
     * The end-to-end check, against the only finished draft in the repo. It is also the reason these are
     * derived at all: nothing here is written down about 2025, so the screen is different every year.
     */
    const won = awards(complete)
    expect(won.length).toBeGreaterThanOrEqual(3)
    for (const award of won) {
      expect(award.manager, award.key).not.toBe('')
      expect(award.detail, award.key).not.toBe('')
      expect(complete.managers.map((m) => m.name)).toContain(award.manager)
    }
  })
})
