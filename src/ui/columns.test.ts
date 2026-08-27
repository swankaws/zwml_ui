import { describe, expect, it } from 'vitest'
import { COLUMNS, POSITION_COLUMNS, atPositionLimit, cellValue, money, selectColumns } from './columns'
import { league, type Position } from '../config/league'
import type { ManagerState } from '../model/derive'

function managerState(overrides: Partial<ManagerState> = {}): ManagerState {
  const counts = Object.fromEntries(league.positions.map((p) => [p, 0])) as Record<Position, number>
  return {
    name: 'Kevin',
    picks: [],
    spent: 0,
    bonus: 0,
    remaining: 200,
    slotsFilled: 0,
    needs: 15,
    maxBid: 186,
    pctRemaining: 1,
    positionCounts: counts,
    overspent: false,
    overRostered: false,
    disagreements: [],
    ...overrides,
  }
}

/**
 * Measured with a CDP probe at each of the resolutions below, re-taken after the rail was trimmed from
 * 530fr to 460fr -- which handed the table 70px at 1080p and 52px on a laptop.
 */
const REAL = {
  /** 1080p projector, rail layout: table area 1368px, root type 47px. */
  projector: { width: 1368, typePx: 47 },
  /** 1024x768 fallback, stacked layout: table gets the full width, type 33.4px. */
  fourThree: { width: 983, typePx: 33.4 },
  /** 1440x900 laptop, rail layout: table area 1025px, root type 39.15px. */
  laptop: { width: 1025, typePx: 39.15 },
  /**
   * 390x844 phone, stacked: the case the priority system actually exists for.
   *
   * `typePx` was 36.7 here and that was wrong by 2x. Mobile inverts the whole type rule -- root is
   * `clamp(13px, 4.6vw, 26px)` because WIDTH is the scarce axis once the page may scroll -- so the real
   * measurement is 4.6% of 390 = 17.94px. The stale figure made the fit test twice as pessimistic as the
   * app, so these cases were asserting a two-column phone that the app has not rendered for some time;
   * it serves four. Same class of mistake as the `nameBudget` error that abbreviated 180 roster names.
   */
  phone: { width: 374, typePx: 17.94 },
  /**
   * Narrower than any phone in portrait: a split-screen pane, or a browser window dragged small. It is
   * here because the phone no longer trims a four-column set once its type size is measured correctly,
   * so this is where the fit test and the query-string bypass still visibly disagree.
   */
  narrow: { width: 240, typePx: 17.94 },
}

const keys = (options: Parameters<typeof selectColumns>[0]) =>
  selectColumns(options).map((c) => c.key)
const atWidth = (width: number) => keys({ width, typePx: 47 })

describe('selectColumns', () => {
  it('shows every default column at the projector', () => {
    expect(keys(REAL.projector)).toEqual([
      'manager',
      'maxBid',
      'left',
      'pctLeft',
      'spent',
      'needs',
      'positions',
    ])
  })

  it('shows every default column at 1024 x 768, where the rail stacks below', () => {
    // The 4:3 fallback gives the table the full width, and the type is smaller with
    // it, so nothing needs to drop.
    expect(keys(REAL.fourThree)).toEqual([
      'manager',
      'maxBid',
      'left',
      'pctLeft',
      'spent',
      'needs',
      'positions',
    ])
  })

  it('gives up SPENT on a laptop rather than truncate MAX BID', () => {
    /*
     * A 1440x900 laptop keeps the rail (it is >= 16:10), so the table gets 973px --
     * narrower than the projector's 1298px at nearly the same type size. Six columns
     * "fit" arithmetically there and MAX BID rendered "$186" 8px short on all twelve
     * rows. SPENT is redundant with LEFT, so it is the cheapest thing in the room.
     */
    expect(keys(REAL.laptop)).toEqual(['manager', 'maxBid', 'left', 'spent', 'needs', 'positions'])
  })

  it('gets the position matrix onto a phone, and still falls to the essentials below that', () => {
    /*
     * Five columns, and the fifth is the one worth having: a follow-along screen answers "who has whom",
     * which is what QB/RB/WR/TE/K says.
     *
     * The history here is two separate mistakes cancelling out. This asserted TWO columns against a
     * `typePx` of 36.7 that was wrong by 2x -- mobile sizes root from `4.6vw`, not from height, so 390px
     * is 17.94px -- which made the fit test twice as pessimistic as the app, and the app was really
     * serving four. Then the narrow widths let the fifth on: the phone had been handing MANAGER 104px to
     * draw a 66px name, and that wasted third across every column was a whole column's worth.
     *
     * The floor still bites below a phone: `narrow` re-proportions the columns, it does not exempt them.
     */
    expect(keys(REAL.phone)).toEqual(['manager', 'maxBid', 'left', 'needs', 'positions'])
    expect(keys(REAL.narrow)).toEqual(['manager', 'maxBid', 'left'])
    expect(keys({ width: 120, typePx: 17.94 })).toEqual(['manager', 'maxBid'])
  })

  it('uses the narrow width only below the mobile type ceiling', () => {
    /*
     * The switch is the type size, not the viewport, because what decides is the ratio of content to
     * room. 26px is the top of the mobile clamp; 33.41px is the smallest desktop case in the matrix.
     */
    const wide = selectColumns({ width: 2000, typePx: 33.41 })
    const narrow = selectColumns({ width: 2000, typePx: 26 })
    expect(wide.find((c) => c.key === 'manager')?.width).toBe(205)
    expect(narrow.find((c) => c.key === 'manager')?.width).toBe(174)
    // A column with no `narrow` of its own keeps its one width at both sizes.
    expect(COLUMNS.every((c) => c.narrow === undefined || c.narrow > 0)).toBe(true)
  })

  it('scales the readability floor with the type size, not the viewport width', () => {
    // Same width, larger type -> fewer columns. A width-only test cannot see this.
    expect(keys({ width: 700, typePx: 24 }).length).toBeGreaterThan(
      keys({ width: 700, typePx: 47 }).length,
    )
  })

  it('shows nothing opt-in by default, and ignores an unknown opt-in', () => {
    /*
     * `$/SLOT` was the only opt-in column and has been removed -- it moved with nomination order rather
     * than with the market. The MECHANISM is still worth a test: `enabled` naming a column that is not
     * opt-in, or not present at all, must not add or drop anything.
     */
    expect(COLUMNS.filter((c) => c.optIn)).toEqual([])
    expect(keys({ width: 1600, typePx: 47, enabled: ['spent'] })).toEqual(atWidth(1600))
  })

  it('drops columns least-important first as width shrinks', () => {
    // SPENT (5) goes before POS (4), which goes before NEEDS (3), then LEFT (2).
    const order = [1150, 800, 650, 500].map(atWidth)
    expect(order[0]).not.toContain('spent')
    expect(order[0]).toContain('positions')
    expect(order[1]).not.toContain('positions')
    expect(order[1]).toContain('needs')
    expect(order[2]).not.toContain('needs')
    expect(order[2]).toContain('left')
    expect(order[3]).not.toContain('left')
  })

  it('never drops a priority-1 column, however narrow the viewport', () => {
    // MANAGER and MAX BID are the display's whole point.
    expect(atWidth(120)).toEqual(['manager', 'maxBid'])
    expect(atWidth(1)).toEqual(['manager', 'maxBid'])
  })

  it('returns display order, not priority order', () => {
    /*
     * MAX BID now leads the figures, which is the point of the reorder: it is the one number a bidder
     * acts on and it used to sit FIFTH, behind two columns derivable from a third. SPENT is priority 5
     * yet sits ahead of NEEDS (3) and POS (4), so display order and priority are still independent --
     * which is what this test is really pinning.
     */
    const order = keys(REAL.projector)
    expect(order.indexOf('maxBid')).toBe(1)
    expect(order.indexOf('spent')).toBeLessThan(order.indexOf('needs'))
  })

  it('gives every column a priority that can actually drop, except the two that cannot', () => {
    // With no opt-in column left, the drop ladder is the whole default set. `% REM` is the cheapest.
    const narrow = keys({ width: 1300, typePx: 47 })
    expect(narrow).not.toContain('pctLeft')
    expect(narrow).toContain('spent')
  })

  it('honours a caller-supplied readability floor', () => {
    expect(keys({ width: 700, typePx: 47, minUnitPx: 0.1 })).toContain('spent')
  })

  it('assumes the projector when the type size is not yet measured', () => {
    // App renders one frame before its first measurement; that frame must not flash
    // a stripped-down board. Uses the projector's real table width, so "not stripped
    // down" means the whole default set rather than the whole set minus one.
    expect(keys({ width: REAL.projector.width })).toHaveLength(7)
  })
})

describe('a forced column set, and where it came from', () => {
  /*
   * The maintainer's live SETTINGS tab as of 2026-08-25, verbatim. It is also the
   * example row printed in DESIGN.md 9.2, which is very likely where it came from.
   */
  const LIVE = ['manager', 'left', 'needs', 'maxBid'] as const

  it('is honoured exactly on the projector, whichever layer set it', () => {
    for (const forcedFrom of ['query', 'sheet'] as const) {
      expect(keys({ ...REAL.projector, forced: LIVE, forcedFrom })).toEqual([
        'manager',
        'maxBid',
        'left',
        'needs',
      ])
    }
  })

  it('returns a forced set in display order, not the order it was written in', () => {
    // The row must read the same way however the columns were chosen.
    expect(keys({ ...REAL.projector, forced: ['maxBid', 'manager', 'spent'] })).toEqual([
      'manager',
      'maxBid',
      'spent',
    ])
  })

  it('lets a typed URL overrule the fit test, because someone is looking at the wall', () => {
    /*
     * The escape hatch of 7.2, and the reason `forcedFrom` exists rather than the fit
     * test simply applying to everything: the projector is not available until the day
     * before the draft, so if the heuristic turns out to be wrong on that hardware, a
     * URL has to be able to say "no, show these" and be obeyed.
     */
    expect(keys({ ...REAL.narrow, forced: LIVE, forcedFrom: 'query' })).toEqual([
      'manager',
      'maxBid',
      'left',
      'needs',
    ])
  })

  it('fit-tests the same set when the SHEET is what asked for it', () => {
    /*
     * A phone is where these differ, and this is not hypothetical: forced from the
     * sheet, this set truncated 41 cells on a 390x844 phone -- the NEEDS header had
     * 47px of the 73px it needed. The sheet is broadcast to everyone following along,
     * and nobody holding a phone can edit a spreadsheet to fix what they are seeing.
     */
    expect(keys({ ...REAL.narrow, forced: LIVE, forcedFrom: 'sheet' })).toEqual([
      'manager',
      'maxBid',
      'left',
    ])
  })

  it('defaults to fit-testing, so forgetting the provenance fails safe', () => {
    expect(keys({ ...REAL.narrow, forced: LIVE })).toEqual(['manager', 'maxBid', 'left'])
  })

  it('trims a sheet-forced set by priority, keeping what does fit', () => {
    /*
     * Not all-or-nothing: NEEDS (priority 3) goes before LEFT (2). A narrow window
     * should still get the operator's choice minus the cheapest part of it.
     *
     * 550px is the middle of the band where exactly one has to go -- all four fit from
     * ~597px up, and three fit from ~505px. Picking the middle rather than the edge
     * means a small change to a column width retunes this test instead of flipping it.
     */
    expect(keys({ width: 550, typePx: 39.15, forced: LIVE, forcedFrom: 'sheet' })).toEqual([
      'manager',
      'maxBid',
      'left',
    ])
  })

  it('never adds a column the forced set left out, however much room there is', () => {
    // Trimming is the only adjustment. A forced set is still a ceiling.
    expect(keys({ width: 4000, typePx: 47, forced: LIVE, forcedFrom: 'sheet' })).toEqual([
      'manager',
      'maxBid',
      'left',
      'needs',
    ])
  })

  it('ignores an empty forced set rather than rendering an empty row', () => {
    expect(keys({ ...REAL.projector, forced: [] })).toHaveLength(7)
    expect(keys({ ...REAL.projector, forced: null })).toHaveLength(7)
  })
})

describe('COLUMNS', () => {
  it('protects exactly the two columns the room cannot lose', () => {
    const protectedKeys = COLUMNS.filter((c) => c.priority === 1).map((c) => c.key)
    expect(protectedKeys).toEqual(['manager', 'maxBid'])
  })

  it('gives every column a distinct priority so drop order is deterministic', () => {
    const priorities = COLUMNS.filter((c) => c.priority !== 1).map((c) => c.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
  })
})

describe('cellValue', () => {
  it('renders FULL rather than a dollar figure when no bid is possible', () => {
    expect(cellValue('maxBid', managerState({ maxBid: null }))).toBe('FULL')
  })

  it('shows overspending honestly instead of flooring at zero', () => {
    expect(cellValue('left', managerState({ remaining: -6 }))).toBe('−$6')
  })

  it('renders % REM against the manager OWN budget, so a bonus cannot exceed 100%', () => {
    /*
     * The denominator is the point. `derive.ts` divides by this manager's budget with bonus included, so
     * a manager who was awarded $50 and has spent nothing reads 100%, not 125% -- which is what
     * denominating on the league's flat $200 would have produced.
     */
    expect(cellValue('pctLeft', managerState({ pctRemaining: 1 }))).toBe('100%')
    expect(cellValue('pctLeft', managerState({ pctRemaining: 0.615 }))).toBe('62%')
    expect(cellValue('pctLeft', managerState({ pctRemaining: 0 }))).toBe('0%')
  })

  it('signs an overspent % REM with the same unicode minus the money columns use', () => {
    // -$6 on $200. It has to read as negative from 25 feet, like `money` does.
    expect(cellValue('pctLeft', managerState({ pctRemaining: -0.03 }))).toBe('\u22123%')
  })

  it('renders an em dash for % REM rather than Infinity when the budget parses as zero', () => {
    // `pctRemaining` is a division by a PARSED budget, so a blank or junk budget cell yields Infinity or
    // NaN. Either one reaching the wall is worse than admitting the figure is unknown.
    expect(cellValue('pctLeft', managerState({ pctRemaining: Infinity }))).toBe('—')
    expect(cellValue('pctLeft', managerState({ pctRemaining: NaN }))).toBe('—')
  })

  it('renders nothing for the positions cell -- Board draws the matrix', () => {
    expect(cellValue('positions', managerState())).toBe('')
  })
})

describe('atPositionLimit', () => {
  it('marks a roster at the league cap for QB, TE and K', () => {
    // League rules: QB 3, TE 3, K 2. The kicker cap is the one that matters most, because two is already
    // one more than anybody wants -- see the extraKicker moment.
    expect(atPositionLimit('QB', 3)).toBe(true)
    expect(atPositionLimit('TE', 3)).toBe(true)
    expect(atPositionLimit('K', 2)).toBe(true)
  })

  it('leaves a roster below the cap alone', () => {
    expect(atPositionLimit('QB', 2)).toBe(false)
    expect(atPositionLimit('TE', 2)).toBe(false)
    expect(atPositionLimit('K', 1)).toBe(false)
    expect(atPositionLimit('K', 0)).toBe(false)
  })

  it('treats an OVER-cap roster as at the cap, rather than failing an equality test', () => {
    /*
     * Not hypothetical. The board mirrors a spreadsheet somebody is typing into, so a fourth QB reaches
     * the wall before anyone notices -- and rendering it in ordinary ink because `=== 3` was false would
     * be the board hiding the one thing worth saying.
     */
    expect(atPositionLimit('QB', 4)).toBe(true)
    expect(atPositionLimit('K', 9)).toBe(true)
  })

  it('never caps a position the league does not limit', () => {
    // RB and WR are bounded only by the fifteen roster slots, which is why they carry no limit at all.
    expect(atPositionLimit('RB', 15)).toBe(false)
    expect(atPositionLimit('WR', 15)).toBe(false)
  })

  it('limits only positions the board actually renders', () => {
    // A limit for a position that is not in the matrix would never be seen. DEF is drafted separately.
    for (const position of Object.keys(league.positionLimits)) {
      expect(POSITION_COLUMNS).toContain(position)
    }
  })
})

describe('money', () => {
  it('puts the minus before the dollar sign', () => {
    expect(money(-6)).toBe('−$6')
  })

  it('uses a unicode minus, which reads as negative from across a room', () => {
    expect(money(-6).startsWith('−')).toBe(true)
  })

  it('groups thousands', () => {
    expect(money(2411)).toBe('$2,411')
  })

  it('does not sign zero', () => {
    expect(money(0)).toBe('$0')
  })
})

describe('POSITION_COLUMNS', () => {
  it('covers the auction positions and omits the free defense', () => {
    expect([...POSITION_COLUMNS]).toEqual(['QB', 'RB', 'WR', 'TE', 'K'])
    expect([...POSITION_COLUMNS]).not.toContain('DEF')
  })

  it('matches the configured positions, so a config change cannot leave a gap', () => {
    expect([...POSITION_COLUMNS]).toEqual([...league.positions])
  })
})
