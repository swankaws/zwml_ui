/**
 * Column definitions and the priority system (docs/DESIGN.md section 7.2).
 *
 * Each column declares a priority; the layout drops from the bottom up until the
 * board fits. At 1080p in the rail layout nothing drops -- the system exists for
 * phones and laptops (Q8), and as insurance if the projector changes on the day.
 *
 * Widths are the relative figures from 7.2. They are consumed as grid `fr` units
 * rather than pixels so the ratios hold at any width, which is what lets the same
 * table serve a projector and a phone.
 */

import type { ManagerState } from '../model/derive'
import { league } from '../config/league'

export type ColumnKey =
  | 'manager'
  | 'spent'
  | 'left'
  | 'pctLeft'
  | 'needs'
  | 'maxBid'
  | 'positions'

export interface Column {
  key: ColumnKey
  /** Header label. `positions` renders five sub-headers instead. */
  label: string
  /** 1 is most important. Dropped highest-number-first. */
  priority: number
  /** Relative width from 7.2. `positions` covers all five sub-columns. */
  width: number
  align: 'left' | 'right' | 'center'
  /**
   * Relative width to use on a narrow screen instead of `width`.
   *
   * One unit set cannot serve both ends of the matrix, and the reason is arithmetic rather than taste.
   * Content need scales with the TYPE size; the space available is a WIDTH. Between the projector and a
   * phone the type falls 2.6x (46.98px to 17.94px, because mobile sizes root from `4.6vw` while the
   * projector sizes it from `4.35vh`) while the table falls only 3.7x -- so relative to the room it has,
   * every column needs proportionally LESS on the phone. With one fixed set the phone over-allocated
   * every column: MANAGER was handed 104px to draw a 66px name, and the wasted third was enough for a
   * whole extra column that the fit test was dropping.
   *
   * These are measured the same way as `width` -- max-content need at 390x844, times a margin -- just
   * against a different type size.
   */
  narrow?: number
  /**
   * Off unless explicitly enabled. No column uses this today -- `$/SLOT` was the only one and it has
   * been removed -- but the mechanism is kept because it is what lets a figure be built and proved on
   * the wall before it is given a permanent place on it.
   */
  optIn?: boolean
}

/**
 * Priority 1 columns are never dropped: MANAGER is identity, and MAX BID is the
 * reason the display exists.
 */
/*
 * Widths measured, not guessed -- and re-measured from scratch when the eighth column arrived.
 *
 * Every figure below is `need / pxPerUnit * 1.15`, where `need` is the max-content width of the widest
 * thing that column ever holds, measured over the whole table at 1920x1080 with a CDP probe. The 1.15 is
 * a deliberate 15% margin: a wall display gets no second chance, and the failures this replaces were all
 * columns sitting at 95-100% of their allocation and truncating the moment content changed.
 *
 * Two things the measurement showed that reading the CSS would not:
 *
 *   - Three columns are sized by their HEADER, not their values. `REMAINING` (149px) is wider than
 *     `-$1`, `NEEDS` (87px) dwarfs a two-digit count, and `QB RB WR TE K` (236px) beats any row of
 *     digits. Headers render at 0.5em and so do NOT shrink when `.cell` does -- which is why shrinking
 *     the cell type bought less room than the arithmetic suggested.
 *   - The binding case differs per column between a mid-draft board and a finished one. SPENT needs
 *     128px for `$200` at the end but only 96px at hour one; MAX BID needs 133px for `FULL`, more than
 *     the 129px `$186` wants. Both are sized for their own worst case, not for one screenshot.
 *
 * `MIN_UNIT_RATIO` below is untouched and is now conservative rather than binding: it was calibrated
 * when MAX BID rendered at 1.4em, and every cell has been one size since the designer's pass.
 */
export const COLUMNS: Column[] = [
  { key: 'manager', label: 'MANAGER', priority: 1, width: 205, narrow: 174, align: 'left' },
  { key: 'maxBid', label: 'MAX BID', priority: 1, width: 165, narrow: 141, align: 'right' },
  /*
   * `REMAINING`, not `LEFT`. The designer's call, and it matches the sheet's own wording -- the block
   * label the maintainer reads every day says Remaining. `width` goes up with it: the header label is
   * more than twice as long and the fit test sizes columns from the widest thing in them.
   */
  { key: 'left', label: 'REMAINING', priority: 2, width: 185, narrow: 186, align: 'right' },
  /*
   * 115, not 95. `REMAINING` replacing `LEFT` widened its own column, which came out of this one --
   * and the header LABEL is what needs the room here, not the value: a one- or two-digit count is the
   * narrowest thing on the row while `NEEDS` is five characters.
   */
  /*
   * `% REM` -- the maintainer's request. Honest caveat recorded here rather than discovered later: while
   * every manager's bonus money is $0 this is a pure restatement of `left` (remaining / 200), and 7.2's
   * own argument against `$/SLOT` -- "a ninth number competes for attention while telling the room
   * nothing new" -- applies to it as well.
   *
   * It stops being redundant the moment bonus money differs BETWEEN managers, because then the twelve
   * budgets are no longer all $200 and `$120 left` means something different for a manager who started
   * with $250 than for one who started with $200. That is exactly what bonus money was added for.
   *
   * Computed as `remaining / (remaining + spent)`, which needs no access to the bonus figure at all:
   * remaining = budget + bonus - spent, so remaining + spent IS the manager's real total budget.
   */
  { key: 'pctLeft', label: '% REM', priority: 6, width: 175, narrow: 159, align: 'right' },
  { key: 'needs', label: 'NEEDS', priority: 3, width: 110, narrow: 108, align: 'right' },
  /*
   * 285, down from 370. The binding content is the HEADER, not the counts: `QB RB WR TE K` needs 267px
   * measured at the projector, while the widest row of digits needs 230px. 260 was tried and clips the
   * header by 5px -- the counts fit fine, which is exactly the kind of miss that only a measurement of
   * the header row catches. At 370 units it was being handed ~328px against a 267px need.
   *
   * That over-allocation was already on the record ("POS -- priority 4 -- held 36% of the row") but
   * never acted on, and it is what paid for `% REM`. The fit test applies one uniform px-per-unit floor
   * calibrated on MAX BID, so a column provisioned at twice its need makes the whole test pessimistic --
   * eight columns did not "not fit", they were being crowded out by this one.
   */
  { key: 'positions', label: 'POS', priority: 4, width: 292, narrow: 270, align: 'center' },
  // Fully redundant with LEFT ($200 - LEFT), so it is the first to go.
  /*
   * 160, not 145. Widening `left` for the longer `REMAINING` label squeezed this below its own content
   * and all twelve rows rendered `$2...` on a completed board -- unreadable, and the gate caught it.
   */
  { key: 'spent', label: 'SPENT', priority: 5, width: 158, narrow: 147, align: 'right' },
]

/**
 * Display order on the row, independent of priority.
 *
 * Money left to right in descending importance, then the roster counts. MAX BID leads because it is the
 * reason the display exists -- the one figure a bidder acts on -- and it used to sit FIFTH, behind two
 * columns that are derivable from a third. The old order (`spent, left, needs, maxBid`) mirrored the
 * spreadsheet's column order, which is a data-entry order, not a reading order.
 *
 * NEEDS moves to the right of the money and immediately left of the position matrix, because it is the
 * total of that matrix: `NEEDS 11` and `QB 1 RB 2 WR 1` are one thought, and they were separated by
 * MAX BID.
 */
const DISPLAY_ORDER: ColumnKey[] = [
  'manager',
  'maxBid',
  'left',
  'pctLeft',
  'spent',
  'needs',
  'positions',
]

/** Root font size at the 1080p projector target, used as the default reference. */
export const REFERENCE_TYPE_PX = 47

/**
 * Width per relative unit needed to render the widest expected value, as a multiple
 * of the root font size.
 *
 * Measured, not chosen. The binding column is MAX BID: it carries the largest type
 * on the row (1.4em), and "$186" comes to ~2.63 em-widths, so it needs 2.63 x 1.4 x
 * root px across its 190 units -- 0.0194 per unit per px of root type. Confirmed at
 * three resolutions: 144px needed of 136px available at 1440x900, and 116px of 116px
 * at 390x844, both landing on the same ratio once MAX BID's own em multiplier is
 * accounted for.
 */
const MIN_UNIT_RATIO = 0.0194

export interface SelectOptions {
  /** Available width in px for the table body. */
  width: number
  /**
   * Root font size in px. The type scale is derived from viewport *height* while
   * the space available is a *width*, so the fit test is meaningless without it --
   * see the note on the fit test below.
   */
  typePx?: number
  /** Columns to include despite `optIn`. */
  enabled?: ColumnKey[]
  /** Override the readability floor directly, in px per unit. For tests. */
  minUnitPx?: number
  /**
   * An exact column set from the SETTINGS tab or the query string.
   *
   * From the query it bypasses the fit test entirely, and that is deliberate: the
   * fit test is a heuristic about what *should* be readable, and a person standing
   * in the room looking at the wall out-ranks it. This is the escape hatch for the
   * case the heuristic gets wrong on unfamiliar hardware -- the projector is not
   * available until the day before the draft (7.1), so an override that needs no
   * rebuild is the difference between a two-minute fix and a deploy plus CDN
   * propagation on the night.
   */
  forced?: readonly ColumnKey[] | null
  /**
   * Where `forced` came from. The distinction is the one `resolveSettings` already
   * draws: the URL is the in-room override, while the SETTINGS tab is "durable,
   * phone-editable, shared" -- edited from the couch and broadcast to everyone
   * watching, on screens the operator cannot see.
   *
   * So the argument above earns the bypass only for `'query'`. A sheet-forced set is
   * honoured wherever it fits and trimmed by priority where it cannot: the maintainer
   * put `columns: manager, left, needs, maxbid` in the live tab on 2026-08-25, which
   * is clean from 1024x768 up and truncated 41 cells on a 390x844 phone -- including
   * the NEEDS header, which had 47 px of the 73 px it needed. Nobody following along
   * on a phone can see that to fix it, and it is the exact failure the priority
   * system exists to prevent (it drops to two columns there on its own).
   *
   * Defaults to `'sheet'`, the cautious answer: forgetting to pass it costs a forced
   * set its bypass, which is visible and recoverable, rather than silently truncating
   * every narrow screen in the league.
   */
  forcedFrom?: 'query' | 'sheet'
}

/**
 * Chooses the widest column set that fits `width`, dropping the least important
 * first. Returns them in display order.
 *
 * The fit test is about *readability*, not arithmetic: any set of columns can be
 * squeezed into any width, so what decides is whether each unit of relative width
 * still maps to enough pixels to draw the value.
 *
 * Crucially that threshold is not a constant. Type here is sized from viewport
 * height (7.1 -- physical glyph size is what legibility depends on), so a phone in
 * portrait has nearly the type size of a laptop in a third of the width. A fixed
 * px-per-unit floor treats those as equally readable and they are not: it passed a
 * 390px-wide board that truncated LEFT, NEEDS and MAX BID on every row.
 */
/**
 * Above this root size the layout is a projector or a laptop; at or below it, a phone.
 *
 * 26px is not arbitrary -- it is the CEILING of the mobile type clamp (`clamp(13px, 4.6vw, 26px)`), so
 * every viewport that gets the mobile type rule lands at or under it, and the smallest desktop case in
 * the matrix (1024x768, 33.41px) stays clear above. A short desktop window also crosses it, and that is
 * correct rather than incidental: what matters is the ratio of type to available width, not the device.
 */
const NARROW_TYPE_PX = 26

/** The same column with whichever width applies at this type size. */
function forType(column: Column, typePx: number): Column {
  const width = typePx <= NARROW_TYPE_PX ? column.narrow ?? column.width : column.width
  return width === column.width ? column : { ...column, width }
}

export function selectColumns(options: SelectOptions): Column[] {
  const {
    width,
    enabled = [],
    typePx = REFERENCE_TYPE_PX,
    minUnitPx = MIN_UNIT_RATIO * typePx,
    forced = null,
    forcedFrom = 'sheet',
  } = options

  // An explicit set still goes out in display order, so the row reads the same way
  // however the columns were chosen.
  if (forced && forced.length > 0) {
    const chosen = DISPLAY_ORDER.filter((key) => forced.includes(key)).map((key) =>
      forType(COLUMNS.find((c) => c.key === key) as Column, typePx),
    )
    return forcedFrom === 'query' ? chosen : dropUntilItFits(chosen, width, minUnitPx, typePx)
  }

  const candidates = COLUMNS.filter((c) => !c.optIn || enabled.includes(c.key)).map((c) =>
    forType(c, typePx),
  )
  return dropUntilItFits(candidates, width, minUnitPx, typePx)
}

/**
 * Drops one column at a time, least important first, until the set fits, and returns
 * what survives in display order.
 *
 * A priority-1 column is never dropped: an unreadable board and a board with no MAX
 * BID are both useless, but only one of them is fixable by squinting.
 */
function dropUntilItFits(
  candidates: Column[],
  width: number,
  minUnitPx: number,
  typePx: number,
): Column[] {
  const byPriority = [...candidates].sort((a, b) => b.priority - a.priority)

  let kept = candidates
  for (const column of byPriority) {
    if (fits(kept, width, minUnitPx, typePx)) break
    if (column.priority === 1) break
    kept = kept.filter((c) => c.key !== column.key)
  }

  return DISPLAY_ORDER.map((key) => kept.find((c) => c.key === key)).filter(
    (c): c is Column => c !== undefined,
  )
}

/*
 * Row chrome that the columns do not get to use. These mirror `.row` in theme.css
 * (`gap: 0 0.5em`, `padding: 0 0.42rem`) and scale with the root type exactly as the
 * gaps on screen do -- the padding is `rem` there so the 0.5em header keeps the same
 * inset as the rows, and `typePx` below IS the root size, so the arithmetic matches.
 */
const COLUMN_GAP_EM = 0.5
const ROW_PADDING_EM = 0.42 * 2

function fits(columns: Column[], width: number, minUnitPx: number, typePx: number): boolean {
  const units = columns.reduce((sum, c) => sum + c.width, 0)
  if (units === 0) return true
  /*
   * Gaps and padding first. At 1080p they come to ~157px of the 1298px table -- 12%
   * that the columns never see. Ignoring them made the test optimistic by roughly
   * one column, which is how a 390px board kept LEFT and then truncated it.
   */
  const overhead = ((columns.length - 1) * COLUMN_GAP_EM + ROW_PADDING_EM) * typePx
  return (width - overhead) / units >= minUnitPx
}

/** The five position sub-columns, in the order the sheet uses. */
export const POSITION_COLUMNS = ['QB', 'RB', 'WR', 'TE', 'K'] as const

/**
 * How much pressure a figure is under, as a step rather than a continuum (7.7).
 *
 * `'none'` for most of the board, most of the night: a colour that appears on half the rows tells
 * the room nothing, which is the same argument `distinguishingTopBid` makes about the leader
 * highlight. These thresholds are chosen so that at the open -- twelve managers at $200 with
 * fifteen needs -- every cell is `'none'`, and colour arrives only as the field separates.
 *
 * Steps, not a smooth gradient, and deliberately: a projector shifts colour and dims unevenly, so
 * a continuous ramp reads as "some vague shade of amber" from 25 feet. Three named states are
 * distinguishable; sixty are not.
 *
 * `MAX BID` is the reason this exists. At `$1` a manager cannot outbid anybody, which is the single
 * most useful thing the board can tell a bidder, and until now it was conveyed by dimming the whole
 * row -- the same treatment as a FULL roster, which means something completely different.
 */
export type Pressure = 'none' | 'low' | 'critical'

export function pressureLevel(column: ColumnKey, m: ManagerState): Pressure {
  switch (column) {
    case 'maxBid':
      // FULL is its own row state and already styled; it is not "under pressure", it is finished.
      if (m.maxBid === null) return 'none'
      // At the minimum bid there is nothing left to outbid anyone with.
      if (m.maxBid <= league.minBid) return 'critical'
      return m.maxBid <= MAX_BID_LOW ? 'low' : 'none'

    case 'left':
      // Negative is already carried by `.negative` and the invalid row marker, so this only has to
      // describe money that is real but nearly gone.
      if (m.remaining < 0) return 'none'
      if (m.remaining <= league.budget * LEFT_CRITICAL) return 'critical'
      return m.remaining <= league.budget * LEFT_LOW ? 'low' : 'none'

    default:
      /*
       * NEEDS is deliberately not coloured. A low NEEDS is not a warning -- it means a manager is
       * nearly done, which is neither good nor bad and is already visible in the number itself. The
       * genuinely interesting case is high NEEDS against low LEFT, and that is a relationship
       * between two cells, which a per-cell colour cannot express. `$/SLOT` is the column that
       * already answers it.
       */
      return 'none'
  }
}

/** $5 or less: technically able to bid, practically out of the running for anyone worth having. */
const MAX_BID_LOW = 5
/** Fractions of the budget. 10% of $200 is $20; a quarter is $50. */
const LEFT_CRITICAL = 0.1
const LEFT_LOW = 0.25

export function cellValue(column: ColumnKey, m: ManagerState): string {
  switch (column) {
    case 'manager':
      return m.name
    case 'spent':
      return money(m.spent)
    case 'left':
      return money(m.remaining)
    case 'needs':
      return String(m.needs)
    case 'maxBid':
      // FULL, not a number: no bid is possible, so a dollar figure would be a lie.
      return m.maxBid === null ? 'FULL' : money(m.maxBid)
    case 'pctLeft': {
      /*
       * `derive.ts` already computes this against the manager's OWN budget with bonus included, which is
       * the only denominator that stays comparable once budgets differ -- so this reads that rather than
       * recomputing and risking a second, disagreeing definition.
       *
       * Guarded because `pctRemaining` divides by a parsed budget: a manager whose budget cell came
       * through as zero yields Infinity, and `Infinity%` on the wall is worse than an em dash.
       */
      if (!Number.isFinite(m.pctRemaining)) return '—'
      const pct = Math.round(m.pctRemaining * 100)
      return `${pct < 0 ? '−' : ''}${Math.abs(pct)}%`
    }
    case 'positions':
      return ''
  }
}

/** `-$6`, not `$-6`, and an en-dash minus so it reads as negative from 25 feet. */
export function money(value: number): string {
  const sign = value < 0 ? '−' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US')}`
}
