/**
 * Raw CSV grid -> ManagerBlock[] (docs/DESIGN.md section 5.4).
 *
 * The grid is a fixed, uniform template (section 5.3), so this walks the template
 * directly and uses the row labels as an INTEGRITY CHECK rather than as a search
 * mechanism: it computes where every cell must be, then proves the sheet agrees.
 *
 * Two things this must never do:
 *   - throw. A bad cell degrades to a warning; the board keeps rendering.
 *   - shift by a row and still "parse". The labels are asserted precisely because
 *     an off-by-one silently drops each manager's QB and reads DEF as a pick.
 */

import { league, type Position } from '../config/league'
import { cell } from './csv'
import { readInt, readManagerName, readPosition, readPrice } from './normalize'

export interface Pick {
  /** `null` when the Pos cell is blank -- normal for an unlabeled bench row. */
  position: Position | null
  player: string
  price: number
  /** 0-indexed row in the parsed grid, for warnings and the debug overlay. */
  row: number
  slot: 'starter' | 'bench'
  /** True when the price cell held something unparseable and was read as $0. */
  priceSuspect: boolean
}

/** What the sheet's own formulas say. Kept strictly apart from what we compute (D6). */
export interface SheetFigures {
  total: number | null
  remaining: number | null
  needs: number | null
  maxBid: number | null
  positionCounts: Partial<Record<Position, number>>
}

export interface ManagerBlock {
  /** Canonical name from config, or `null` if the cell matched no known manager. */
  name: string | null
  /**
   * Bonus money awarded on draft night (2026). `0` when the row is absent, as in 2025.
   *
   * On the block rather than in `sheet` because it is authoritative INPUT, like a price -- not a
   * figure the sheet computed that we cross-check against our own. `deriveLeague` adds it to the
   * budget: `remaining = budget + bonus - spent`.
   */
  bonus: number
  /** Exactly what the cell said, for the unmatched-name warning row. */
  rawName: string
  band: number
  row: number
  col: number
  picks: Pick[]
  sheet: SheetFigures
}

export interface ParseWarning {
  /** A1-style reference, so a warning can be checked against the sheet by eye. */
  ref: string
  message: string
  /** 'fatal' means we are probably looking at the wrong tab -- do not render. */
  severity: 'warning' | 'fatal'
}

export interface ParsedTab {
  blocks: ManagerBlock[]
  warnings: ParseWarning[]
  /**
   * False when the template check failed in a way that means the sheet was
   * restructured or the wrong tab came back (section 5.4 step 6). The caller
   * keeps the last good frame rather than rendering nonsense.
   */
  renderable: boolean
  /**
   * Raw text of A1, which the maintainer keeps the nomination order in
   * (`Jeff > Toby > Tony > ...`). Unvalidated and uninterpreted here -- this only
   * hands the string on, because 7.5 belongs to the caller.
   *
   * Reading it costs nothing: A1 sits above every band (`bandRows` starts at row 1),
   * so it is outside all the geometry the template check verifies, and it arrives in
   * a request the app already makes. That makes it the only order source needing no
   * gid, no second fetch and no deploy. 7.5 declined to *write* league config into
   * this grid, which still holds; reading a cell the maintainer already curates is a
   * different trade.
   *
   * Treat it as a hint, not as truth -- it held a stale order naming a manager who
   * had not played for years until 2026-08-25. Validation is the caller's job.
   */
  orderHint: string
}

/** 0-indexed (row, col) -> `D19`. Columns past Z are not reachable in this grid. */
export function a1(row: number, col: number): string {
  let name = ''
  let n = col
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `${name}${row + 1}`
}

export function parseAuctionGrid(rows: string[][]): ParsedTab {
  const warnings: ParseWarning[] = []
  const blocks: ManagerBlock[] = []
  const { bandRows, blockStartCols, rowOffsets, colOffsets, statLabels } = league.grid

  const warn = (row: number, col: number, message: string) =>
    warnings.push({ ref: a1(row, col), message, severity: 'warning' })
  const fatal = (row: number, col: number, message: string) =>
    warnings.push({ ref: a1(row, col), message, severity: 'fatal' })

  for (const [bandIndex, bandRow] of bandRows.entries()) {
    for (const col of blockStartCols) {
      blocks.push(parseBlock(rows, bandIndex, bandRow, col, warn, fatal))
    }
  }

  // Gate rendering on the two conditions that mean "this is not our tab":
  // no block found a Total label, or too few manager names resolved.
  /*
   * Compared against the number of BLOCKS in the grid, not against the length of
   * the committed roster. Those happen to both be 12 today, but they answer
   * different questions: "did this tab's own name cells resolve" is a property of
   * the tab, while the roster is a property of the season. Using the roster length
   * meant a year with eleven managers, or a config carrying a name this tab does not
   * have, produced a false alarm on every 3-second poll.
   */
  const blockCount = league.grid.bandRows.length * league.grid.blockStartCols.length
  const named = blocks.filter((b) => b.name !== null).length
  if (named === 0) {
    fatal(0, 0, 'No manager names recognized anywhere in the grid -- wrong tab?')
  } else if (named < blockCount) {
    warn(0, 0, `Only ${named} of ${blockCount} manager names recognized`)
  }

  return {
    blocks,
    warnings,
    renderable: !warnings.some((w) => w.severity === 'fatal'),
    orderHint: cell(rows, 0, 0).trim(),
  }

  function parseBlock(
    grid: string[][],
    bandIndex: number,
    bandRow: number,
    col: number,
    warnAt: typeof warn,
    fatalAt: typeof fatal,
  ): ManagerBlock {
    const rawName = cell(grid, bandRow, col)
    const name = readManagerName(rawName)
    if (rawName && !name) {
      warnAt(bandRow, col, `Unrecognized manager name "${rawName}"`)
    } else if (!rawName) {
      warnAt(bandRow, col, 'Expected a manager name, found an empty cell')
    }

    // --- Template verification (section 5.4 step 2) -------------------------
    // Every check names its exact cell so a real restructure is a two-second
    // diagnosis instead of an afternoon.
    const headerRow = bandRow + rowOffsets.header
    const posHeader = cell(grid, headerRow, col + colOffsets.pos)
    if (posHeader.toLowerCase() !== 'pos') {
      warnAt(headerRow, col + colOffsets.pos, `Expected "Pos" header, found "${posHeader}"`)
    }

    const [starterFirst, starterLast] = rowOffsets.starters
    league.starterTemplate.forEach((expected, i) => {
      const row = bandRow + starterFirst + i
      const actual = cell(grid, row, col + colOffsets.pos)
      if (actual.toUpperCase() !== expected) {
        warnAt(row, col + colOffsets.pos, `Expected starter "${expected}", found "${actual}"`)
      }
    })

    const defRow = bandRow + rowOffsets.def
    const defLabel = cell(grid, defRow, col + colOffsets.pos)
    if (readPosition(defLabel) !== 'DEF') {
      warnAt(defRow, col + colOffsets.pos, `Expected "DEF" row, found "${defLabel}"`)
    }

    /*
     * A pick typed into the DEF row is invisible, and expensively so.
     *
     * `collect` walks starters and bench only, and the DEF row sits one row below the last bench row
     * and one above `Total` -- an easy miss for someone typing fast down a block. Nothing else notices:
     * the Pos cell still says DEF so the check above passes, no `Pick` is produced, so the player is
     * absent from the ticker, the roster and the history, the nomination pointer never advances for
     * that sale, and MAX BID stays high by the price that was paid. 5.3 states the invariant -- "DEF
     * row: position label only, no player and no price" -- and this was the one cell in the block that
     * did not assert it.
     *
     * A warning, never fatal: the money on screen is still the money the sheet holds for every OTHER
     * row, so this may not cost the room the board. Verified blank across all 24 blocks of both
     * committed fixtures, so it cannot cry wolf on real data.
     */
    const defPlayer = cell(grid, defRow, col + colOffsets.player)
    const defPrice = cell(grid, defRow, col + colOffsets.price)
    if (defPlayer !== '' || defPrice !== '') {
      warnAt(
        defRow,
        col + colOffsets.player,
        `"${defPlayer || defPrice}" is in the DEF row, so it is NOT counted as a pick -- move it to a bench row`,
      )
    }

    const totalRow = bandRow + rowOffsets.total
    const totalLabel = cell(grid, totalRow, col + colOffsets.player)
    if (totalLabel.toLowerCase() !== 'total') {
      // Section 5.4 step 6: a missing Total label is a structural failure, not a
      // cosmetic one -- it is the anchor that proves the block shape.
      fatalAt(totalRow, col + colOffsets.player, `Expected "Total", found "${totalLabel}"`)
    }

    const remainingRow = bandRow + rowOffsets.remaining
    const remainingLabel = cell(grid, remainingRow, col + colOffsets.player)
    if (remainingLabel.toLowerCase() !== 'remaining') {
      warnAt(
        remainingRow,
        col + colOffsets.player,
        `Expected "Remaining", found "${remainingLabel}"`,
      )
    }

    // --- Picks (section 5.4 step 3) ----------------------------------------
    const picks: Pick[] = []
    const [benchFirst, benchLast] = rowOffsets.bench
    const collect = (from: number, to: number, slot: 'starter' | 'bench') => {
      for (let offset = from; offset <= to; offset++) {
        const row = bandRow + offset
        const player = cell(grid, row, col + colOffsets.player)
        if (!player) continue

        // The slot test runs on RAW cells, before any coercion (section 5.3).
        // A blank price means "not yet a pick" and is silent by design.
        const priceCell = cell(grid, row, col + colOffsets.price)
        const price = readPrice(priceCell)
        if (price.kind === 'blank') continue

        if (price.kind === 'unparseable') {
          warnAt(
            row,
            col + colOffsets.price,
            `Unparseable price "${price.raw}" for ${player} -- counted as $0`,
          )
        }

        const position = readPosition(cell(grid, row, col + colOffsets.pos))
        picks.push({
          // DEF never appears in a pick row, but if the sheet grows one, do not
          // let it masquerade as an auction position.
          position: position === 'DEF' ? null : position,
          player,
          price: price.kind === 'ok' ? price.value : 0,
          row,
          slot,
          priceSuspect: price.kind === 'unparseable',
        })
      }
    }
    collect(starterFirst, starterLast, 'starter')
    collect(benchFirst, benchLast, 'bench')

    // --- What the sheet says (section 5.4 steps 4 and 5) -------------------
    const stats = readStats(grid, bandRow, col, warnAt)

    return {
      name,
      rawName,
      band: bandIndex,
      row: bandRow,
      col,
      picks,
      bonus: readBonus(grid, bandRow, col, warnAt),
      sheet: {
        total: readInt(cell(grid, totalRow, col + colOffsets.price)),
        remaining: readInt(cell(grid, remainingRow, col + colOffsets.price)),
        needs: stats.needs,
        maxBid: stats.maxBid,
        positionCounts: stats.positionCounts,
      },
    }
  }

  function readStats(
    grid: string[][],
    bandRow: number,
    col: number,
    warnAt: typeof warn,
  ): { needs: number | null; maxBid: number | null; positionCounts: Partial<Record<Position, number>> } {
    const [first] = rowOffsets.starters
    let needs: number | null = null
    let maxBid: number | null = null
    const positionCounts: Partial<Record<Position, number>> = {}

    statLabels.forEach((expected, i) => {
      const row = bandRow + first + i
      const label = cell(grid, row, col + colOffsets.statLabel)
      const raw = cell(grid, row, col + colOffsets.statValue)

      if (label.toLowerCase() !== expected.toLowerCase()) {
        warnAt(
          row,
          col + colOffsets.statLabel,
          `Expected stat label "${expected}", found "${label}"`,
        )
        return
      }

      const value = readInt(raw)
      if (expected === 'Needs') needs = value
      else if (expected === 'Max Bid') maxBid = value
      else if (value !== null) positionCounts[expected as Position] = value
    })

    return { needs, maxBid, positionCounts }
  }

  /**
   * Bonus money from the stat column (2026).
   *
   * Three outcomes, and the middle one is the point: the label reads bonus-ish and the value parses,
   * so we use it; the cell is BLANK, which is 2025 and every pre-award 2026 poll, so it is zero and
   * silent; or the label says something else entirely, which means the template moved under us and
   * deserves a warning rather than a silent zero.
   *
   * A blank must never warn. The rows exist all night with nothing in them until the league runners
   * award anything, and a warning per manager per poll would train whoever is watching to ignore the
   * warning channel on the one night it matters (9.2's argument, applied here).
   */
  function readBonus(
    grid: string[][],
    bandRow: number,
    col: number,
    warnAt: typeof warn,
  ): number {
    const row = bandRow + rowOffsets.bonus
    const label = cell(grid, row, col + colOffsets.statLabel).trim()
    const raw = cell(grid, row, col + colOffsets.statValue)

    if (label === '') return 0
    if (!league.grid.bonusLabels.includes(label.toLowerCase())) {
      warnAt(row, col + colOffsets.statLabel, `Expected the bonus label here, found "${label}"`)
      return 0
    }

    const value = readInt(raw)
    if (value === null) {
      // Labelled but unreadable. Zero is the safe reading -- inventing budget would raise MAX BID.
      if (raw.trim() !== '') {
        warnAt(row, col + colOffsets.statValue, `Unreadable bonus "${raw}" -- counted as $0`)
      }
      return 0
    }
    return value
  }
}
