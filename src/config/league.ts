/**
 * League rules and sheet geometry.
 *
 * This is the only file that needs editing from one season to the next.
 * Every constant here was verified against the live sheet on 2026-08-24 --
 * see docs/DESIGN.md sections 5.3 and 5.7 for the evidence.
 *
 * The spreadsheet id is NOT here and must never be added: it is resolved at
 * runtime by `config/sheetLocation.ts` so it stays out of this repository
 * (docs/DESIGN.md section 9.1). gids are safe to commit -- they are meaningless
 * without the id that scopes them.
 */

export interface AuctionTab {
  year: number
  gid: string
}

export const league = {
  /**
   * `/export?format=csv` selects a tab by gid only -- there is no name-based
   * selector -- so the year/gid mapping lives here. The app renders the highest
   * year unless `?year=` overrides it. gids are permanent for the life of a tab.
   */
  auctionTabs: [
    { year: 2026, gid: '1565415907' },
    { year: 2025, gid: '599461641' },
  ] as AuctionTab[],

  budget: 200,
  minBid: 1,

  /** 16 roster rows minus the free DEF slot. The $200 budget buys 15 players. */
  auctionSlots: 15,

  starterTemplate: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K'] as const,
  benchSlots: 8,

  /** DEF is drafted separately, costs nothing, and is not displayed. */
  positions: ['QB', 'RB', 'WR', 'TE', 'K'] as const,

  /**
   * The most a roster may hold at a position. Absent means the only limit is the roster itself.
   *
   * League rules, not arithmetic -- RB and WR are capped only by the fifteen slots, which is why they are
   * not listed rather than listed with a 15. Reaching a limit is a legitimate state, not an error: the
   * board colours the count so a bidder can see at a glance that a manager cannot take another, which
   * matters most for K, where two is already one more than anybody wants.
   */
  positionLimits: { QB: 3, TE: 3, K: 2 } as const,

  /**
   * Grid template. Verified identical in the 2025 and 2026 tabs, and identical
   * across all three manager bands: zero violations across 24 blocks.
   *
   * All values are 0-indexed into the parsed CSV. The doc lists Google Sheets
   * row numbers (one higher) so it can be read against the sheet by eye.
   */
  grid: {
    /** Manager-name rows = sheet rows 2, 23, 44. Stride 21. */
    bandRows: [1, 22, 43],
    /** Block start columns = B, H, N, T. Stride 6. */
    blockStartCols: [1, 7, 13, 19],
    /** Row offsets relative to a band's manager-name row. */
    rowOffsets: {
      header: 1,
      starters: [2, 8] as [number, number],
      bench: [9, 16] as [number, number],
      def: 17,
      total: 18,
      remaining: 19,
      /*
       * Bonus money (2026), in the STAT column immediately after `K` -- not a new row below
       * `Remaining`, which is where it was first proposed.
       *
       * The blocks sit on a 21-row stride and already occupy offsets 0-19, so inserting three rows
       * would have pushed bands 2 and 3 down and made the stride 24. `model/diff.ts` keys every
       * roster slot as col:row on the ABSOLUTE grid row, so every key below an insertion changes --
       * and the next poll would read eight managers' whole rosters as brand-new sales, flooding the
       * ticker and jumping the nomination pointer forward by dozens. Here it costs no rows at all,
       * so a bonus can be added or edited safely while the board is live.
       */
      bonus: 9,
    },
    /** Column offsets relative to a block's start column. */
    colOffsets: {
      pos: 0,
      player: 1,
      price: 2,
      statLabel: 3,
      statValue: 4,
    },
    /** Expected stat labels, in order, in the statLabel column. */
    statLabels: ['Needs', 'Max Bid', 'QB', 'RB', 'WR', 'TE', 'K'] as const,
    /**
     * Accepted spellings of the bonus label, lowercased. The live sheet says `Bonus $`.
     *
     * Deliberately NOT part of `statLabels`: that list is walked positionally from `starters[0]` and
     * everything after `Max Bid` is treated as a position count. Bonus is neither a count nor a
     * figure we cross-check -- it is authoritative INPUT, like a price. It is also absent from the
     * 2025 tab, which must stay silent: that season had no bonus, so a blank cell means zero rather
     * than a template violation.
     */
    bonusLabels: ['bonus $', 'bonus'] as readonly string[],
  },

  /**
   * **This season's** twelve managers: display order on the board, and the
   * canonicalization table for sheet spellings.
   *
   * **Not the authority on who is in the league** -- the sheet is (see
   * `deriveLeague`). A manager in the twelve name cells but missing here still gets
   * a row, under the sheet's own spelling, because a roster change days before a
   * draft must not need a deploy. This list decides *order* and fixes up known
   * spellings; it does not gate membership.
   *
   * The length matters in two unrelated places, so keep it at twelve: it is the
   * order denominator in `parseOrder`, and `league.test.ts` pins it against
   * `bandRows x blockStartCols` -- the grid holds exactly 12 blocks.
   *
   * Verified against the live `2026 Auction` tab on 2026-08-26: rows 2 / 23 / 44 read exactly
   * these twelve names, band by band, left to right.
   *
   * THREE replacements have landed for 2026 and the board caught the last two rather than
   * anyone remembering to look: `Kris` for `Nick`, then `Brian` for `Derrick` and `Jimmy` for
   * `Colin`. The deployed display put `Unrecognized manager "Brian"` on the wall while still
   * rendering his row and his money correctly -- the sheet is the authority on membership
   * (`deriveLeague`), so a roster change costs a warning line and never a missing manager.
   *
   * `Derrick` and `Colin` moved to `pastManagers`, which is what keeps the 2025 tab quiet.
   */
  managers: [
    'Kevin', 'Corky', 'Ryan', 'Toby',
    'Jeff', 'Marc', 'Bill', 'Brian',
    'Jimmy', 'Jason', 'Kris', 'Tony',
  ] as const,

  /**
   * Managers from *earlier* seasons, recognized but never displayed as current.
   *
   * The app can render a past tab (`?fixture=2025`, later `?year=2025`), and those
   * tabs correctly contain whoever played that year. Without this list, rendering
   * 2025 would report `Unrecognized manager name "Nick"` on every poll -- a warning
   * about data that is not wrong, just old. That is a false alarm, and this project
   * spends real effort keeping the warning channel trustworthy (see the blank-tab
   * rule in 9.2); a channel that cries wolf on correct historical data is worth
   * less on the one night it matters.
   *
   * Names here are recognized, so they get a row and a correct board. They are
   * deliberately *not* in `managers`, so they take no slot in this season's order,
   * roster length, or league totals. A name on neither list still warns -- which is
   * the point: this enumerates who we know, it does not switch the check off.
   */
  pastManagers: ['Nick', 'Derrick', 'Colin'] as readonly string[],

  /**
   * Cosmetic only now: `Jeffrey` appears solely in the Divisional Draft
   * columns, which the display no longer reads. Kept because it costs a line.
   */
  aliases: { Jeffrey: 'Jeff' } as Record<string, string>,

  /**
   * Nomination order (DESIGN.md 7.5). Rotates strictly; a manager whose roster
   * is full is skipped. Every nomination ends in a sale, so the pointer is
   * derived from the sale count and needs no operator input.
   *
   * **The last-resort copy only.** Three sources outrank it, all editable without a
   * deploy: `?order=`, the `Settings` tab, and cell A1 of the auction tab. This
   * exists so a total sheet failure still leaves a rotation on the wall.
   *
   * ⚠️ NOT THE LEAGUE'S REAL 2026 ROTATION YET. As of 2026-08-26 the maintainer has not set
   * one, so this holds grid order as a placeholder, matching what A1 and the `Settings` tab
   * currently say. The rotation is a league decision that cannot be derived from the grid, and
   * the nomination pointer is only as right as the order it indexes into -- a placeholder means
   * the board names the wrong nominator with total confidence. `Shift+N` is the in-room
   * recovery if it is not replaced before draft night.
   *
   * Being the *last* resort does not exempt it from validation. It names this
   * season's managers, so it is wrong for any other season's tab, and it is checked
   * against the board before use -- see `resolveNominationOrder` in `model/order.ts`.
   * Skipping that check put `Kris` on the clock on the 2025 board, on a draft that
   * had already finished.
   */
  nominationOrder: [
    'Kevin', 'Corky', 'Ryan', 'Toby', 'Jeff', 'Marc',
    'Bill', 'Brian', 'Jimmy', 'Jason', 'Kris', 'Tony',
  ] as string[],

  /** The `Settings` tab (9.2). Read from the live workbook's tab list, 2026-08-25. */
  settingsTabGid: '361377598' as string | null,

  /**
   * The `2026 TeamsToManagers` tab: team name per manager, for the hover tooltip on the board.
   *
   * `null` turns the whole feature off, fetch included. `/export?format=csv` selects a tab by gid only, so
   * there is no way to find it by name. gids are safe to commit (see the note at the top of this file).
   * Read from the live workbook's tab list, 2026-08-28.
   *
   * Read ONCE, not polled. Team names do not change during an auction, and the poll loop is the most
   * load-bearing code in the project; a convenience for one person does not get to add failure surface to
   * it. If the fetch or the parse fails there is simply no tooltip.
   */
  teamsTabGid: '188870750' as string | null,

  pollIntervalMs: 3000,

  /** 2026 enforces the $200 cap. 2025 legally allowed overspending. */
  enforceBudgetCap: true,

  /** DEF costs nothing and is drafted before the auction. */
  freeDefenseSlot: true,
} as const

export type Position = (typeof league.positions)[number]
export type ManagerName = (typeof league.managers)[number]

/** Total auction slots across the league: 12 x 15 = 180. */
export const totalAuctionSlots = league.managers.length * league.auctionSlots
