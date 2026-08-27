/**
 * The moment triggers (7.3).
 *
 * Every test here is a route by which a full-screen gif could interrupt live bidding wrongly. The
 * analysis that produced them is in the header of `moments.ts`; this file is that reasoning made
 * executable, because "we thought about it" is not a guard.
 */

import { describe, expect, it } from 'vitest'
import { league } from '../config/league'
import {
  BIG_SPENDER_OVER,
  MAX_PLAUSIBLE_PRICE,
  MOMENT_MAX_BATCH,
  detectMoments,
  firedFromLog,
  pinnedMomentKind,
} from './moments'
import type { SaleEvent, SlotMap, SlotState } from './diff'

function sale(over: Partial<SaleEvent> = {}): SaleEvent {
  return {
    slot: '1:9',
    player: 'Harrison Butker',
    price: 1,
    manager: 'Kevin',
    position: 'K',
    seq: 1,
    ...over,
  }
}

function slot(over: Partial<SlotState> = {}): SlotState {
  return { player: 'Harrison Butker', price: 1, manager: 'Kevin', position: 'K', suspect: false, ...over }
}

const detect = (input: {
  sales: readonly SaleEvent[]
  log?: readonly SaleEvent[]
  slots?: SlotMap
  fired?: Set<string>
}) =>
  detectMoments({
    sales: input.sales,
    log: input.log ?? [],
    slots: input.slots ?? {},
    fired: input.fired ?? new Set<string>(),
  })

describe('firstKicker', () => {
  it('fires when a kicker sells and the sheet holds no other', () => {
    const k = sale({ price: 2, manager: 'Corky' })
    const moment = detect({ sales: [k], slots: { '1:9': slot({ price: 2, manager: 'Corky' }) } })
    expect(moment).toEqual({ kind: 'firstKicker', sale: k })
  })

  it('fires for a $1 kicker, which is the funniest case', () => {
    // Ten of the twelve 2025 kickers went for $1 or $2, and `minBid` is $1, so this is the common case.
    expect(detect({ sales: [sale({ price: league.minBid })], slots: { '1:9': slot() } })?.kind).toBe(
      'firstKicker',
    )
  })

  it('does not fire for a keeper kicker', () => {
    /*
     * The 7pm case. A kicker already in the sheet when the board opens is part of the baseline and emits
     * no sale at all -- so there is nothing to fire on. Asserted here at this layer too, because a future
     * caller passing the baseline's slots as `sales` would be a very quiet disaster.
     */
    expect(detect({ sales: [], slots: { '1:9': slot() } })).toBeNull()
  })

  it('mutates the fired set by reference, as applyDiff and bumpRevisions do', () => {
    const fired = new Set<string>()
    detect({ sales: [sale()], slots: { '1:9': slot() }, fired })
    expect(fired.has('firstKicker')).toBe(true)
  })

  it('does not fire twice', () => {
    const fired = new Set(['firstKicker'])
    expect(detect({ sales: [sale({ seq: 2 })], slots: { '1:9': slot() }, fired })).toBeNull()
  })

  it('does not fire when the sheet holds a kicker nobody watched sell', () => {
    /*
     * Trap 2: the board opened late, or was reopened in a fresh tab. `sessionStorage` dies with the tab
     * and the 30-minute window expires, so the log opens empty and the earlier kicker is absorbed into
     * the baseline -- making the SECOND kicker of the night look like the first.
     *
     * Consuming as well as suppressing is the point: otherwise the third kicker fires instead, which is
     * the same false claim one poll later.
     */
    const fired = new Set<string>()
    const moment = detect({
      sales: [sale({ slot: '1:9' })],
      slots: { '1:9': slot(), '7:9': slot({ manager: 'Toby' }) },
      fired,
    })
    expect(moment).toBeNull()
    expect(fired.has('firstKicker')).toBe(true)
  })

  it('refuses when the log already holds a kicker, even with an empty fired set', () => {
    /*
     * Belt and braces. In production `firedFromLog` seeds `firstKicker` from a restored session, so the
     * set alone would do -- but a lost or mis-wired seed would then re-punt a kicker this board had
     * already announced, which is the one failure the room would actually notice. Checking the log
     * directly costs a predicate and makes the seed an optimisation rather than the guard.
     */
    const moment = detect({
      sales: [sale({ slot: '7:9', manager: 'Toby', seq: 4 })],
      log: [sale({ slot: '1:9', seq: 1 })],
      slots: { '1:9': slot(), '7:9': slot({ manager: 'Toby' }) },
      fired: new Set<string>(),
    })
    expect(moment).toBeNull()
  })

  it('is invisible to a kicker slot the diff engine would never emit', () => {
    // A suspect price or a sub-minBid price is not creditable, so it neither fires nor suppresses.
    const moment = detect({
      sales: [sale({ slot: '1:9' })],
      slots: { '1:9': slot(), '7:9': slot({ suspect: true }), '13:9': slot({ price: 0 }) },
    })
    expect(moment?.kind).toBe('firstKicker')
  })

  it('cannot be fired by a defense, because a DEF row is not a pick at all', () => {
    /*
     * Pins the invariant rather than the behaviour: defenses are free and drafted before the auction, and
     * they are safe because `rowOffsets.def` sits outside the ranges gridParser collects. If that ever
     * moves into the bench range, this fails and someone reads this comment.
     */
    const { rowOffsets } = league.grid
    const [benchFirst, benchLast] = rowOffsets.bench
    const [startersFirst, startersLast] = rowOffsets.starters
    expect(rowOffsets.def).toBeGreaterThan(benchLast)
    expect(rowOffsets.def).toBeGreaterThan(startersLast)
    expect(rowOffsets.def < startersFirst || rowOffsets.def > benchLast).toBe(true)
    expect(benchFirst).toBeGreaterThan(startersFirst)

    // And a pick with no position -- which is what gridParser yields for a DEF-shaped row -- is not a K.
    expect(detect({ sales: [sale({ position: null })] })).toBeNull()
  })
})

describe('bigSpender', () => {
  const spend = (price: number, over: Partial<SaleEvent> = {}) =>
    sale({ position: 'RB', player: 'Justin Jefferson', price, slot: '1:3', ...over })

  it('fires strictly over the threshold', () => {
    expect(detect({ sales: [spend(BIG_SPENDER_OVER + 1)] })?.kind).toBe('bigSpender')
    expect(detect({ sales: [spend(BIG_SPENDER_OVER)] })).toBeNull()
    expect(detect({ sales: [spend(1)] })).toBeNull()
  })

  it('ignores a price too large to be real', () => {
    // `$700` for `$70` is a plausible slip. The `$70`-for-$7 version is not closable and is accepted.
    expect(detect({ sales: [spend(MAX_PLAUSIBLE_PRICE)] })?.kind).toBe('bigSpender')
    expect(detect({ sales: [spend(MAX_PLAUSIBLE_PRICE + 1)] })).toBeNull()
    expect(detect({ sales: [spend(700)] })).toBeNull()
  })

  it('does not fire again for the same slot after a retraction and re-entry', () => {
    const fired = new Set<string>()
    expect(detect({ sales: [spend(70)], fired })?.kind).toBe('bigSpender')
    expect(fired.has('bigSpender:1:3')).toBe(true)
    expect(detect({ sales: [spend(70, { seq: 9 })], fired })).toBeNull()
  })

  it('shows the bigger of two spends in one poll and consumes both', () => {
    const fired = new Set<string>()
    const moment = detect({
      sales: [spend(70, { slot: '1:3', seq: 1 }), spend(80, { slot: '7:3', seq: 2 })],
      fired,
    })
    expect(moment?.sale.price).toBe(80)
    expect([...fired].sort()).toEqual(['bigSpender:1:3', 'bigSpender:7:3'])
  })

  it('breaks a price tie on the earlier observation, so the choice is deterministic', () => {
    const moment = detect({
      sales: [spend(70, { slot: '7:3', seq: 5 }), spend(70, { slot: '1:3', seq: 2 })],
    })
    expect(moment?.sale.seq).toBe(2)
  })
})

describe('a poll that earns both', () => {
  it('shows the kicker and consumes both, since the kicker can only happen once', () => {
    const fired = new Set<string>()
    const moment = detect({
      sales: [
        sale({ slot: '1:9', seq: 1 }),
        sale({ slot: '7:3', player: 'Justin Jefferson', position: 'WR', price: 72, seq: 2 }),
      ],
      slots: { '1:9': slot() },
      fired,
    })
    expect(moment?.kind).toBe('firstKicker')
    expect([...fired].sort()).toEqual(['bigSpender:7:3', 'firstKicker'])
  })

  it('falls back to the spend when the kicker is suppressed as unaccounted', () => {
    const moment = detect({
      sales: [
        sale({ slot: '1:9', seq: 1 }),
        sale({ slot: '7:3', player: 'Justin Jefferson', position: 'WR', price: 72, seq: 2 }),
      ],
      // A second kicker in the sheet that nobody watched sell.
      slots: { '1:9': slot(), '13:9': slot({ manager: 'Toby' }) },
    })
    expect(moment?.kind).toBe('bigSpender')
  })
})

describe('a batch of sales is the sheet changing, not the auction', () => {
  it('shows nothing but consumes everything past the batch limit', () => {
    /*
     * Trap 3. A row inserted above the grid re-keys every slot below it -- league.ts records that this
     * reads as "eight managers' whole rosters as brand-new sales" -- and an outage that ends after
     * several picks delivers them together. Naming one of them would be arbitrary.
     */
    const fired = new Set<string>()
    const sales = [
      sale({ slot: '1:9', seq: 1 }),
      sale({ slot: '7:3', position: 'RB', price: 70, seq: 2 }),
      sale({ slot: '13:4', position: 'WR', price: 71, seq: 3 }),
    ]
    expect(sales.length).toBeGreaterThan(MOMENT_MAX_BATCH)
    expect(detect({ sales, slots: { '1:9': slot() }, fired })).toBeNull()
    expect(fired.has('firstKicker')).toBe(true)
  })

  it('still shows at exactly the batch limit, because two players really can land between polls', () => {
    const sales = Array.from({ length: MOMENT_MAX_BATCH }, (_, i) =>
      i === 0 ? sale({ slot: '1:9', seq: 1 }) : sale({ slot: '7:4', position: 'WR', price: 3, seq: 2 }),
    )
    expect(detect({ sales, slots: { '1:9': slot() } })?.kind).toBe('firstKicker')
  })
})

describe('firedFromLog', () => {
  it('seeds nothing from an empty log', () => {
    expect(firedFromLog([])).toEqual(new Set())
  })

  it('seeds the kicker and every big spend from a restored log', () => {
    /*
     * This is what makes a watchdog reload safe without touching `SessionRecord`. Adding a field there
     * would either type an old record as valid and crash on `undefined`, or join `looksLikeRecord` and
     * silently discard the pointer and the ticker on every reload.
     */
    const fired = firedFromLog([
      sale({ slot: '1:9', seq: 1 }),
      sale({ slot: '7:3', position: 'WR', price: 72, seq: 2 }),
      sale({ slot: '13:5', position: 'RB', price: 4, seq: 3 }),
      sale({ slot: '19:2', position: 'QB', price: 700, seq: 4 }),
    ])
    expect([...fired].sort()).toEqual(['bigSpender:7:3', 'firstKicker'])
  })
})

describe('pinnedMomentKind', () => {
  it('reads the two kinds when a fixture is loaded', () => {
    expect(pinnedMomentKind('?fixture=2025&moment=kicker')).toBe('firstKicker')
    expect(pinnedMomentKind('?fixture=2026&moment=spender')).toBe('bigSpender')
  })

  it('refuses without a fixture, so a bookmark cannot strand the projector', () => {
    /*
     * A pinned overlay has no timer and no key out -- that is what makes it measurable -- so this guard
     * is the difference between a gate case and an undismissable gif on the wall all evening.
     */
    expect(pinnedMomentKind('?moment=kicker')).toBeNull()
    expect(pinnedMomentKind('?moment=spender')).toBeNull()
  })

  it('ignores anything it does not recognise', () => {
    expect(pinnedMomentKind('?fixture=2025&moment=punt')).toBeNull()
    expect(pinnedMomentKind('?fixture=2025&view=kicker')).toBeNull()
    expect(pinnedMomentKind('')).toBeNull()
  })
})
