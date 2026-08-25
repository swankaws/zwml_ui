import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { league, totalAuctionSlots } from './league'
import { cell, parseCsv } from '../data/csv'

describe('league config invariants', () => {
  it('has 12 managers with no duplicates', () => {
    expect(league.managers).toHaveLength(12)
    expect(new Set(league.managers).size).toBe(12)
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

  for (const file of ['2026-auction.csv', '2025-auction.csv']) {
    describe(file, () => {
      const rows = load(file)
      const { bandRows, blockStartCols, rowOffsets, colOffsets, statLabels } = league.grid

      it('has 63 rows -- the true grid, not a row-collapsed view', () => {
        expect(rows.length).toBeGreaterThanOrEqual(63)
      })

      it('places all 12 known managers at the expected band/column anchors', () => {
        const found = bandRows.flatMap((r) => blockStartCols.map((c) => cell(rows, r, c)))
        expect([...found].sort()).toEqual([...league.managers].sort())
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
