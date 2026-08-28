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
  NAMED_PLAYERS,
  HOARDER_OVER,
  namedPlayerFor,
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

/**
 * Positions for a plausible full roster: everything except K.
 *
 * Cycling through all five gave a fifteen-slot roster three kickers, which then fired `extraKicker` and
 * outranked the moment the test was actually about. Excluding K keeps a full roster free of both kicker
 * jokes, so a test that wants one can add exactly the kicker it means to.
 */
const FILLER_POSITIONS = league.positions.filter((position) => position !== 'K')

const detect = (input: {
  sales: readonly SaleEvent[]
  log?: readonly SaleEvent[]
  slots?: SlotMap
  fired?: Set<string>
  maxBids?: Readonly<Record<string, number | null>>
}) =>
  detectMoments({
    sales: input.sales,
    log: input.log ?? [],
    slots: input.slots ?? {},
    fired: input.fired ?? new Set<string>(),
    ...(input.maxBids === undefined ? {} : { maxBids: input.maxBids }),
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

  it('FIRES even though a kept kicker is already on the board', () => {
    /*
     * This asserted the OPPOSITE until the maintainer pointed out the league keeps a kicker.
     *
     * An `everyKickerWatched` guard used to suppress the punt whenever the sheet held a creditable kicker
     * nobody had watched sell, reasoning that the one just sold could not then claim to be the first. A KEPT
     * kicker is exactly that shape -- so the guard made this moment unreachable in the only season it runs in.
     *
     * The honest event is the first kicker DRAFTED. A keeper was not drafted tonight.
     */
    const fired = new Set<string>()
    const moment = detect({
      sales: [sale({ slot: '1:9' })],
      slots: { '1:9': slot(), '7:9': slot({ manager: 'Toby' }) },
      fired,
    })
    expect(moment?.kind).toBe('firstKicker')
    expect(fired.has('firstKicker')).toBe(true)
  })

  it('still refuses once a kicker has sold TONIGHT, which is the check that survived', () => {
    // The log is the honest record of what this board has watched sell. One kicker in it is enough.
    const moment = detect({
      sales: [sale({ slot: '7:9', manager: 'Toby', seq: 4 })],
      log: [sale({ slot: '1:9', seq: 1 })],
      slots: { '1:9': slot(), '7:9': slot({ manager: 'Toby' }) },
    })
    expect(moment).toBeNull()
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

describe('playerTag', () => {
  const tagged = (over: Partial<SaleEvent> = {}) =>
    sale({
      player: 'Josh Allen',
      position: 'QB',
      manager: 'Kevin',
      price: 40,
      slot: '1:2',
      tags: ['h'],
      ...over,
    })

  it('fires when a tag rides on the sale', () => {
    const moment = detect({ sales: [tagged()] })
    expect(moment?.kind).toBe('playerTag')
    expect(moment?.tag?.tag).toBe('h')
    expect(moment?.tag?.headline).toBe('HOMER')
  })

  it('does not fire without a tag', () => {
    expect(detect({ sales: [tagged({ tags: [] })] })).toBeNull()
  })

  it('fires once per slot AND per tag, so a retraction and re-entry says nothing again', () => {
    const fired = new Set<string>()
    expect(detect({ sales: [tagged()], fired })?.kind).toBe('playerTag')
    expect(detect({ sales: [tagged({ seq: 9 })], fired })).toBeNull()
  })

  it('yields to a finished roster, since DONE is the moment the room stops for', () => {
    /* Positions cycled, so a full roster is not also a hoarding roster -- see `rosterOf` above. */
    const slots: SlotMap = Object.fromEntries(
      Array.from({ length: league.auctionSlots }, (_, i) => [
        `1:${i + 2}`,
        slot({ manager: 'Kevin', position: FILLER_POSITIONS[i % FILLER_POSITIONS.length]! }),
      ]),
    )
    slots['7:2'] = slot({ manager: 'Corky' })
    expect(detect({ sales: [tagged()], slots })?.kind).toBe('rosterFull')
  })

  it('outranks a big spend, because the recorder deliberately marked it', () => {
    expect(detect({ sales: [tagged({ price: 70 })] })?.kind).toBe('playerTag')
  })
})

describe('namedPlayer', () => {
  const sold = (player: string, over: Partial<SaleEvent> = {}) =>
    sale({ player, position: 'TE', manager: 'Kevin', price: 40, slot: '1:7', ...over })

  it('fires for a player on the table', () => {
    const moment = detect({ sales: [sold('Travis Kelce')] })
    expect(moment?.kind).toBe('namedPlayer')
    expect(moment?.sale.player).toBe('Travis Kelce')
  })

  it('matches how the name is actually typed, not one exact spelling', () => {
    // The sheet is typed by hand. Case, double spaces and a first initial are all ordinary.
    for (const spelling of ['travis kelce', 'TRAVIS  KELCE', 'T. Kelce', 't kelce']) {
      expect(namedPlayerFor(spelling)?.headline).toContain('Taylor Swift')
    }
  })

  it('does NOT match on surname alone', () => {
    /*
     * `Kelce` would also catch Jason, and congratulating the wrong brother is worse than staying quiet.
     * The same reasoning the abbreviation ladder uses for `St. Brown` against `AJ Brown`.
     */
    expect(namedPlayerFor('Kelce')).toBeNull()
    expect(namedPlayerFor('Jason Kelce')).toBeNull()
    expect(namedPlayerFor('J. Kelce')).toBeNull()
  })

  it('ignores anybody not on the table, and an empty name', () => {
    expect(namedPlayerFor('Justin Jefferson')).toBeNull()
    expect(namedPlayerFor('')).toBeNull()
    expect(namedPlayerFor('   ')).toBeNull()
    expect(detect({ sales: [sold('Justin Jefferson')] })).toBeNull()
  })

  it('fires once per slot, so a retraction and re-entry says nothing twice', () => {
    const fired = new Set<string>()
    expect(detect({ sales: [sold('Travis Kelce')], fired })?.kind).toBe('namedPlayer')
    expect(fired.has('namedPlayer:1:7')).toBe(true)
    expect(detect({ sales: [sold('Travis Kelce', { seq: 9 })], fired })).toBeNull()
  })

  it('outranks a big spend, because the joke is better than the number', () => {
    expect(detect({ sales: [sold('Travis Kelce', { price: 80 })] })?.kind).toBe('namedPlayer')
  })

  it('yields to a finished roster', () => {
    // Kelce completing somebody is still primarily them being DONE.
    /* Positions cycled, so a full roster is not also a hoarding roster -- see `rosterOf` above. */
    const slots: SlotMap = Object.fromEntries(
      Array.from({ length: league.auctionSlots }, (_, i) => [
        `1:${i + 2}`,
        slot({ manager: 'Kevin', position: FILLER_POSITIONS[i % FILLER_POSITIONS.length]! }),
      ]),
    )
    slots['7:2'] = slot({ manager: 'Corky', position: 'RB' })
    expect(detect({ sales: [sold('Travis Kelce')], slots })?.kind).toBe('rosterFull')
  })

  it('keeps every table entry pointing at a clip and a headline', () => {
    // A new named player is a line of data; this is what stops a half-filled line shipping.
    for (const entry of NAMED_PLAYERS) {
      expect(entry.player.trim()).not.toBe('')
      expect(entry.headline.trim()).not.toBe('')
      expect(entry.clip).toMatch(/\.(gif|webp|png)$/)
    }
  })
})

describe('hoarder', () => {
  /** `count` slots of `position` for one manager, plus a bystander so nothing else trips. */
  const stack = (manager: string, position: 'QB' | 'RB' | 'WR' | 'TE' | 'K', count: number): SlotMap => ({
    ...Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`1:${i + 2}`, slot({ manager, position })]),
    ),
    '7:2': slot({ manager: 'Bystander', position: 'QB' }),
  })

  const bought = (position: 'QB' | 'RB' | 'WR' | 'TE' | 'K', over: Partial<SaleEvent> = {}) =>
    sale({ manager: 'Kevin', position, player: 'Javonte Williams', price: 4, slot: '1:2', ...over })

  it('fires at SIX, the first offending number', () => {
    // Was seven, lowered on the maintainer's call: seven is rare enough that the joke mostly would not land.
    expect(HOARDER_OVER).toBe(5)
    const moment = detect({ sales: [bought('RB')], slots: stack('Kevin', 'RB', 6) })
    expect(moment?.kind).toBe('hoarder')
    expect(moment?.count).toBe(6)
  })

  it('does not fire at five, which is merely a lot', () => {
    expect(detect({ sales: [bought('RB')], slots: stack('Kevin', 'RB', 5) })).toBeNull()
  })

  it('still fires above the threshold, and reports the real count', () => {
    expect(detect({ sales: [bought('RB')], slots: stack('Kevin', 'RB', 9) })?.count).toBe(9)
  })

  it('counts the position of the sale, not the biggest stack on the roster', () => {
    /*
     * A manager with eight running backs who then buys a receiver is not being accused over the receiver.
     * The sale names what the accusation is about.
     */
    const slots: SlotMap = {
      ...Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`1:${i + 2}`, slot({ manager: 'Kevin', position: 'RB' })]),
      ),
      '1:12': slot({ manager: 'Kevin', position: 'WR' }),
      '7:2': slot({ manager: 'Bystander', position: 'QB' }),
    }
    expect(detect({ sales: [bought('WR', { slot: '1:12' })], slots })).toBeNull()
  })

  it('counts keepers, because the joke is about the roster not the auction', () => {
    // Five kept plus one bought is six on the roster, however they got there.
    expect(detect({ sales: [bought('RB')], slots: stack('Kevin', 'RB', 6) })?.count).toBe(6)
  })

  it('fires once per manager AND position, so eight does not repeat seven', () => {
    const fired = new Set<string>()
    expect(detect({ sales: [bought('RB')], slots: stack('Kevin', 'RB', 6), fired })?.kind).toBe('hoarder')
    expect(fired.has('hoarder:Kevin:RB')).toBe(true)
    expect(detect({ sales: [bought('RB', { seq: 2 })], slots: stack('Kevin', 'RB', 7), fired })).toBeNull()
  })

  it('accuses the same manager separately for a different position', () => {
    const fired = new Set(['hoarder:Kevin:RB'])
    const slots: SlotMap = {
      ...Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`1:${i + 2}`, slot({ manager: 'Kevin', position: 'WR' })]),
      ),
      '7:2': slot({ manager: 'Bystander', position: 'QB' }),
    }
    expect(detect({ sales: [bought('WR')], slots, fired })?.kind).toBe('hoarder')
  })

  it('yields to a finished roster', () => {
    /*
     * BELOW roster full, unlike the two-kicker joke. If one sale both completes a roster and tips somebody
     * into hoarding, DONE is the moment the room stops for -- and the stack is still on the board after.
     */
    const slots: SlotMap = {
      ...Object.fromEntries(
        Array.from({ length: league.auctionSlots }, (_, i) => [
          `1:${i + 2}`,
          slot({ manager: 'Kevin', position: 'RB' }),
        ]),
      ),
      '7:2': slot({ manager: 'Bystander', position: 'QB' }),
    }
    const moment = detect({ sales: [bought('RB')], slots })
    expect(moment?.kind).toBe('rosterFull')
  })

  it('ignores a sale with no position at all', () => {
    // A bench pick whose Pos cell has not been typed yet. Nothing to accuse them of.
    expect(detect({ sales: [bought('RB', { position: null })], slots: stack('Kevin', 'RB', 9) })).toBeNull()
  })
})

describe('firstBroke', () => {
  /*
   * The first manager reduced to minimum bids -- MAX BID at the floor, so they cannot outbid anybody on
   * anything. The board already calls this state `broke` in `rowState`.
   */
  const bought = (manager: string, over: Partial<SaleEvent> = {}) =>
    sale({ manager, position: 'RB', player: 'Javonte Williams', price: 30, slot: '1:4', ...over })

  it('fires when a buyer is left on minimum bids', () => {
    const moment = detect({ sales: [bought('Kevin')], maxBids: { Kevin: league.minBid } })
    expect(moment?.kind).toBe('firstBroke')
    expect(moment?.sale.manager).toBe('Kevin')
  })

  it('fires for an OVERSPENT manager too, because the floor is the same number', () => {
    /*
     * `maxBid` is `Math.max(minBid, remaining - (needs - 1) * minBid)`, so somebody $6 in the red reports
     * the same $1 as somebody exactly at the floor. `<=` rather than `===` is what covers both, and both
     * mean the same thing to a bidder: they cannot outbid anyone.
     */
    expect(detect({ sales: [bought('Kevin')], maxBids: { Kevin: 0 } })?.kind).toBe('firstBroke')
  })

  it('does not fire while a buyer can still outbid somebody', () => {
    expect(detect({ sales: [bought('Kevin')], maxBids: { Kevin: league.minBid + 1 } })).toBeNull()
    expect(detect({ sales: [bought('Kevin')], maxBids: { Kevin: 40 } })).toBeNull()
  })

  it('does not fire for a FULL roster, whose MAX BID is null rather than low', () => {
    // `null` means no bid is possible at all -- that is DONE, not broke, and it has its own moment.
    expect(detect({ sales: [bought('Kevin')], maxBids: { Kevin: null } })).toBeNull()
  })

  it('cannot fire without max bids, rather than guessing', () => {
    expect(detect({ sales: [bought('Kevin')] })).toBeNull()
    expect(detect({ sales: [bought('Kevin')], maxBids: {} })).toBeNull()
  })

  it('fires once for the night, not once per manager', () => {
    // The joke is being FIRST to run out. The second manager to get there is just arithmetic.
    const fired = new Set<string>()
    expect(detect({ sales: [bought('Kevin')], maxBids: { Kevin: 1 }, fired })?.kind).toBe('firstBroke')
    expect(fired.has('firstBroke')).toBe(true)
    expect(detect({ sales: [bought('Corky', { seq: 2 })], maxBids: { Corky: 1 }, fired })).toBeNull()
  })

  it('yields to a finished roster when one sale does both', () => {
    /*
     * A last pick that also empties the wallet. DONE is the moment the room stops for, and both are
     * consumed so the broke joke is not told separately one poll later.
     */
    const fired = new Set<string>()
    /* Positions cycled, so a full roster is not also a hoarding roster -- see `rosterOf` above. */
    const slots: SlotMap = Object.fromEntries(
      Array.from({ length: league.auctionSlots }, (_, i) => [
        `1:${i + 2}`,
        slot({ manager: 'Kevin', position: FILLER_POSITIONS[i % FILLER_POSITIONS.length]! }),
      ]),
    )
    slots['7:2'] = slot({ manager: 'Corky', position: 'RB' })
    const moment = detect({ sales: [bought('Kevin')], slots, maxBids: { Kevin: 1 }, fired })
    expect(moment?.kind).toBe('rosterFull')
    expect([...fired].sort()).toEqual(['firstBroke', 'rosterFull:Kevin'])
  })

  it('outranks a big spend, since going broke is the more interesting half of it', () => {
    const moment = detect({
      sales: [bought('Kevin', { price: 70 })],
      maxBids: { Kevin: 1 },
    })
    expect(moment?.kind).toBe('firstBroke')
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
  /*
   * A roster with a PLAUSIBLE spread of positions, cycling through the five.
   *
   * It used to fill every slot with the same position, which the hoarder rule then correctly flagged -- a
   * fifteen-running-back roster is hoarding, so these tests started asserting the wrong moment. Rather than
   * exempt them, the fixture is now a roster somebody could actually have: fifteen slots across five
   * positions is three each, under every cap.
   */
  const rosterOf = (manager: string, count: number, col = 1): SlotMap =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `${col}:${i + 2}`,
        slot({ manager, position: FILLER_POSITIONS[i % FILLER_POSITIONS.length]!, player: `P${i}` }),
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

  it('still prefers the kicker when a kept kicker is also on the board', () => {
    /*
     * The inverse of the removed guard. A keeper sitting in the sheet no longer demotes the punt to the
     * spend -- the kicker sale is the event, and it outranks the money.
     */
    const moment = detect({
      sales: [
        sale({ slot: '1:9', seq: 1 }),
        sale({ slot: '7:3', player: 'Justin Jefferson', position: 'WR', price: 72, seq: 2 }),
      ],
      slots: { '1:9': slot(), '13:9': slot({ manager: 'Toby' }) },
    })
    expect(moment?.kind).toBe('firstKicker')
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
  it('reads every kind when a fixture is loaded', () => {
    expect(pinnedMomentKind('?fixture=2025&moment=kicker')).toBe('firstKicker')
    expect(pinnedMomentKind('?fixture=2026&moment=extra')).toBe('extraKicker')
    expect(pinnedMomentKind('?fixture=2026&moment=spender')).toBe('bigSpender')
    expect(pinnedMomentKind('?fixture=2026&moment=done')).toBe('rosterFull')
    expect(pinnedMomentKind('?fixture=2026&moment=broke')).toBe('firstBroke')
    expect(pinnedMomentKind('?fixture=2026&moment=named')).toBe('namedPlayer')
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
