import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { league, totalAuctionSlots } from './league'
import { cell, parseCsv } from '../data/csv'

describe('league config invariants', () => {
  it('has 12 managers with no duplicates', () => {
    expect(league.managers).toHaveLength(12)
    expect(new Set(league.managers).size).toBe(12)
  })

  it('keeps past managers out of the current roster, and out of each other', () => {
    /*
     * `pastManagers` exists so a past tab's names still resolve (2025 has Nick).
     * If a name were on both lists it would take one of this season's twelve slots
     * and silently distort the order denominator and league totals.
     */
    for (const past of league.pastManagers) {
      expect(league.managers as readonly string[]).not.toContain(past)
    }
    expect(new Set(league.pastManagers).size).toBe(league.pastManagers.length)
  })

  it('accounts for every roster slot', () => {
    expect(league.starterTemplate.length + league.benchSlots).toBe(league.auctionSlots)
    expect(totalAuctionSlots).toBe(180)
  })

  it('lays out three bands and four columns per band', () => {
    expect(league.grid.bandRows).toHaveLength(3)
    expect(league.grid.blockStartCols).toHaveLength(4)
    expect(league.grid.bandRows.length * league.grid.blockStartCols.length).toBe(
      league.managers.length,
    )
  })

  it('spans exactly the 15 auction rows between starters and DEF', () => {
    const { starters, bench, def } = league.grid.rowOffsets
    expect(starters[1] - starters[0] + 1).toBe(league.starterTemplate.length)
    expect(bench[1] - bench[0] + 1).toBe(league.benchSlots)
    expect(bench[0]).toBe(starters[1] + 1)
    expect(def).toBe(bench[1] + 1)
  })

  it('orders auction tabs newest first', () => {
    const years = league.auctionTabs.map((t) => t.year)
    expect([...years].sort((a, b) => b - a)).toEqual(years)
  })
})

/**
 * Locks in the grid geometry of DESIGN.md section 5.3 against the real fixtures.
 *
 * This test exists because an earlier revision of the design concluded the row
 * geometry was dynamic. It was not -- that was an artifact of reading the sheet
 * through the gviz endpoint, which silently drops empty rows. If the template
 * ever genuinely changes, this fails loudly instead of the board rendering
 * shifted garbage.
 */
describe('sheet template geometry', () => {
  const load = (file: string): string[][] =>
    parseCsv(readFileSync(`docs/data-samples/${file}`, 'utf8'))

  /*
   * The roster is a property of the SEASON, not of the config.
   *
   * This used to assert `found === league.managers` for both files, which quietly
   * required the committed roster to equal every captured season at once. The moment
   * 2026 said `Kris` and 2025 said `Nick`, no value of `league.managers` could
   * satisfy it -- the assertion was unsatisfiable rather than merely failing. It was
   * also the exact config-equals-membership coupling DESIGN.md 6 renounces, so it
   * did not belong in a test either. Each season now names its own twelve.
   */
  const rosterOf: Record<string, readonly string[]> = {
    /*
     * Spelled out rather than pointed at `league.managers`, which is what this used to do and
     * is the same config-equals-membership coupling the comment above renounces. These CSVs are
     * CAPTURES of the tab on a particular day -- this one from 2026-08-25 -- and the live tab
     * has moved on since: `Brian` replaced `Derrick` and `Jimmy` replaced `Colin` on 08-26. A
     * fixture is a record of what the sheet said, so it names its own twelve.
     */
    '2026-auction.csv': [
      'Kevin', 'Corky', 'Ryan', 'Toby',
      'Jeff', 'Marc', 'Bill', 'Derrick',
      'Colin', 'Jason', 'Kris', 'Tony',
    ],
    '2025-auction.csv': [
      'Kevin', 'Corky', 'Ryan', 'Toby',
      'Jeff', 'Marc', 'Bill', 'Derrick',
      'Colin', 'Jason', 'Nick', 'Tony',
    ],
  }

  for (const file of ['2026-auction.csv', '2025-auction.csv']) {
    describe(file, () => {
      const rows = load(file)
      const { bandRows, blockStartCols, rowOffsets, colOffsets, statLabels } = league.grid

      it('has 63 rows -- the true grid, not a row-collapsed view', () => {
        expect(rows.length).toBeGreaterThanOrEqual(63)
      })

      it("places all 12 of that season's managers at the expected band/column anchors", () => {
        const found = bandRows.flatMap((r) => blockStartCols.map((c) => cell(rows, r, c)))
        expect(found.filter((n) => n !== '')).toHaveLength(12)
        expect([...found].sort()).toEqual([...rosterOf[file]!].sort())
      })

      it('places every label exactly where the template says', () => {
        for (const r of bandRows) {
          for (const c of blockStartCols) {
            const who = cell(rows, r, c)
            expect(cell(rows, r + rowOffsets.header, c), `${who} header`).toBe('Pos')

            const starters = Array.from(
              { length: league.starterTemplate.length },
              (_, i) => cell(rows, r + rowOffsets.starters[0] + i, c),
            )
            expect(starters, `${who} starters`).toEqual([...league.starterTemplate])

            expect(cell(rows, r + rowOffsets.def, c), `${who} DEF`).toBe('DEF')
            expect(
              cell(rows, r + rowOffsets.total, c + colOffsets.player),
              `${who} Total`,
            ).toBe('Total')
            expect(
              cell(rows, r + rowOffsets.remaining, c + colOffsets.player),
              `${who} Remaining`,
            ).toBe('Remaining')

            const stats = Array.from({ length: statLabels.length }, (_, i) =>
              cell(rows, r + rowOffsets.starters[0] + i, c + colOffsets.statLabel),
            )
            expect(stats, `${who} stat labels`).toEqual([...statLabels])
          }
        }
      })

      it('never records a price on the DEF row', () => {
        for (const r of bandRows) {
          for (const c of blockStartCols) {
            expect(cell(rows, r + rowOffsets.def, c + colOffsets.price)).toBe('')
            expect(cell(rows, r + rowOffsets.def, c + colOffsets.player)).toBe('')
          }
        }
      })
    })
  }
})
