/**
 * End-to-end: an edit in the sheet -> a sale -> the nomination pointer moves.
 *
 * Every other test here covers one link of that chain in isolation. This one runs the
 * whole thing on the REAL committed CSV through the REAL parser, because the question it
 * answers is the operational one the maintainer actually asked four days before the draft:
 * "if I add a player to the 2026 Auction tab, will the order increment?"
 *
 * The answer is yes, and the interesting part is the edges -- a name with no price yet, a
 * `$0`, a later correction, a deletion. Those are the states a sheet passes THROUGH while
 * someone types, and each one of them reaching the wall as a sale would move the pointer
 * onto the wrong manager in front of the whole room.
 */

import { describe, expect, it } from 'vitest'
import raw2026 from '../../docs/data-samples/2026-auction.csv?raw'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid } from '../data/gridParser'
import { applyDiff, diffSlots, nextSequence, snapshotSlots, type SaleEvent, type SlotMap } from './diff'
import { countsFromSlots, derivePointer } from './pointer'
import { league } from '../config/league'

/** Widened deliberately: the order is data at runtime, not a literal union. */
const ORDER: readonly string[] = [...league.managers]

/** Kevin's block: band row 1, start col 1. His TE starter row is empty in the fixture. */
const KEVIN_TE_ROW = league.grid.bandRows[0]! + league.grid.rowOffsets.starters[0] + 5
const KEVIN_COL = league.grid.blockStartCols[0]!
/** Tony's block sits in the third band, first column. His bench is empty. */
const TONY_ROW = league.grid.bandRows[2]! + league.grid.rowOffsets.bench[0]
const TONY_COL = league.grid.blockStartCols[0]!

type Grid = string[][]

function grid(): Grid {
  return parseCsv(raw2026).map((row) => [...row])
}

/** Types into a cell the way a person would, growing the row if the CSV was short. */
function type(g: Grid, row: number, col: number, value: string): Grid {
  const line = g[row] ?? []
  while (line.length <= col) line.push('')
  line[col] = value
  g[row] = line
  return g
}

function addPick(g: Grid, row: number, col: number, player: string, price: string): Grid {
  const { colOffsets } = league.grid
  type(g, row, col + colOffsets.player, player)
  type(g, row, col + colOffsets.price, price)
  return g
}

function slotsOf(g: Grid): SlotMap {
  const tab = parseAuctionGrid(g)
  expect(tab.renderable).toBe(true)
  return snapshotSlots(tab.blocks)
}

/** One poll: diff against the previous slots, fold into the log. */
function poll(previous: SlotMap, next: SlotMap, log: readonly SaleEvent[]) {
  const diff = diffSlots(previous, next, nextSequence(log))
  return { log: applyDiff(log, diff), diff }
}

describe('a sheet edit reaching the nomination pointer', () => {
  const baseline = slotsOf(grid())
  const baselineCounts = countsFromSlots(baseline)
  const at = (name: string) => ORDER.indexOf(name)
  const pointer = (log: readonly SaleEvent[], offset = 0) =>
    derivePointer({ order: ORDER, baselineCounts, log, offset })

  it('treats everything already in the sheet as the baseline, not as sales', () => {
    /*
     * The keepers entered in the days before the draft: nine of them in this capture of
     * the tab (the live sheet was up to 39 by 2026-08-26, and both are keepers as far as
     * the board is concerned). None of them may reach the ticker or move the pointer (7.3).
     */
    expect(Object.keys(baseline)).toHaveLength(9)
    const { log } = poll(baseline, slotsOf(grid()), [])
    expect(log).toEqual([])
    expect(pointer(log)).toBe(at(ORDER[0]!))
  })

  it('advances the pointer by one when a player is added WITH a price', () => {
    const next = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9'))
    const { log, diff } = poll(baseline, next, [])

    expect(diff.sales).toHaveLength(1)
    expect(diff.sales[0]).toMatchObject({ player: 'Brock Bowers', price: 9, manager: 'Kevin' })
    expect(pointer(log)).toBe(at(ORDER[1]!))
  })

  /*
   * The state a sheet is in for the second or two between typing a name and typing a
   * price. It must be invisible: a sale announced here would name a player at $0 and step
   * the pointer, and then the real price would arrive with the pointer already wrong.
   *
   * This one is free -- the parser itself skips a row whose price cell is blank
   * (gridParser `collect`) -- and it is tested here because that behavior is now
   * load-bearing for the pointer, not merely a parsing detail.
   */
  it('does nothing at all while a name is typed but the price is still blank', () => {
    const next = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', ''))
    const { log, diff } = poll(baseline, next, [])

    expect(diff.sales).toEqual([])
    expect(log).toEqual([])
    expect(pointer(log)).toBe(at(ORDER[0]!))
  })

  it.each([
    ['a literal $0', '$0'],
    ['a dash placeholder', '-'],
    ['an unparseable price', 'tbd'],
  ])('holds the sale back for %s, then announces it once the real price lands', (_label, priceCell) => {
    const held = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', priceCell))
    const first = poll(baseline, held, [])
    expect(first.log).toEqual([])
    expect(pointer(first.log)).toBe(at(ORDER[0]!))

    const priced = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9'))
    const second = poll(held, priced, first.log)
    expect(second.diff.sales.map((s) => s.price)).toEqual([9])
    expect(pointer(second.log)).toBe(at(ORDER[1]!))
  })

  /*
   * The rotation is independent of the bidding. Anyone may outbid whoever nominated, so the
   * buyer's name changes who is FULL and nothing else -- the pointer still moves exactly one
   * eligible position per sale.
   */
  it('advances by one regardless of which manager won the player', () => {
    const kevin = poll(baseline, slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9')), [])
    const tony = poll(baseline, slotsOf(addPick(grid(), TONY_ROW, TONY_COL, 'Brock Bowers', '$9')), [])

    expect(kevin.diff.sales[0]?.manager).toBe('Kevin')
    expect(tony.diff.sales[0]?.manager).not.toBe('Kevin')
    expect(pointer(kevin.log)).toBe(pointer(tony.log))
  })

  it('advances twice when two players are entered between polls', () => {
    const g = addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9')
    addPick(g, TONY_ROW, TONY_COL, 'Javonte Williams', '$2')
    const { log, diff } = poll(baseline, slotsOf(g), [])

    expect(diff.sales).toHaveLength(2)
    expect(pointer(log)).toBe(at(ORDER[2]!))
  })

  it('does not advance a second time when a price is corrected after the fact', () => {
    const sold = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9'))
    const first = poll(baseline, sold, [])

    const fixed = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$14'))
    const second = poll(sold, fixed, first.log)

    expect(second.diff.sales).toEqual([])
    expect(second.log).toHaveLength(1)
    expect(second.log[0]).toMatchObject({ price: 14, seq: 1 })
    expect(pointer(second.log)).toBe(at(ORDER[1]!))
  })

  /*
   * Deleting a pick walks the pointer BACK, which is only possible because the pointer is
   * recomputed from the whole log rather than incremented in place. It is the reason the log
   * is not truncated at eight entries the way 7.3 suggests.
   */
  it('walks the pointer back when a pick is deleted from the sheet', () => {
    const sold = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9'))
    const first = poll(baseline, sold, [])
    expect(pointer(first.log)).toBe(at(ORDER[1]!))

    const second = poll(sold, baseline, first.log)
    expect(second.diff.retracted).toHaveLength(1)
    expect(second.log).toEqual([])
    expect(pointer(second.log)).toBe(at(ORDER[0]!))
  })

  it('keeps the operator correction on top of whatever the sheet does next', () => {
    // `N` pressed once while the board was one behind; then a sale lands. The correction
    // must still be applied, or the operator would re-press after every player (7.5).
    const sold = slotsOf(addPick(grid(), KEVIN_TE_ROW, KEVIN_COL, 'Brock Bowers', '$9'))
    const { log } = poll(baseline, sold, [])
    expect(pointer(log, 1)).toBe(at(ORDER[2]!))
  })
})
