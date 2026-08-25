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
  },

  /** Display order on the board; also the expected set for name validation. */
  managers: [
    'Kevin', 'Corky', 'Ryan', 'Toby',
    'Jeff', 'Marc', 'Bill', 'Derrick',
    'Colin', 'Jason', 'Nick', 'Tony',
  ] as const,

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
   * The SETTINGS tab wins if readable; this is the fallback copy. An empty
   * order hides the nomination strip rather than blocking the board.
   */
  nominationOrder: [] as string[],
  settingsTabGid: null as string | null,

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
