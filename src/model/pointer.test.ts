import { describe, expect, it } from 'vitest'
import { countsFromSlots, derivePointer, nominatorBySeq, offsetAt, totalOffset } from './pointer'
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

describe('the operator correction (7.5)', () => {
  it('advances the pointer without touching the log', () => {
    const log = [sale(1, 'Alice')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log })).toBe(at('Bob'))
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log, adjustments: [{ afterSeq: 0, delta: 1 }] })).toBe(at('Cara'))
  })

  it('retreats', () => {
    const log = [sale(1, 'Alice')]
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log, adjustments: [{ afterSeq: 0, delta: -1 }] })).toBe(at('Alice'))
  })

  /*
   * The requirement that makes the offset an offset. A one-shot nudge would be wiped by the
   * very next sale, so the operator would have to re-correct after every single player for
   * the rest of the night.
   */
  it('persists across later sales rather than being consumed by them', () => {
    const one = derivePointer({ order: ORDER, baselineCounts: {}, log: [sale(1, 'Alice')], adjustments: [{ afterSeq: 0, delta: 1 }] })
    const two = derivePointer({
      order: ORDER,
      baselineCounts: {},
      log: [sale(1, 'Alice'), sale(2, 'Bob')],
      adjustments: [{ afterSeq: 0, delta: 1 }],
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
    expect(derivePointer({ order: ORDER, baselineCounts: counts, log: [], adjustments: [{ afterSeq: 0, delta: 1 }] })).toBe(at('Cara'))
  })

  it('wraps around the order', () => {
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], adjustments: [{ afterSeq: 0, delta: 3 }] })).toBe(at('Alice'))
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], adjustments: [{ afterSeq: 0, delta: -1 }] })).toBe(at('Cara'))
  })

  it('is a no-op when only one manager can still nominate', () => {
    // Endgame: they nominate every remaining player, so nudging cannot mean anything.
    const counts = { Alice: league.auctionSlots, Bob: league.auctionSlots }
    const input = { order: ORDER, baselineCounts: counts, log: [] }
    expect(derivePointer({ ...input, adjustments: [{ afterSeq: 0, delta: 1 }] })).toBe(at('Cara'))
    expect(derivePointer({ ...input, adjustments: [{ afterSeq: 0, delta: -4 }] })).toBe(at('Cara'))
  })

  it('survives a large offset without spinning', () => {
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log: [], adjustments: [{ afterSeq: 0, delta: 300 }] })).toBe(at('Alice'))
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

describe('nominatorBySeq (the history view)', () => {
  it('is empty with no order, because the nominator is then unknowable', () => {
    const log = [sale(1, 'Alice')]
    expect(nominatorBySeq({ order: [], baselineCounts: {}, log }).size).toBe(0)
  })

  it('walks the rotation, one nomination per sale', () => {
    const log = [sale(1, 'Cara'), sale(2, 'Cara'), sale(3, 'Cara')]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect([...nominators.values()]).toEqual(['Alice', 'Bob', 'Cara'])
  })

  it('names the NOMINATOR, not the buyer', () => {
    /*
     * The distinction the whole column exists for. Anyone may outbid whoever put the player up, and
     * the sheet records only the buyer -- so a history that showed `manager` under "nominated by"
     * would be confidently wrong on most rows.
     */
    const log = [sale(1, 'Cara')]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect(nominators.get(1)).toBe('Alice')
    expect(nominators.get(1)).not.toBe(log[0]!.manager)
  })

  it('keys by seq, so a retraction cannot shift every later name', () => {
    // Positional alignment would misattribute the whole night after one deleted pick.
    const log = [sale(1, 'Alice'), sale(3, 'Bob')]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect(nominators.get(1)).toBe('Alice')
    expect(nominators.get(3)).toBe('Bob')
    expect(nominators.has(2)).toBe(false)
  })

  it('skips a manager whose roster filled mid-draft', () => {
    const counts = { Bob: league.auctionSlots - 1 }
    const log = [sale(1, 'Bob'), sale(2, 'Cara')]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: counts, log })
    // Alice nominates first; Bob's own purchase fills him, so Cara nominates second.
    expect([...nominators.values()]).toEqual(['Alice', 'Cara'])
  })

  it('replays out of order safely', () => {
    const log = [sale(2, 'Bob'), sale(1, 'Alice')]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect(nominators.get(1)).toBe('Alice')
    expect(nominators.get(2)).toBe('Bob')
  })

  it('stops rather than looping once every roster is full', () => {
    const counts = Object.fromEntries(ORDER.map((n) => [n, league.auctionSlots]))
    expect(nominatorBySeq({ order: ORDER, baselineCounts: counts, log: [sale(1, 'Alice')] }).size).toBe(0)
  })
})

/*
 * The bug the maintainer found on 2026-08-26, and the rule that settles it: the history view must name
 * whoever the wall was SHOWING on the clock when each pick was entered.
 *
 * The first version ignored corrections entirely, so history printed names the operator had already
 * told the board were wrong. Blindly applying the running total would have gone too far the other way
 * and rewritten an hour of history to match a late fix. Stamping each correction with the sale it
 * followed is what lets it do neither.
 */
describe('history and a mid-draft correction', () => {
  const log = [sale(1, 'Alice'), sale(2, 'Bob'), sale(3, 'Cara'), sale(4, 'Alice')]

  it('leaves sales made before the correction alone', () => {
    // `N` pressed after sale 2. Sales 1 and 2 were nominated under the old, uncorrected pointer.
    const nominators = nominatorBySeq({
      order: ORDER,
      baselineCounts: {},
      log,
      adjustments: [{ afterSeq: 2, delta: 1 }],
    })
    const uncorrected = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect(nominators.get(1)).toBe(uncorrected.get(1))
    expect(nominators.get(2)).toBe(uncorrected.get(2))
  })

  it('applies it to sales made after', () => {
    const nominators = nominatorBySeq({
      order: ORDER,
      baselineCounts: {},
      log,
      adjustments: [{ afterSeq: 2, delta: 1 }],
    })
    const uncorrected = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    expect(nominators.get(3)).not.toBe(uncorrected.get(3))
    expect(nominators.get(4)).not.toBe(uncorrected.get(4))
  })

  it('matches what the live pointer showed at the time, sale for sale', () => {
    /*
     * The strongest form of the rule, and the one worth having: replay the night one sale at a time,
     * asking the LIVE pointer who was on the clock just before each pick, and check the history agrees.
     * If these two ever diverge, the history is lying about something the room watched happen.
     */
    const adjustments = [{ afterSeq: 2, delta: 1 }]
    const nominators = nominatorBySeq({ order: ORDER, baselineCounts: {}, log, adjustments })

    for (const entry of log) {
      const before = log.filter((s) => s.seq < entry.seq)
      const onClockThen = derivePointer({
        order: ORDER,
        baselineCounts: {},
        log: before,
        // Only the corrections that existed at that moment.
        adjustments: adjustments.filter((a) => a.afterSeq < entry.seq),
      })
      expect(nominators.get(entry.seq), `seq ${entry.seq}`).toBe(ORDER[onClockThen!])
    }
  })

  it('handles a correction made before the first sale', () => {
    // `afterSeq: 0` -- pressed while the board was still empty, so it applies to everything.
    const nominators = nominatorBySeq({
      order: ORDER,
      baselineCounts: {},
      log,
      adjustments: [{ afterSeq: 0, delta: 1 }],
    })
    expect(nominators.get(1)).toBe(at('Bob') === 1 ? 'Bob' : ORDER[1])
  })

  it('accumulates several corrections in the order they were made', () => {
    const nominators = nominatorBySeq({
      order: ORDER,
      baselineCounts: {},
      log,
      adjustments: [
        { afterSeq: 1, delta: 1 },
        { afterSeq: 3, delta: -1 },
      ],
    })
    const plain = nominatorBySeq({ order: ORDER, baselineCounts: {}, log })
    // Sale 1: nothing yet. Sales 2-3: +1. Sale 4: +1 then -1, back to the plain replay.
    expect(nominators.get(1)).toBe(plain.get(1))
    expect(nominators.get(2)).not.toBe(plain.get(2))
    expect(nominators.get(4)).toBe(plain.get(4))
  })

  it('sums every correction for the LIVE pointer, whenever they were made', () => {
    // The live pointer is about now, so timing does not matter to it -- only the total does.
    const adjustments = [
      { afterSeq: 1, delta: 1 },
      { afterSeq: 9, delta: 1 },
    ]
    expect(totalOffset(adjustments)).toBe(2)
    expect(derivePointer({ order: ORDER, baselineCounts: {}, log, adjustments })).toBe(
      derivePointer({
        order: ORDER,
        baselineCounts: {},
        log,
        adjustments: [{ afterSeq: 0, delta: 2 }],
      }),
    )
  })
})

describe('offsetAt', () => {
  const adjustments = [
    { afterSeq: 2, delta: 1 },
    { afterSeq: 5, delta: -1 },
  ]

  it('counts only what was already in force', () => {
    expect(offsetAt(adjustments, 1)).toBe(0)
    expect(offsetAt(adjustments, 2)).toBe(0)
    expect(offsetAt(adjustments, 3)).toBe(1)
    expect(offsetAt(adjustments, 5)).toBe(1)
    expect(offsetAt(adjustments, 6)).toBe(0)
  })

  it('is zero with no corrections', () => {
    expect(offsetAt([], 7)).toBe(0)
  })
})
