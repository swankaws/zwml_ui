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
  MOMENT_HOLD_MS,
  MAX_PLAUSIBLE_PRICE,
  MOMENT_MAX_BATCH,
  detectMoments,
  firedFromLog,
  pinnedClip,
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

describe('extraKicker', () => {
  /*
   * The maintainer's rule: more than one kicker on a roster is poor strategy, so it earns mockery. The
   * count comes from the SHEET including keepers, because the joke is about the roster rather than about
   * the auction -- kept one and bought another is still two kickers.
   */
  const held = (manager: string, count: number, col: number): SlotMap =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${col}:${9 + i}`, slot({ manager })]),
    )

  it('fires when a kicker sale gives a manager their second', () => {
    const slots = held('Kevin', 2, 1)
    const moment = detect({ sales: [sale({ slot: '1:10' })], slots })
    expect(moment?.kind).toBe('extraKicker')
    expect(moment?.count).toBe(2)
  })

  it('counts a KEEPER as the first one', () => {
    // The case the maintainer named: they already had one, keeper or otherwise.
    const slots = { '1:9': slot(), '1:10': slot() }
    expect(detect({ sales: [sale({ slot: '1:10' })], slots })?.count).toBe(2)
  })

  it('does not fire for a manager taking their FIRST kicker', () => {
    const slots = { ...held('Kevin', 1, 1), ...held('Corky', 1, 7) }
    expect(detect({ sales: [sale({ slot: '1:9' })], slots })?.kind).not.toBe('extraKicker')
  })

  it('counts up, so a third kicker says three', () => {
    const slots = held('Kevin', 3, 1)
    expect(detect({ sales: [sale({ slot: '1:11' })], slots })?.count).toBe(3)
  })

  it('fires per SLOT, so each additional kicker gets its own mockery but no repeats', () => {
    const fired = new Set<string>()
    const slots = held('Kevin', 3, 1)
    expect(detect({ sales: [sale({ slot: '1:10' })], slots, fired })?.kind).toBe('extraKicker')
    // The same pick again -- a retraction and re-entry -- says nothing.
    expect(detect({ sales: [sale({ slot: '1:10', seq: 9 })], slots, fired })).toBeNull()
    // A different slot is a different kicker, and does fire.
    expect(detect({ sales: [sale({ slot: '1:11', seq: 10 })], slots, fired })?.kind).toBe('extraKicker')
  })

  it('outranks the first-kicker punt when a sale is both', () => {
    /*
     * They rarely compete: a manager holding a keeper kicker is an unaccounted kicker in the sheet, which
     * suppresses `firstKicker` on its own. Pinned anyway, because "which joke wins" should not be an
     * accident of declaration order.
     */
    const fired = new Set<string>()
    const slots = { '1:9': slot(), '1:10': slot() }
    const moment = detect({ sales: [sale({ slot: '1:10' })], slots, fired })
    expect(moment?.kind).toBe('extraKicker')
  })

  it('is not fired by a non-kicker sale to a manager who holds two kickers', () => {
    const slots = { ...held('Kevin', 2, 1), '1:3': slot({ position: 'RB', player: 'Bijan' }) }
    expect(detect({ sales: [sale({ slot: '1:3', position: 'RB' })], slots })).toBeNull()
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

  it('needs a NEW RECORD, not merely a big price', () => {
    /*
     * The rule the maintainer asked for, and it is better than a fixed threshold: it scales with however
     * the room bids and is naturally rare -- about six new maxima over 180 picks for a random ordering.
     * A standing $80 on the board means a $70 sale is just an expensive player.
     */
    const board: SlotMap = { '7:3': slot({ position: 'WR', price: 80, player: 'Ja Marr Chase' }) }
    expect(detect({ sales: [spend(70)], slots: board })).toBeNull()
    expect(detect({ sales: [spend(81)], slots: board })?.kind).toBe('bigSpender')
  })

  it('counts KEEPERS toward the record, because they are prices on the board', () => {
    /*
     * If the biggest price on the board is a $70 keeper, a $68 auction sale is not the top of anything.
     * Read from the sheet rather than from the sale log, which is what makes that true.
     */
    const withKeeper: SlotMap = { '13:2': slot({ position: 'QB', price: 70, player: 'Josh Allen' }) }
    expect(detect({ sales: [spend(68)], slots: withKeeper })).toBeNull()
    expect(detect({ sales: [spend(71)], slots: withKeeper })?.kind).toBe('bigSpender')
  })

  it('keeps the floor, so the first sale of the night is not a celebration', () => {
    // Every opening sale is trivially a new maximum. Without a floor, a $1 flyer would fire.
    expect(detect({ sales: [spend(1)], slots: {} })).toBeNull()
    expect(detect({ sales: [spend(BIG_SPENDER_OVER)], slots: {} })).toBeNull()
    expect(detect({ sales: [spend(BIG_SPENDER_OVER + 1)], slots: {} })?.kind).toBe('bigSpender')
  })

  it('ignores a slot the diff engine would never credit when judging the record', () => {
    // A suspect $0 price is not a price. It must not sit on the board as an unbeatable record either.
    const board: SlotMap = { '7:3': slot({ position: 'WR', price: 99, suspect: true }) }
    expect(detect({ sales: [spend(70)], slots: board })?.kind).toBe('bigSpender')
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

describe('rosterFull', () => {
  /** `count` picks for `manager`, keyed so each is its own slot. */
  const rosterOf = (manager: string, count: number, col = 1): SlotMap =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `${col}:${i + 2}`,
        slot({ manager, position: 'RB', player: `P${i}` }),
      ]),
    )

  const lastPick = (manager: string, over: Partial<SaleEvent> = {}) =>
    sale({ manager, position: 'RB', player: 'Javonte Williams', slot: '1:16', price: 1, ...over })

  it('fires when a sale takes a manager to NEEDS 0', () => {
    const slots = { ...rosterOf('Kevin', league.auctionSlots), ...rosterOf('Corky', 3, 7) }
    const moment = detect({ sales: [lastPick('Kevin')], slots })
    expect(moment?.kind).toBe('rosterFull')
    expect(moment?.sale.manager).toBe('Kevin')
  })

  it('does not fire while a manager still needs a slot', () => {
    const slots = { ...rosterOf('Kevin', league.auctionSlots - 1), ...rosterOf('Corky', 3, 7) }
    expect(detect({ sales: [lastPick('Kevin')], slots })).toBeNull()
  })

  it('fires once per manager, so a retraction and re-fill does not repeat it', () => {
    const fired = new Set<string>()
    const slots = { ...rosterOf('Kevin', league.auctionSlots), ...rosterOf('Corky', 3, 7) }
    expect(detect({ sales: [lastPick('Kevin')], slots, fired })?.kind).toBe('rosterFull')
    expect(fired.has('rosterFull:Kevin')).toBe(true)
    expect(detect({ sales: [lastPick('Kevin', { seq: 9 })], slots, fired })).toBeNull()
  })

  it('fires separately for each manager', () => {
    /*
     * A third manager who is still going, deliberately: with only two and both full, this would trip the
     * "everyone is done" rule below and be left to the finale -- which is how the first draft of this
     * test failed, and a useful reminder that the two rules interact.
     */
    const fired = new Set(['rosterFull:Kevin'])
    const slots = {
      ...rosterOf('Kevin', league.auctionSlots),
      ...rosterOf('Corky', league.auctionSlots, 7),
      ...rosterOf('Toby', 4, 13),
    }
    const moment = detect({ sales: [lastPick('Corky')], slots, fired })
    expect(moment?.kind).toBe('rosterFull')
    expect(moment?.sale.manager).toBe('Corky')
  })

  it('shows only ONE of two managers finishing in the SAME poll, and consumes both', () => {
    /*
     * A KNOWN LIMITATION, pinned so it is a decision rather than a surprise.
     *
     * Two sales in one poll is within MOMENT_MAX_BATCH, so the batch guard does not suppress them -- but
     * `detectMoments` returns a single moment, and `consume()` spends every candidate it found. So the
     * second manager to finish in that same three-second window is never announced.
     *
     * It needs two rosters to fill inside one poll, which takes two sales landing together late in the
     * draft. Fixing it means a QUEUE in the overlay -- moments waiting their turn behind one another -- and
     * that is a real amount of machinery for a rare case. Left as is deliberately; this test is the record.
     */
    const fired = new Set<string>()
    const slots = {
      ...rosterOf('Kevin', league.auctionSlots),
      ...rosterOf('Corky', league.auctionSlots, 7),
      ...rosterOf('Toby', 4, 13),
    }
    const moment = detect({
      sales: [lastPick('Kevin', { seq: 1 }), lastPick('Corky', { slot: '7:16', seq: 2 })],
      slots,
      fired,
    })

    expect(moment?.kind).toBe('rosterFull')
    expect(moment?.sale.manager).toBe('Kevin')
    /* Corky's was spent without being shown -- which is the limitation, stated. */
    expect([...fired].sort()).toEqual(['rosterFull:Corky', 'rosterFull:Kevin'])
  })

  it('does not fire for a manager who was already full when the board opened', () => {
    // They have no further sale to fire on -- the baseline rule does this for free. Asserted because a
    // future caller feeding the baseline in as `sales` would be a very quiet mistake.
    const slots = { ...rosterOf('Kevin', league.auctionSlots), ...rosterOf('Corky', 3, 7) }
    expect(detect({ sales: [], slots })).toBeNull()
  })

  it('leaves the LAST manager to the finale rather than burying it', () => {
    /*
     * When everybody is full the draft is over and `Complete.tsx` takes the screen with the awards.
     * Congratulating one manager in front of that would bury the bigger moment.
     */
    const slots = {
      ...rosterOf('Kevin', league.auctionSlots),
      ...rosterOf('Corky', league.auctionSlots, 7),
    }
    const fired = new Set(['rosterFull:Kevin'])
    expect(detect({ sales: [lastPick('Corky')], slots, fired })).toBeNull()
  })

  it('yields to the first kicker, and both are consumed', () => {
    // A kicker as somebody's final pick is entirely plausible -- ten of the 2025 kickers went for $1.
    const fired = new Set<string>()
    const slots = { ...rosterOf('Kevin', league.auctionSlots), ...rosterOf('Corky', 3, 7) }
    slots['1:9'] = slot({ manager: 'Kevin' })
    const moment = detect({
      sales: [sale({ manager: 'Kevin', slot: '1:9' })],
      slots,
      fired,
    })
    expect(moment?.kind).toBe('firstKicker')
    expect([...fired].sort()).toEqual(['firstKicker', 'rosterFull:Kevin'])
  })

  it('outranks a big spend, because it is the moment the room stops for', () => {
    const slots = { ...rosterOf('Kevin', league.auctionSlots), ...rosterOf('Corky', 3, 7) }
    const moment = detect({ sales: [lastPick('Kevin', { price: 70 })], slots })
    expect(moment?.kind).toBe('rosterFull')
  })

  it('holds the screen far longer than the other two, on purpose', () => {
    // The riskiest number in the feature: for this long the board is not visible. It is survivable only
    // because a newer sale supersedes it and any key dismisses it.
    expect(MOMENT_HOLD_MS.rosterFull).toBeGreaterThan(MOMENT_HOLD_MS.firstKicker)
    expect(MOMENT_HOLD_MS.rosterFull).toBe(15_000)
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
    /*
     * `extraKicker:1:9` is here too, and deliberately so: the log does not say whether that kicker was
     * somebody's second at the time, so every kicker sale gets its slot marked. Marking one that never
     * fired costs a joke nobody expected; missing one repeats a joke the room already had.
     */
    expect([...fired].sort()).toEqual(['bigSpender:7:3', 'extraKicker:1:9', 'firstKicker'])
  })
})

describe('pinnedClip', () => {
  it('reads a 1-based clip number', () => {
    expect(pinnedClip('?fixture=2026&moment=spender&clip=2')).toBe(2)
    expect(pinnedClip('?clip=1')).toBe(1)
  })

  it('is absent when not asked for', () => {
    expect(pinnedClip('?fixture=2026&moment=spender')).toBeNull()
    expect(pinnedClip('')).toBeNull()
  })

  it('ignores anything that is not a positive number', () => {
    // A preview knob: a bad value falls back to the name-seeded pick rather than breaking the overlay.
    for (const raw of ['0', '-1', 'two', '', 'NaN']) expect(pinnedClip(`?clip=${raw}`)).toBeNull()
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
