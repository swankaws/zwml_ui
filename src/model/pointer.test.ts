import { describe, expect, it } from 'vitest'
import { countsFromSlots, derivePointer } from './pointer'
import { league } from '../config/league'
import type { SaleEvent } from './diff'

const ORDER = ['Alice', 'Bob', 'Cara'] as const

/** A sale won by `manager`. Who *won* is what fills a roster; who nominated is the pointer. */
function sale(seq: number, manager: string): SaleEvent {
  return { slot: `0:${seq}`, seq, player: `P${seq}`, price: 10, manager, position: null }
}

const at = (name: string) => ORDER.indexOf(name as (typeof ORDER)[number])

describe('derivePointer', () => {
  it('is null with no order configured -- naming someone would be a guess', () => {
    expect(derivePointer({ order: [], baselineCounts: {}, log: [] })).toBeNull()
  })

  it('opens on the first manager in the order', () => {
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [] })).toBe(at('Alice'))
  })

  it('skips a manager whose keepers already filled their roster', () => {
    // 7.5: start from the roster state at auction open, not from zero picks.
    const counts = { Alice: league.auctionSlots }
    expect(derivePointer({ order: ORDER, baselineCounts: counts, log: [] })).toBe(at('Bob'))
  })

  it('advances one position per sale while nobody is full', () => {
    const log = [sale(1, 'Alice'), sale(2, 'Bob')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log })).toBe(at('Cara'))
  })

  it('replays out of order safely, since a batch has no internal chronology', () => {
    const log = [sale(2, 'Bob'), sale(1, 'Alice')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log })).toBe(at('Cara'))
  })

  /*
   * The case that makes this module exist, from the note at the foot of ui/nominations.ts.
   * Alice arrives one pick short of full and wins the first player, so she leaves the
   * rotation partway through -- her earlier turn really happened, and she must not be
   * offered another one.
   *
   * Both cheap formulas get this wrong, in opposite directions:
   *   `saleCount % order.length`  = 3 % 3 = 0 = Alice, who is FULL.
   *   replay against *current* fullness (Alice never eligible) = Cara, over-advanced by
   *   exactly the one turn she really took.
   */
  it('does not put a manager who filled up mid-draft back on the clock', () => {
    const counts = { Alice: league.auctionSlots - 1 }
    const log = [sale(1, 'Alice'), sale(2, 'Cara'), sale(3, 'Bob')]

    const pointer = derivePointer({ order: ORDER, baselineCounts: counts, log })

    expect(pointer).toBe(at('Bob'))
    expect(pointer).not.toBe(at('Alice')) // what `saleCount % length` would say
    expect(pointer).not.toBe(at('Cara')) // what a current-fullness replay would say
  })

  it('credits the buyer before advancing, so a sale that fills the next manager skips them', () => {
    // Bob is one short and wins; the pointer must step over him to Cara.
    const counts = { Bob: league.auctionSlots - 1 }
    expect(derivePointer({ order: ORDER, baselineCounts: counts, log: [sale(1, 'Bob')] })).toBe(
      at('Cara'),
    )
  })

  it('is null once every roster is full -- the auction is over', () => {
    const counts = Object.fromEntries(ORDER.map((name) => [name, league.auctionSlots]))
    expect(derivePointer({ order: ORDER, baselineCounts: counts, log: [] })).toBeNull()
  })

  it('treats a manager the order does not know as able to nominate', () => {
    // An order naming someone off the roster is already a warning (model/order.ts); it
    // must not also silently remove them from the rotation.
    expect(derivePointer({ order: ['Zed', ...ORDER], baselineCounts: {}, log: [] })).toBe(0)
  })
})

describe('the operator offset (7.5)', () => {
  it('advances the pointer without touching the log', () => {
    const log = [sale(1, 'Alice')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log })).toBe(at('Bob'))
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log, offset: 1 })).toBe(at('Cara'))
  })

  it('retreats', () => {
    const log = [sale(1, 'Alice')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log, offset: -1 })).toBe(at('Alice'))
  })

  /*
   * The requirement that makes the offset an offset. A one-shot nudge would be wiped by the
   * very next sale, so the operator would have to re-correct after every single player for
   * the rest of the night.
   */
  it('persists across later sales rather than being consumed by them', () => {
    const one = derivePointer({ order: ORDER, baselineCounts: {}, log: [sale(1, 'Alice')], offset: 1 })
    const two = derivePointer({
      order: ORDER,
      baselineCounts: {},
      log: [sale(1, 'Alice'), sale(2, 'Bob')],
      offset: 1,
    })

    expect(one).toBe(at('Cara'))
    // Still exactly one ahead of the underlying rotation after another sale.
    expect(two).toBe(at('Alice'))
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [sale(1, 'Alice'), sale(2, 'Bob')] })).toBe(
      at('Cara'),
    )
  })

  it('counts in eligible positions, so one press never lands on a full manager', () => {
    const counts = { Bob: league.auctionSlots }
    expect(derivePointer({ order: ORDER, baselineCounts: counts, log: [], offset: 1 })).toBe(at('Cara'))
  })

  it('wraps around the order', () => {
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], offset: 3 })).toBe(at('Alice'))
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], offset: -1 })).toBe(at('Cara'))
  })

  it('is a no-op when only one manager can still nominate', () => {
    // Endgame: they nominate every remaining player, so nudging cannot mean anything.
    const counts = { Alice: league.auctionSlots, Bob: league.auctionSlots }
    const input = { order: ORDER, baselineCounts: counts, log: [] }
    expect(derivePointer({ ...input, offset: 1 })).toBe(at('Cara'))
    expect(derivePointer({ ...input, offset: -4 })).toBe(at('Cara'))
  })

  it('survives a large offset without spinning', () => {
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], offset: 300 })).toBe(at('Alice'))
  })
})

describe('countsFromSlots', () => {
  it('counts a baseline per manager', () => {
    const counts = countsFromSlots({
      '0:5': { manager: 'Alice' },
      '0:6': { manager: 'Alice' },
      '7:5': { manager: 'Bob' },
    })
    expect(counts).toEqual({ Alice: 2, Bob: 1 })
  })

  it('is empty for an empty sheet', () => {
    expect(countsFromSlots({})).toEqual({})
  })
})
