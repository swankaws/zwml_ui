import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { league } from '../config/league'
import { parseOrder } from '../config/displaySettings'
import { parseCsv } from './csv'
import { a1, parseAuctionGrid, type ParsedTab } from './gridParser'

function parseFixture(file: string): ParsedTab {
  return parseAuctionGrid(parseCsv(readFileSync(`docs/data-samples/${file}`, 'utf8')))
}

/** Writes one cell of a parsed grid. Keeps the mutation tests readable under
 * `noUncheckedIndexedAccess`, which otherwise objects to every `rows[r][c] =`. */
function setCell(rows: string[][], row: number, col: number, value: string): void {
  const target = rows[row]
  if (!target) throw new Error(`fixture has no row ${row}`)
  target[col] = value
}

const partial = parseFixture('2026-auction.csv')
const complete = parseFixture('2025-auction.csv')

describe('a1', () => {
  it('renders 0-indexed coordinates as sheet references', () => {
    // The whole point of the helper: a warning you can check by eye against the
    // sheet. Band 1 starts at 0-indexed (1, 1) = B2.
    expect(a1(1, 1)).toBe('B2')
    expect(a1(18, 3)).toBe('D19')
    expect(a1(43, 19)).toBe('T44')
  })

  it('handles columns past Z', () => {
    expect(a1(0, 26)).toBe('AA1')
    expect(a1(0, 27)).toBe('AB1')
  })
})

describe('template verification against both live fixtures', () => {
  /*
   * DESIGN.md 5.7 claims "template: zero violations" across all 24 blocks in both
   * tabs. That claim is the foundation the whole parser stands on, so it is
   * asserted here rather than trusted.
   */
  for (const [label, parsed] of [
    ['2026 (partially cleared)', partial],
    ['2025 (completed)', complete],
  ] as const) {
    describe(label, () => {
      it('finds all 12 manager blocks', () => {
        expect(parsed.blocks).toHaveLength(12)
        expect(parsed.blocks.map((b) => b.name).filter(Boolean)).toHaveLength(12)
      })

      it('produces zero template warnings', () => {
        // If this ever fails, the message names the exact cell -- read it.
        expect(parsed.warnings).toEqual([])
      })

      it('is renderable', () => {
        expect(parsed.renderable).toBe(true)
      })

      it('never exceeds 15 auction slots per manager', () => {
        for (const block of parsed.blocks) {
          expect(block.picks.length).toBeLessThanOrEqual(league.auctionSlots)
        }
      })

      it('excludes the DEF row from picks', () => {
        // DEF sits at bandRow + 17, one past the last bench row.
        const defRows = league.grid.bandRows.map((r) => r + league.grid.rowOffsets.def)
        for (const block of parsed.blocks) {
          for (const pick of block.picks) {
            expect(defRows).not.toContain(pick.row)
          }
        }
      })

      it('assigns every pick a position, since the sheet labels them', () => {
        for (const block of parsed.blocks) {
          for (const pick of block.picks) {
            expect(pick.position, `${block.name} / ${pick.player} at ${a1(pick.row, block.col)}`)
              .not.toBeNull()
          }
        }
      })

      it('reads no suspect prices', () => {
        const suspect = parsed.blocks.flatMap((b) =>
          b.picks.filter((p) => p.priceSuspect).map((p) => `${b.name}/${p.player}`),
        )
        expect(suspect).toEqual([])
      })
    })
  }
})

describe('the 2025 fixture is a completed draft', () => {
  it('gives every manager a full 15-man roster', () => {
    for (const block of complete.blocks) {
      expect(block.picks.length, `${block.name}`).toBe(league.auctionSlots)
    }
  })
})

describe('the 2026 fixture is partially cleared', () => {
  it('has managers with picks and managers with none', () => {
    const counts = partial.blocks.map((b) => b.picks.length)
    expect(Math.min(...counts)).toBe(0)
    expect(Math.max(...counts)).toBeGreaterThan(0)
  })

  // The two ends of the range are the cases most likely to break: a block with
  // nothing in it, and a block with real data.
  it('reads Kevin as a partially-filled roster', () => {
    const kevin = partial.blocks.find((b) => b.name === 'Kevin')
    expect(kevin?.picks.length).toBe(4)
    expect(kevin?.sheet.needs).toBe(11)
    expect(kevin?.sheet.maxBid).toBe(113)
  })

  it('reads Ryan as an empty roster', () => {
    const ryan = partial.blocks.find((b) => b.name === 'Ryan')
    expect(ryan?.picks).toEqual([])
    expect(ryan?.sheet.needs).toBe(15)
  })
})

describe('band 3 lands on rows 53-60, not shifted', () => {
  /*
   * This is the geometry claim an earlier revision of the design got wrong, from
   * a gviz artifact rather than the sheet (DESIGN.md 5.0). Asserting it directly
   * so the mistake cannot come back.
   */
  it('reads band 3 bench picks from the expected rows', () => {
    const band3 = complete.blocks.filter((b) => b.band === 2)
    expect(band3).toHaveLength(4)

    const benchRows = band3.flatMap((b) => b.picks.filter((p) => p.slot === 'bench').map((p) => p.row))
    expect(benchRows.length).toBeGreaterThan(0)
    // 0-indexed 52..59 == sheet rows 53..60.
    for (const row of benchRows) {
      expect(row).toBeGreaterThanOrEqual(52)
      expect(row).toBeLessThanOrEqual(59)
    }
  })
})

describe('the slot test runs on raw cells', () => {
  /*
   * The bug review caught (DESIGN.md 5.3): a player name typed a keystroke before
   * its price must NOT become a $0 pick, because every single sale passes through
   * that state and a 3 s poll will sometimes catch it.
   */
  const grid = () => parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))

  it('ignores a player whose price cell is still blank', () => {
    const rows = grid()
    // Kevin's block: band row 1, col 1. First empty bench row is bandRow+9 = 10.
    setCell(rows, 10, 2, 'Brock Bowers')
    setCell(rows, 10, 3, '')

    const parsed = parseAuctionGrid(rows)
    const kevin = parsed.blocks.find((b) => b.name === 'Kevin')
    expect(kevin?.picks.map((p) => p.player)).not.toContain('Brock Bowers')
    expect(kevin?.picks.length).toBe(4)
    // Silent by design: a row mid-entry is not a data error.
    expect(parsed.warnings).toEqual([])
  })

  it('counts the pick as soon as the price lands', () => {
    const rows = grid()
    setCell(rows, 10, 2, 'Brock Bowers')
    setCell(rows, 10, 3, '$31')

    const kevin = parseAuctionGrid(rows).blocks.find((b) => b.name === 'Kevin')
    expect(kevin?.picks.length).toBe(5)
    expect(kevin?.picks.at(-1)).toMatchObject({ player: 'Brock Bowers', price: 31, slot: 'bench' })
  })

  it('counts a present-but-unparseable price as $0 and warns', () => {
    const rows = grid()
    setCell(rows, 10, 2, 'Brock Bowers')
    setCell(rows, 10, 3, 'TBD')

    const parsed = parseAuctionGrid(rows)
    const kevin = parsed.blocks.find((b) => b.name === 'Kevin')
    expect(kevin?.picks.at(-1)).toMatchObject({ player: 'Brock Bowers', price: 0, priceSuspect: true })
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.warnings[0]).toMatchObject({ ref: 'D11', severity: 'warning' })
  })
})

describe('the A1 nomination-order hint', () => {
  /*
   * A1 is the cheapest order source there is: no gid, no second request, no deploy,
   * and it arrives in a fetch the app already makes. It is also outside every band
   * (bandRows starts at row 1), so reading it cannot disturb the verified geometry.
   */
  it('hands A1 through verbatim, without interpreting it', () => {
    expect(partial.orderHint).toBe(
      'Jeff > Toby > Tony > Derrick > Marc > Corky > Bill > Ryan > Colin > Kevin > Kris > Jason',
    )
  })

  /*
   * And this is why it is a hint rather than truth. The 2025 capture's A1 names
   * `Rob`, who drafted on Jason's behalf years ago and has never been a manager --
   * the cell sat stale for years. Validation must reject it and fall through rather
   * than put a non-manager on the wall.
   *
   * This case used to be pinned on BOTH fixtures. 2026's A1 was corrected by the
   * maintainer on 2026-08-25 and the fixture re-captured, so 2025 is now its only
   * home -- and a better one, being a closed season that will never be re-exported.
   */
  it('is stale in the 2025 capture, which is the case validation has to survive', () => {
    expect(complete.orderHint).toContain('Rob')
    expect(parseOrder(complete.orderHint).order).toBeNull()
  })

  it('is empty rather than undefined when A1 is blank', () => {
    expect(parseAuctionGrid([]).orderHint).toBe('')
    expect(parseAuctionGrid([['  ']]).orderHint).toBe('')
  })

  /*
   * The live 2026 A1, resolving against the roster THIS TAB reported -- built the way
   * production builds it, from the parsed blocks. That distinction is the whole point:
   * `Kris` joined the league days before the draft, so an order naming him only
   * validates because the roster came from the sheet rather than from a committed list.
   */
  it('validates against the parsed roster, so the live A1 resolves cleanly', () => {
    const roster = partial.blocks.flatMap((b) => (b.name ? [b.name] : []))
    expect(roster).toContain('Kris')

    const { order, warnings } = parseOrder(partial.orderHint, roster)
    expect(order).toEqual([
      'Jeff', 'Toby', 'Tony', 'Derrick', 'Marc', 'Corky',
      'Bill', 'Ryan', 'Colin', 'Kevin', 'Kris', 'Jason',
    ])
    expect(warnings).toEqual([])
  })

  /*
   * The regression the re-capture removed, kept as an assertion because it is easy to
   * reintroduce: while 2026's A1 was stale, every render of the live tab emitted a
   * rejected-order warning. A clean A1 means draft night starts with a silent console,
   * which is what makes a warning that DOES appear worth looking at.
   */
  it('leaves the 2026 board with no warnings at all', () => {
    expect(partial.warnings).toEqual([])
    expect(parseOrder(partial.orderHint, partial.blocks.flatMap((b) => (b.name ? [b.name] : []))).warnings).toEqual([])
  })
})

describe('degradation, not exceptions', () => {
  it('survives an empty grid without throwing', () => {
    const parsed = parseAuctionGrid([])
    expect(parsed.renderable).toBe(false)
    expect(parsed.blocks).toHaveLength(12)
  })

  it('survives a ragged grid without throwing', () => {
    const parsed = parseAuctionGrid([['a'], [], ['b', 'c']])
    expect(parsed.renderable).toBe(false)
  })

  it('refuses to render when the Total anchor is gone', () => {
    // The structural check of 5.4 step 6: no Total means the block shape is not
    // what we think it is, and rendering would be worse than not rendering.
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    setCell(rows, 19, 2, 'Sum')

    const parsed = parseAuctionGrid(rows)
    expect(parsed.renderable).toBe(false)
    expect(parsed.warnings.some((w) => w.severity === 'fatal' && w.ref === 'C20')).toBe(true)
  })

  it('counts recognized names against the grid, not against the committed roster', () => {
    /*
     * This gate used to compare `named` with `league.managers.length`. The two happen
     * to both be 12, but they answer different questions -- "did this tab's name cells
     * resolve" is a property of the tab, the roster is a property of the season. The
     * old form meant a config carrying a name the tab does not have, or a year with
     * eleven managers, raised a false alarm on every 3-second poll.
     */
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    setCell(rows, 43, 13, 'Rob') // N44: one of twelve now unrecognized

    const parsed = parseAuctionGrid(rows)
    const counted = parsed.warnings.find((w) => /manager names recognized/.test(w.message))
    expect(counted?.message).toBe('Only 11 of 12 manager names recognized')
  })

  it('surfaces an unrecognized manager name instead of dropping the block', () => {
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    setCell(rows, 1, 1, 'Rob')

    const parsed = parseAuctionGrid(rows)
    expect(parsed.renderable).toBe(true)
    expect(parsed.blocks.find((b) => b.rawName === 'Rob')?.name).toBeNull()
    expect(parsed.warnings.some((w) => w.ref === 'B2' && /Unrecognized/.test(w.message))).toBe(true)
  })

  it('detects a one-row shift rather than parsing it happily', () => {
    /*
     * The failure mode 5.4 warns about: shift by one and it still "parses", it
     * just drops every QB and reads DEF as a pick. The label assertions are the
     * only thing standing between that and a plausible, wrong board.
     */
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    rows.unshift(Array(rows[0]?.length ?? 0).fill(''))

    const parsed = parseAuctionGrid(rows)
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.renderable).toBe(false)
  })
})

/*
 * Bonus money (2026). It lives in the STAT column at offset 9, immediately after `K` -- not in new
 * rows below `Remaining`, because inserting rows would move every slot key the diff engine depends
 * on. See the note on `rowOffsets.bonus`.
 */
describe('bonus money', () => {
  const BAND = league.grid.bandRows[0]!
  const COL = league.grid.blockStartCols[0]!
  const LABEL_COL = COL + league.grid.colOffsets.statLabel
  const VALUE_COL = COL + league.grid.colOffsets.statValue
  const ROW = BAND + league.grid.rowOffsets.bonus

  function withBonus(label: string, value: string): ReturnType<typeof parseAuctionGrid> {
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    setCell(rows, ROW, LABEL_COL, label)
    setCell(rows, ROW, VALUE_COL, value)
    return parseAuctionGrid(rows)
  }

  it('reads the value the live sheet spells "Bonus $"', () => {
    const tab = withBonus('Bonus $', '$25')
    expect(tab.blocks[0]?.bonus).toBe(25)
    expect(tab.warnings).toEqual([])
  })

  it('accepts the label without the dollar sign', () => {
    expect(withBonus('Bonus', '25').blocks[0]?.bonus).toBe(25)
  })

  it('is case-insensitive, like every other label in this parser', () => {
    expect(withBonus('BONUS $', '25').blocks[0]?.bonus).toBe(25)
  })

  it('reads a negative bonus, since a penalty is the same mechanism', () => {
    expect(withBonus('Bonus $', '-10').blocks[0]?.bonus).toBe(-10)
  })

  /*
   * The silence that matters. These rows sit empty all night until the league runners award
   * anything, and 2025 has no bonus row at all -- a warning per manager per poll would train
   * whoever is watching to ignore the warning channel on the one night it counts (9.2's argument).
   */
  it('treats a blank label as no bonus, silently', () => {
    const tab = withBonus('', '')
    expect(tab.blocks[0]?.bonus).toBe(0)
    expect(tab.warnings).toEqual([])
  })

  it('reads zero as zero rather than as absent', () => {
    expect(withBonus('Bonus $', '0').blocks[0]?.bonus).toBe(0)
  })

  it('warns when the label is something else entirely, because the template has moved', () => {
    const tab = withBonus('Waivers', '25')
    expect(tab.blocks[0]?.bonus).toBe(0)
    expect(tab.warnings.some((w) => w.message.includes('bonus label'))).toBe(true)
    // Still renderable: a stat-column surprise must not cost the room the auction.
    expect(tab.renderable).toBe(true)
  })

  it('counts an unreadable value as $0 and says so', () => {
    // Zero is the safe reading in this direction: inventing budget would raise MAX BID.
    const tab = withBonus('Bonus $', 'twenty')
    expect(tab.blocks[0]?.bonus).toBe(0)
    expect(tab.warnings.some((w) => w.message.includes('Unreadable bonus'))).toBe(true)
  })

  it('is zero for every block in both committed fixtures, with no warnings about it', () => {
    /*
     * The inert-when-absent property, and the reason this change was safe to land three days before
     * the draft: until the sheet holds a value, every number on the board is what it was before.
     */
    for (const tab of [partial, complete]) {
      expect(tab.blocks.map((b) => b.bonus)).toEqual(new Array(tab.blocks.length).fill(0))
      expect(tab.warnings.filter((w) => w.message.toLowerCase().includes('bonus'))).toEqual([])
    }
  })

  it('reads each block independently, so one manager can be awarded and others not', () => {
    const rows = parseCsv(readFileSync('docs/data-samples/2026-auction.csv', 'utf8'))
    const secondCol = league.grid.blockStartCols[1]!
    setCell(rows, ROW, LABEL_COL, 'Bonus $')
    setCell(rows, ROW, VALUE_COL, '30')
    setCell(rows, ROW, secondCol + league.grid.colOffsets.statLabel, 'Bonus $')
    setCell(rows, ROW, secondCol + league.grid.colOffsets.statValue, '5')

    const blocks = parseAuctionGrid(rows).blocks
    expect(blocks[0]?.bonus).toBe(30)
    expect(blocks[1]?.bonus).toBe(5)
    expect(blocks[2]?.bonus).toBe(0)
  })
})
