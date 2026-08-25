import { describe, expect, it } from 'vitest'
import { COLUMNS, POSITION_COLUMNS, cellValue, money, selectColumns } from './columns'
import { league, type Position } from '../config/league'
import type { ManagerState } from '../model/derive'

function managerState(overrides: Partial<ManagerState> = {}): ManagerState {
  const counts = Object.fromEntries(league.positions.map((p) => [p, 0])) as Record<Position, number>
  return {
    name: 'Kevin',
    picks: [],
    spent: 0,
    remaining: 200,
    slotsFilled: 0,
    needs: 15,
    maxBid: 186,
    pctRemaining: 1,
    avgPerSlot: 200 / 15,
    positionCounts: counts,
    overspent: false,
    overRostered: false,
    disagreements: [],
    ...overrides,
  }
}

/** Measured with tools/measure.mjs at each of the resolutions below. */
const REAL = {
  /** 1080p projector, rail layout: table area 1298px, root type 47px. */
  projector: { width: 1298, typePx: 47 },
  /** 1024x768 fallback, stacked layout: table gets the full width, type 33.4px. */
  fourThree: { width: 983, typePx: 33.4 },
  /** 1440x900 laptop, rail layout: table area 973px, root type 39.15px. */
  laptop: { width: 973, typePx: 39.15 },
  /** 390x844 phone, stacked: the case the priority system actually exists for. */
  phone: { width: 374, typePx: 36.7 },
}

const keys = (options: Parameters<typeof selectColumns>[0]) =>
  selectColumns(options).map((c) => c.key)
const atWidth = (width: number) => keys({ width, typePx: 47 })

describe('selectColumns', () => {
  it('shows every default column at the projector', () => {
    expect(keys(REAL.projector)).toEqual([
      'manager',
      'spent',
      'left',
      'needs',
      'maxBid',
      'positions',
    ])
  })

  it('shows every default column at 1024 x 768, where the rail stacks below', () => {
    // The 4:3 fallback gives the table the full width, and the type is smaller with
    // it, so nothing needs to drop.
    expect(keys(REAL.fourThree)).toEqual([
      'manager',
      'spent',
      'left',
      'needs',
      'maxBid',
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
    expect(keys(REAL.laptop)).toEqual(['manager', 'left', 'needs', 'maxBid', 'positions'])
  })

  it('drops down to the two essential columns on a phone', () => {
    /*
     * The regression this model was rewritten for. With a fixed px-per-unit floor
     * this kept four columns and truncated LEFT, NEEDS and MAX BID on all twelve
     * rows: a phone in portrait has nearly a laptop's type size in a third of the
     * width, so the floor has to scale with the type.
     */
    expect(keys(REAL.phone)).toEqual(['manager', 'maxBid'])
  })

  it('scales the readability floor with the type size, not the viewport width', () => {
    // Same width, larger type -> fewer columns. A width-only test cannot see this.
    expect(keys({ width: 700, typePx: 24 }).length).toBeGreaterThan(
      keys({ width: 700, typePx: 47 }).length,
    )
  })

  it('leaves $/SLOT out unless it is opted in', () => {
    expect(atWidth(1600)).not.toContain('perSlot')
    expect(keys({ width: 1600, typePx: 47, enabled: ['perSlot'] })).toContain('perSlot')
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
    // MAX BID is priority 1 but sits fifth, after the numbers that derive it.
    expect(keys(REAL.projector).indexOf('maxBid')).toBe(4)
  })

  it('keeps opted-in columns subject to the same priority drop', () => {
    const narrow = keys({ width: 1300, typePx: 47, enabled: ['perSlot'] })
    // $/SLOT is priority 6 -- the very first thing to go once it is on.
    expect(narrow).not.toContain('perSlot')
    expect(narrow).toContain('spent')
  })

  it('honours a caller-supplied readability floor', () => {
    expect(keys({ width: 700, typePx: 47, minUnitPx: 0.1 })).toContain('spent')
  })

  it('assumes the projector when the type size is not yet measured', () => {
    // App renders one frame before its first measurement; that frame must not flash
    // a stripped-down board.
    expect(keys({ width: 1298 })).toHaveLength(6)
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

  it('renders an em dash for $/SLOT when the roster is full', () => {
    expect(cellValue('perSlot', managerState({ avgPerSlot: null }))).toBe('—')
  })

  it('floors $/SLOT rather than rounding up, so it never overstates the ceiling', () => {
    expect(cellValue('perSlot', managerState({ avgPerSlot: 13.9 }))).toBe('$13')
  })

  it('shows overspending honestly instead of flooring at zero', () => {
    expect(cellValue('left', managerState({ remaining: -6 }))).toBe('−$6')
  })

  it('renders nothing for the positions cell -- Board draws the matrix', () => {
    expect(cellValue('positions', managerState())).toBe('')
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
