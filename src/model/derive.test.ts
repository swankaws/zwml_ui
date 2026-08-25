import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { league } from '../config/league'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid, type ManagerBlock, type Pick } from '../data/gridParser'
import { deriveLeague, deriveManager, sortByMaxBid } from './derive'

function fixture(file: string) {
  return parseAuctionGrid(parseCsv(readFileSync(`docs/data-samples/${file}`, 'utf8')))
}

const partial = deriveLeague(fixture('2026-auction.csv').blocks)
const complete = deriveLeague(fixture('2025-auction.csv').blocks)

/** A block with synthetic picks, for the arithmetic cases the fixtures don't cover. */
function blockWith(prices: number[], name = 'Kevin'): ManagerBlock & { name: string } {
  const picks: Pick[] = prices.map((price, i) => ({
    position: 'RB',
    player: `Player ${i}`,
    price,
    row: 3 + i,
    slot: i < 7 ? 'starter' : 'bench',
    priceSuspect: false,
  }))
  return {
    name,
    rawName: name,
    band: 0,
    row: 1,
    col: 1,
    picks,
    sheet: { total: null, remaining: null, needs: null, maxBid: null, positionCounts: {} },
  }
}

describe('maxBid', () => {
  // The number the display exists to publish. Every case that matters is here.
  it('holds back $1 per unfilled slot', () => {
    // 1 pick at $10 -> $190 left, 14 slots to fill -> 190 - 13 = 177.
    expect(deriveManager(blockWith([10])).maxBid).toBe(177)
  })

  it('gives an untouched roster $186', () => {
    expect(deriveManager(blockWith([])).maxBid).toBe(186)
  })

  it('never drops below the minimum bid', () => {
    // Spend everything: remaining - needs + 1 goes negative, but you can always
    // bid $1 -- the league lets you fill a slot you cannot afford to bid up.
    const broke = deriveManager(blockWith(Array(14).fill(14)))
    expect(broke.remaining).toBe(4)
    expect(broke.maxBid).toBe(4)

    const broker = deriveManager(blockWith(Array(14).fill(200 / 14)))
    expect(broker.maxBid).toBe(league.minBid)
  })

  it('is null on a full roster, so the board can render FULL', () => {
    const full = deriveManager(blockWith(Array(15).fill(10)))
    expect(full.needs).toBe(0)
    expect(full.maxBid).toBeNull()
    expect(full.avgPerSlot).toBeNull()
  })

  it('stays null when a roster is somehow over-filled', () => {
    const over = deriveManager(blockWith(Array(16).fill(5)))
    expect(over.overRostered).toBe(true)
    expect(over.maxBid).toBeNull()
  })
})

describe('money', () => {
  it('renders a negative remaining honestly rather than flooring at zero', () => {
    // 2025 was legally uncapped; the display must show the truth for ?year=2025.
    const over = deriveManager(blockWith([206]))
    expect(over.remaining).toBe(-6)
    expect(over.pctRemaining).toBeCloseTo(-0.03)
  })

  it('flags an overspend now that 2026 enforces the cap', () => {
    expect(deriveManager(blockWith([201])).overspent).toBe(true)
    expect(deriveManager(blockWith([200])).overspent).toBe(false)
  })
})

describe('position counts', () => {
  it('counts only the positions the board shows', () => {
    const block = blockWith([1, 1, 1, 1]) // blockWith labels every pick RB
    const [first, second, third] = block.picks
    first!.position = 'QB'
    second!.position = 'WR'
    third!.position = null // an unlabeled bench row
    // the fourth stays RB

    const state = deriveManager(block)
    expect(state.positionCounts).toEqual({ QB: 1, RB: 1, WR: 1, TE: 0, K: 0 })
    // The unlabeled pick still consumes a slot even though it counts nowhere.
    expect(state.slotsFilled).toBe(4)
  })
})

describe('cross-check against the sheet own formulas', () => {
  /*
   * DESIGN.md 5.7's headline claim: on the 2026 tab, all 12 managers agree with
   * the sheet on spent, remaining, needs, and maxBid. That is a free continuous
   * correctness check, so it is worth asserting rather than believing.
   */
  it('agrees with the 2026 sheet on all four numbers, for all 12 managers', () => {
    expect(partial.managers).toHaveLength(12)
    const disagreeing = partial.managers.filter((m) => m.disagreements.length > 0)
    expect(disagreeing.map((m) => ({ name: m.name, d: m.disagreements }))).toEqual([])
  })

  it('reproduces the four spot-checked rows from 5.7', () => {
    const table = [
      { name: 'Kevin', needs: 11, remaining: 123, maxBid: 113 },
      { name: 'Corky', needs: 11, remaining: 135, maxBid: 125 },
      { name: 'Ryan', needs: 15, remaining: 200, maxBid: 186 },
      { name: 'Nick', needs: 14, remaining: 190, maxBid: 177 },
    ]
    for (const row of table) {
      const m = partial.managers.find((x) => x.name === row.name)
      expect(m, row.name).toBeDefined()
      expect({ name: m!.name, needs: m!.needs, remaining: m!.remaining, maxBid: m!.maxBid }).toEqual(row)
    }
  })

  it('agrees with the 2025 sheet on spent for all 12, disagreeing only where 5.7 says it should', () => {
    expect(complete.managers).toHaveLength(12)
    for (const m of complete.managers) {
      expect(m.disagreements.filter((d) => d.field === 'spent'), m.name).toEqual([])
    }
    // The known uncapped-year artifacts, pinned exactly rather than counted
    // loosely -- 5.7 previously mis-stated this set, and a vague assertion is how
    // that survived. Five overspenders whose Remaining the sheet floors at $0,
    // plus Marc, whose old formula is simply off by two.
    const remainingDisagreements = complete.managers
      .filter((m) => m.disagreements.some((d) => d.field === 'remaining'))
      .map((m) => m.name)
    expect(remainingDisagreements).toEqual(['Corky', 'Toby', 'Jeff', 'Marc', 'Derrick', 'Tony'])

    const marc = complete.managers.find((m) => m.name === 'Marc')
    expect(marc?.spent).toBe(198)
    expect(marc?.disagreements).toEqual([{ field: 'remaining', ours: 2, sheet: 4 }])

    // Nick was wrongly listed alongside Marc in 5.7. The sheet says $6, which is
    // exactly 200 - 194, so there is nothing to disagree about.
    const nick = complete.managers.find((m) => m.name === 'Nick')
    expect(nick?.spent).toBe(194)
    expect(nick?.remaining).toBe(6)
    expect(nick?.disagreements).toEqual([])
  })

  it('reproduces the AUCTION DISPLAY tab total for 2025', () => {
    // 5.6 records that tab's own league total as $2,411, computed by a completely
    // separate set of sheet formulas. Matching it is free independent corroboration
    // that the grid walk is reading the right cells.
    expect(complete.leagueSpent).toBe(2411)
    expect(complete.slotsFilled).toBe(180)
  })
})

describe('league aggregates', () => {
  it('sums the partially-cleared tab', () => {
    expect(partial.totalSlots).toBe(180)
    expect(partial.slotsFilled).toBe(partial.managers.reduce((s, m) => s + m.slotsFilled, 0))
    expect(partial.leagueNeeds).toBe(180 - partial.slotsFilled)
    expect(partial.draftComplete).toBe(false)
  })

  /*
   * The two header bugs review found. Both fixed in DESIGN.md section 6, both
   * asserted here because both are invisible until the end of the draft -- the
   * worst time to discover them.
   */
  it('does not divide by zero when the draft completes', () => {
    expect(complete.draftComplete).toBe(true)
    expect(complete.leagueNeeds).toBe(0)
    // The unguarded form yielded Infinity, which the header would have rendered
    // as "$Infinity/slot" at the most-watched moment of the night.
    expect(complete.avgPerRemainingSlot).toBeNull()
    expect(Number.isFinite(complete.avgPerRemainingSlot ?? 0)).toBe(true)
  })

  it('excludes dead money from dollars still chasing players', () => {
    // Two managers: one full but still holding $40, one with slots left.
    const blocks = [
      blockWith(Array(15).fill(10), 'Kevin'), // full, $50 left -> dead money
      blockWith([10], 'Corky'), // 14 slots left, $190 left
    ]
    const state = deriveLeague(blocks)

    expect(state.leagueNeeds).toBe(14)
    // Kevin's $50 cannot chase anything: he can never bid again.
    expect(state.leagueRemaining).toBe(190)
    expect(state.avgPerRemainingSlot).toBeCloseTo(190 / 14)
    // leagueSpent still counts everyone -- money spent is money spent.
    expect(state.leagueSpent).toBe(160)
  })

  it('reports no pace rather than a pace of zero when nobody can bid', () => {
    const state = deriveLeague([blockWith(Array(15).fill(10), 'Kevin')])
    expect(state.leagueRemaining).toBe(0)
    expect(state.avgPerRemainingSlot).toBeNull()
  })
})

describe('missing and unmatched blocks', () => {
  /*
   * The old spec here was `toHaveLength(11)` with the unknown manager present only
   * in `unmatched`. That is the roster-change failure: the league adds someone, or
   * spells a name differently, and the wall shows eleven people with no hint that a
   * twelfth exists. The sheet is the authority on the roster (derive.ts), so an
   * unknown name now gets a row under the sheet's own spelling.
   */
  it('gives an unrecognized manager a row under the sheet spelling, and still flags it', () => {
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    rows[1]![1] = 'Rob'

    const state = deriveLeague(parseAuctionGrid(rows).blocks)
    expect(state.unmatched).toEqual(['Rob'])
    expect(state.managers).toHaveLength(12)
    expect(state.managers.find((m) => m.name === 'Rob')).toBeDefined()
    // Kevin's cell is what was overwritten, so Kevin is genuinely absent.
    expect(state.managers.find((m) => m.name === 'Kevin')).toBeUndefined()
    // Unknown names sort after the known roster, so the table does not reshuffle.
    expect(state.managers.at(-1)?.name).toBe('Rob')
    // And the denominator follows the board rather than the committed list.
    expect(state.totalSlots).toBe(180)
  })

  it('counts total slots from the managers present, not the committed roster', () => {
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    rows[1]![1] = '' // Kevin's block loses its name entirely: eleven managers.

    const state = deriveLeague(parseAuctionGrid(rows).blocks)
    expect(state.managers).toHaveLength(11)
    expect(state.totalSlots).toBe(11 * league.auctionSlots)
  })

  it('renders managers in config order, not sheet order', () => {
    expect(partial.managers.map((m) => m.name)).toEqual([...league.managers])
  })

  it('handles an empty league without dividing by anything', () => {
    const state = deriveLeague([])
    expect(state.managers).toEqual([])
    expect(state.draftComplete).toBe(false)
    expect(state.avgPerRemainingSlot).toBeNull()
  })
})

describe('sortByMaxBid', () => {
  it('orders by who can outbid whom, with full rosters last', () => {
    const managers = [
      deriveManager(blockWith([100], 'Kevin')), // maxBid 87
      deriveManager(blockWith([], 'Corky')), // maxBid 186
      deriveManager(blockWith(Array(15).fill(1), 'Ryan')), // FULL
      deriveManager(blockWith([50], 'Toby')), // maxBid 137
    ]
    expect(sortByMaxBid(managers).map((m) => m.name)).toEqual(['Corky', 'Toby', 'Kevin', 'Ryan'])
  })

  it('does not mutate its input', () => {
    const managers = [deriveManager(blockWith([100], 'Kevin')), deriveManager(blockWith([], 'Corky'))]
    const before = managers.map((m) => m.name)
    sortByMaxBid(managers)
    expect(managers.map((m) => m.name)).toEqual(before)
  })

  it('breaks ties by name so rows do not jitter between polls', () => {
    // Two managers with identical max bids must not swap places on every render.
    const managers = [
      deriveManager(blockWith([10], 'Toby')),
      deriveManager(blockWith([10], 'Corky')),
    ]
    expect(sortByMaxBid(managers).map((m) => m.name)).toEqual(['Corky', 'Toby'])
  })
})
