import { describe, expect, it } from 'vitest'
import { applyDiff, diffSlots, nextSequence, snapshotSlots, type SlotMap } from './diff'
import type { ManagerBlock, Pick } from '../data/gridParser'

function pick(over: Partial<Pick> = {}): Pick {
  return {
    position: 'RB',
    player: 'Bijan Robinson',
    price: 61,
    row: 5,
    slot: 'starter',
    priceSuspect: false,
    ...over,
  }
}

function block(over: Partial<ManagerBlock> = {}): ManagerBlock {
  return {
    name: 'Kevin',
    rawName: 'Kevin',
    band: 0,
    row: 2,
    col: 0,
    picks: [pick()],
    bonus: 0,
    sheet: { total: null, remaining: null, needs: null, maxBid: null, positionCounts: {} },
    ...over,
  }
}

/** Convenience: a slot map holding one creditable pick at `0:5`. */
function oneSale(over: Partial<Pick> = {}): SlotMap {
  return snapshotSlots([block({ picks: [pick(over)] })])
}

describe('snapshotSlots', () => {
  it('addresses slots geometrically, so a renamed manager is not fifteen phantom sales', () => {
    const before = snapshotSlots([block({ name: 'Nick', rawName: 'Nick' })])
    const after = snapshotSlots([block({ name: 'Kris', rawName: 'Kris' })])

    expect(Object.keys(after)).toEqual(Object.keys(before))
    const diff = diffSlots(before, after, 1)
    expect(diff.sales).toEqual([])
    expect(diff.retracted).toEqual([])
    // The buyer's display name is corrected in place, which is what the ticker should show.
    expect(diff.corrections).toEqual([])
  })

  it('keys on column as well as row, since a band shares row numbers', () => {
    const slots = snapshotSlots([
      block({ name: 'Kevin', col: 0, picks: [pick({ row: 5 })] }),
      block({ name: 'Toby', col: 7, picks: [pick({ row: 5, player: 'Puka Nacua' })] }),
    ])
    expect(Object.keys(slots).sort()).toEqual(['0:5', '7:5'])
  })

  it('skips a block whose name cell is blank, rather than attributing a sale to nobody', () => {
    expect(snapshotSlots([block({ name: null, rawName: '   ' })])).toEqual({})
  })
})

describe('diffSlots', () => {
  it('emits nothing when the baseline already holds the picks -- keepers are not sales', () => {
    const baseline = oneSale()
    expect(diffSlots(baseline, baseline, 1)).toEqual({ sales: [], corrections: [], retracted: [] })
  })

  it('emits a sale when a player appears where nothing was', () => {
    const diff = diffSlots({}, oneSale(), 1)
    expect(diff.sales).toEqual([
      { slot: '0:5', seq: 1, player: 'Bijan Robinson', price: 61, manager: 'Kevin', position: 'RB' },
    ])
  })

  it('numbers sales from the sequence it is given, so the log continues', () => {
    const diff = diffSlots({}, oneSale(), 8)
    expect(diff.sales[0]?.seq).toBe(8)
  })

  it('treats a later price edit as a correction, not a second sale', () => {
    const diff = diffSlots(oneSale(), oneSale({ price: 47 }), 2)
    expect(diff.sales).toEqual([])
    expect(diff.corrections).toEqual([
      { slot: '0:5', seq: 0, player: 'Bijan Robinson', price: 47, manager: 'Kevin', position: 'RB' },
    ])
  })

  it('treats a player replaced in the same slot as a correction', () => {
    const diff = diffSlots(oneSale(), oneSale({ player: 'Jahmyr Gibbs' }), 2)
    expect(diff.sales).toEqual([])
    expect(diff.corrections[0]?.player).toBe('Jahmyr Gibbs')
  })

  it('retracts a slot that was cleared', () => {
    const diff = diffSlots(oneSale(), {}, 2)
    expect(diff.retracted).toEqual(['0:5'])
    expect(diff.sales).toEqual([])
  })

  it('emits every sale in a batch, for one good poll after an outage', () => {
    const next = snapshotSlots([
      block({ picks: [pick({ row: 5 }), pick({ row: 6, player: 'Puka Nacua', price: 44 })] }),
    ])
    const diff = diffSlots({}, next, 1)
    expect(diff.sales.map((s) => s.seq)).toEqual([1, 2])
  })

  /*
   * The $0 hold-back. Both of these reach the parser as a pick: an unparseable price
   * becomes $0 with `priceSuspect`, and a lone `-` becomes a legitimate $0. Neither is a
   * sale, and announcing one would put `$0 -> Kevin` on the wall AND advance the
   * nomination pointer onto the wrong manager.
   */
  it.each([
    ['a suspect price', { price: 0, priceSuspect: true }],
    ['a legitimate $0', { price: 0, priceSuspect: false }],
  ])('holds back %s until it has a real price', (_label, over) => {
    const held = oneSale(over)
    expect(diffSlots({}, held, 1).sales).toEqual([])

    // ...and announces it exactly once, when the price lands.
    const priced = diffSlots(held, oneSale({ price: 61 }), 1)
    expect(priced.sales.map((s) => s.price)).toEqual([61])
    expect(priced.corrections).toEqual([])
  })

  it('retracts a sale whose price was blanked back to zero', () => {
    const diff = diffSlots(oneSale(), oneSale({ price: 0 }), 2)
    expect(diff.retracted).toEqual(['0:5'])
  })
})

describe('applyDiff', () => {
  const log = [
    { slot: '0:5', seq: 1, player: 'Bijan Robinson', price: 61, manager: 'Kevin', position: 'RB' as const },
    { slot: '7:5', seq: 2, player: 'Puka Nacua', price: 44, manager: 'Toby', position: 'WR' as const },
  ]

  it('returns the SAME array reference when nothing changed', () => {
    // Not merely an optimization: boardStore publishes this into a snapshot the error
    // boundary uses as its reset key, so a fresh array every poll churns the boundary.
    const result = applyDiff(log, { sales: [], corrections: [], retracted: [] })
    expect(result).toBe(log)
  })

  it('appends new sales in sequence', () => {
    const sale = { slot: '0:6', seq: 3, player: 'Jahmyr Gibbs', price: 52, manager: 'Kevin', position: 'RB' as const }
    expect(applyDiff(log, { sales: [sale], corrections: [], retracted: [] })).toEqual([...log, sale])
  })

  it('rewrites a correction in place, keeping its original sequence', () => {
    const fix = { slot: '0:5', seq: 0, player: 'Bijan Robinson', price: 47, manager: 'Kevin', position: 'RB' as const }
    const result = applyDiff(log, { sales: [], corrections: [fix], retracted: [] })
    // Still first in the log -- a typo fix must not re-announce an hour-old sale.
    expect(result[0]).toEqual({ ...fix, seq: 1 })
    expect(result).toHaveLength(2)
  })

  it('drops a retracted slot from history', () => {
    const result = applyDiff(log, { sales: [], corrections: [], retracted: ['0:5'] })
    expect(result.map((e) => e.slot)).toEqual(['7:5'])
  })

  it('does not cap the log, because the pointer is recomputed from all of it', () => {
    const many = Array.from({ length: 40 }, (_unused, i) => ({
      slot: `0:${i}`,
      seq: i + 1,
      player: `P${i}`,
      price: 5,
      manager: 'Kevin',
      position: null,
    }))
    const result = applyDiff([], { sales: many, corrections: [], retracted: [] })
    expect(result).toHaveLength(40)
  })
})

describe('nextSequence', () => {
  it('starts at 1 for an empty log', () => {
    expect(nextSequence([])).toBe(1)
  })

  it('continues past the highest sequence, not the length', () => {
    // Length would collide after a retraction, silently giving two sales the same seq.
    expect(nextSequence([{ slot: '0:9', seq: 7, player: 'X', price: 1, manager: 'Kevin', position: null }])).toBe(8)
  })
})
