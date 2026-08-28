/**
 * In-draft moments: the first kicker, and a big spend (docs/DESIGN.md 7.3).
 *
 * A pure function over `(this poll's sales, the log BEFORE them, the sheet's slots, what has already
 * fired)`. It is pure for the same reason the pointer is: this decides whether a full-screen overlay
 * interrupts live bidding, and the failure mode is a gif on the wall over the next nomination. Every
 * false-positive route below is closed by a test rather than by care.
 *
 * WHAT IS SAFE FOR FREE, and worth recording so nobody adds a redundant guard later:
 *
 *   - DEFENSES cannot fire anything. The defensive draft happens before the auction and the DEF row is
 *     outside the ranges `gridParser` collects (`rowOffsets.def = 17`, against starters 2-8 and bench
 *     9-16), so a DEF row never becomes a `Pick`, never a `SlotState`, never a `SaleEvent`. `K` by
 *     contrast is a STARTER row and is collected normally.
 *   - KEEPERS cannot fire anything. The first successful parse sets the baseline and returns before any
 *     diff, so everything already in the sheet emits zero sales.
 *   - A HALF-TYPED ROW cannot fire anything. `creditable` holds back a suspect price or anything under
 *     `minBid`, and a blank price never becomes a pick at all -- so `$0 -- A KICKER, REALLY` is
 *     unreachable.
 *   - A MANAGER RENAME cannot fire anything, because slots are keyed geometrically.
 *
 * WHAT IS NOT SAFE, and is closed here:
 *
 *   1. Reading the log AFTER the new sales are appended answers "has a kicker already sold?" with the
 *      very kicker being asked about, so the egg never fires. The caller must pass the log as it was.
 *   2. WAS closed by an `everyKickerWatched` guard, which has been REMOVED -- and the removal is the
 *      maintainer's call, correctly. That guard suppressed the punt whenever the sheet held a creditable
 *      kicker nobody had watched sell, on the reasoning that the one just sold could not then claim to be
 *      the first. But a KEPT kicker is exactly that shape, and this league keeps one -- so the guard made
 *      the moment unreachable in the only season it would ever run in.
 *
 *      The honest event is the first kicker DRAFTED, not the first kicker on the board. A keeper was not
 *      drafted tonight. What survives is the narrower and more useful check: a kicker already in this
 *      tab's log means one has already sold tonight, so this is not the first sale.
 *
 *      The residual exposure, stated rather than hidden: a fresh tab opened mid-draft, after a kicker has
 *      sold and with no restorable session, would announce the second one as the first. That is a mild
 *      wrong claim against a moment that otherwise never fires at all.
 *   3. A row inserted into the sheet re-keys every slot below it and reads as dozens of new sales, one
 *      of which will be a kicker. Closed by `MOMENT_MAX_BATCH`, the same reasoning `revisions.ts`
 *      already applies to the value flash.
 *   4. Firing twice for one sale. Closed by `fired`, which the caller owns and which deliberately
 *      survives `X` -- see `boardStore`.
 */

import { league } from '../config/league'
import { creditable, type SaleEvent, type SlotMap } from './diff'
import { firstTagOf, type PlayerTag } from './playerTags'

export type MomentKind =
  | 'firstKicker'
  | 'extraKicker'
  | 'rosterFull'
  | 'hoarder'
  | 'firstBroke'
  | 'namedPlayer'
  | 'playerTag'
  | 'bigSpender'

export interface Moment {
  kind: MomentKind
  /** The sale that earned it. The overlay names the player, the manager and the price. */
  sale: SaleEvent
  /**
   * A count the headline needs: kickers held for `extraKicker`, players at that position for `hoarder`.
   *
   * Carried on the moment rather than recomputed in the UI, because the overlay would have to be handed
   * the whole slot map to work it out -- and the headline says the number, so a second opinion about it
   * is exactly the kind of drift that puts "TWO KICKERS" over a roster holding three.
   */
  count?: number
  /**
   * The tag entry that fired this. `playerTag` only.
   *
   * Carried so the overlay reads its copy and clip straight off the moment rather than looking the tag up a
   * second time -- one lookup here, then everywhere downstream is data.
   */
  tag?: PlayerTag
}

/**
 * How long each moment holds the screen, in ms.
 *
 * `rosterFull` is much longer on the maintainer's call: when somebody finishes, the room stops and
 * celebrates before the next nomination, so the overlay should last about as long as the pause does. It
 * is the riskiest number in this feature -- for those 15 seconds the board is not visible -- and three
 * things make it survivable, all of which must stay: any newer sale hides it at once (so it can never
 * sit over live bidding), any key or tap dismisses it, and `eggs off` turns the whole thing off from the
 * SETTINGS tab with no deploy.
 *
 * The others are short because they land mid-flow rather than in a pause.
 */
export const MOMENT_HOLD_MS: Record<MomentKind, number> = {
  firstKicker: 5_000,
  /* Longer than the first kicker: it is the better joke, and it is much rarer. */
  extraKicker: 8_000,
  hoarder: 6_000,
  /* Once a night, like the kicker, and it lands mid-flow rather than in a pause. */
  firstBroke: 5_000,
  namedPlayer: 6_000,
  playerTag: 5_500,
  bigSpender: 3_500,
  rosterFull: 15_000,
}

/**
 * Players who get their own moment when they sell.
 *
 * A TABLE rather than a branch, so the next one is a line of data instead of a new `MomentKind`, a new
 * switch arm in two files and a new gate case. `clip` lives here beside the copy because the two only ever
 * change together -- splitting them across the model and the UI is how a headline ends up over the wrong
 * picture.
 */
export interface NamedPlayer {
  /** Matched loosely -- see `namedPlayerFor`. */
  player: string
  headline: string
  clip: string
}

export const NAMED_PLAYERS: readonly NamedPlayer[] = [
  { player: 'Travis Kelce', headline: 'Congratulations Mr. Taylor Swift!', clip: 'taylor_swift_1.gif' },
]

/** Lower-cased, punctuation dropped, whitespace collapsed. `T. Kelce` and `travis  kelce` both normalise. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The named-player entry this sale matches, or `null`.
 *
 * Accepts the full name and the first-initial form, because the sheet is typed by hand and `T Kelce` is a
 * perfectly ordinary way to type it. It does NOT match on surname alone: `Kelce` would also catch Jason,
 * and congratulating the wrong brother is worse than staying quiet.
 */
export function namedPlayerFor(player: string): NamedPlayer | null {
  const sold = normalizeName(player)
  if (sold === '') return null
  for (const entry of NAMED_PLAYERS) {
    const full = normalizeName(entry.player)
    if (sold === full) return entry
    const parts = full.split(' ')
    if (parts.length >= 2) {
      const initialForm = [parts[0]?.charAt(0), ...parts.slice(1)].join(' ')
      if (sold === initialForm) return entry
    }
  }
  return null
}

/**
 * The FLOOR under a record, not the trigger on its own.
 *
 * BIG SPENDER fires on a new highest sale, which is a better rule than a fixed threshold: it scales with
 * however the room happens to bid and it is naturally rare -- for a random ordering the number of new
 * maxima over 180 picks is about ln(180) + 0.577, roughly six times in an evening.
 *
 * A floor is still needed, because the FIRST sale of the night is always a new maximum and nobody wants a
 * celebration for a $1 flyer. $65 is the maintainer's figure; the 2025 draft put exactly three of 180
 * picks above it.
 */
export const BIG_SPENDER_OVER = 65

/**
 * A price above this is a typo, not a spend.
 *
 * `$700` for `$70` is a plausible slip and would otherwise put a celebration on the wall for a number
 * that cannot exist. The `$70`-for-$7 version is NOT closable -- nothing here can tell it from a real
 * $70 -- and is accepted.
 */
export const MAX_PLAUSIBLE_PRICE = league.budget

/**
 * More new sales than this in a single poll means something happened to the SHEET, not to the auction.
 *
 * A row inserted above the grid re-keys every slot below it; an outage that ends after several picks
 * delivers them all at once. Either way the batch is not a moment, and showing one would name an
 * arbitrary player. The batch still CONSUMES the moment, because the alternative is firing on the next
 * ordinary sale and claiming a kicker was the first when it was the third.
 *
 * 2, not 1: two players genuinely can be entered between two three-second polls.
 */
export const MOMENT_MAX_BATCH = 2

/**
 * Strictly more than this at one position and it is hoarding. Six is the first offending number.
 *
 * Was seven, lowered on the maintainer's call after seeing it: seven is rare enough that the joke would
 * mostly not land.
 *
 * In practice this is an RB/WR accusation and cannot be anything else: `positionLimits` caps QB and TE at
 * three and K at two, so those cannot reach seven without the sheet being wrong. Which is the right shape --
 * stockpiling running backs is the actual behaviour worth mocking.
 */
export const HOARDER_OVER = 5

/**
 * Stable id for the fired set. One kicker-moment ever, one per slot for big spends, one per manager for
 * a finished roster.
 */
function idOf(kind: MomentKind, sale: SaleEvent): string {
  switch (kind) {
    case 'firstKicker':
      return 'firstKicker'
    /*
     * Per SLOT, not per manager: a third kicker deserves its own mockery, and keying on the slot is also
     * what stops a retraction and re-entry of the same pick firing twice.
     */
    case 'extraKicker':
      return `extraKicker:${sale.slot}`
    case 'bigSpender':
      return `bigSpender:${sale.slot}`
    case 'rosterFull':
      return `rosterFull:${sale.manager}`
    /*
     * Per manager AND per position, so hoarding running backs and hoarding receivers are two separate
     * accusations -- and going from seven to eight does not repeat the first one.
     */
    case 'hoarder':
      return `hoarder:${sale.manager}:${sale.position ?? '?'}`
    /* Once for the night, not once per manager: the joke is being FIRST to run out. */
    case 'firstBroke':
      return 'firstBroke'
    /* Per SLOT, so a retraction and re-entry of the same player says nothing a second time. */
    case 'namedPlayer':
      return `namedPlayer:${sale.slot}`
    /* Per slot AND per tag: a pick tagged both `(h)` and `(d)` earns exactly one of each, not twice for one. */
    case 'playerTag':
      return `playerTag:${sale.slot}:${sale.tags?.[0] ?? ''}`
  }
}

/** Picks per manager. One `slots` entry IS one pick, so this is `slotsFilled` and `15 - needs`. */
function picksByManager(slots: SlotMap): Map<string, number> {
  const counts = new Map<string, number>()
  for (const slot of Object.values(slots)) {
    counts.set(slot.manager, (counts.get(slot.manager) ?? 0) + 1)
  }
  return counts
}

export interface MomentInput {
  /** The sales this poll produced. Empty is the common case. */
  sales: readonly SaleEvent[]
  /**
   * The sale log as it was BEFORE `sales` were appended.
   *
   * Trap 1. `applyDiff` appends, so a log read afterwards contains the kicker being asked about and the
   * moment never fires.
   */
  log: readonly SaleEvent[]
  /** The sheet's current slots, for the unaccounted-kicker guard. */
  slots: SlotMap
  /**
   * MAX BID per manager, as `derive.ts` computes it. Absent means the broke moment cannot fire.
   *
   * Passed in rather than worked out here, because the formula is
   * `max(minBid, remaining - (needs - 1) * minBid)` over a budget that includes bonus money -- and a second
   * copy of that in this file would drift from the number actually on the wall.
   */
  maxBids?: Readonly<Record<string, number | null>>
  /**
   * What has already fired. MUTATED BY REFERENCE, the discipline `applyDiff` and `bumpRevisions` are
   * held to -- the caller owns the set so it can survive a re-render, an ErrorBoundary recovery and `X`.
   */
  fired: Set<string>
}

/**
 * The moment this poll earned, or `null`.
 *
 * A kicker beats a big spend in the same poll -- it can only ever happen once all night -- and both are
 * consumed, so a $70 kicker does not also fire a spend on the next poll.
 */
export function detectMoments(input: MomentInput): Moment | null {
  const { sales, log, slots, fired, maxBids } = input
  if (sales.length === 0) return null

  const kicker = sales.find((sale) => sale.position === 'K') ?? null

  /*
   * Positions per manager, INCLUDING keepers, because both roster jokes below are about the roster rather
   * than about the auction: a manager who kept one kicker and then bought another has two, however they got
   * there, and the same reasoning applies to a stack of running backs.
   */
  const held = new Map<string, number>()
  const countKey = (manager: string, position: string) => `${manager}\u0000${position}`
  for (const slot of Object.values(slots)) {
    if (slot.position === null || !creditable(slot)) continue
    const key = countKey(slot.manager, slot.position)
    held.set(key, (held.get(key) ?? 0) + 1)
  }
  const heldBy = (manager: string, position: string | null) =>
    position === null ? 0 : (held.get(countKey(manager, position)) ?? 0)

  const kickersHeld = new Map<string, number>()
  for (const slot of Object.values(slots)) {
    if (slot.position === 'K' && creditable(slot)) {
      kickersHeld.set(slot.manager, (kickersHeld.get(slot.manager) ?? 0) + 1)
    }
  }
  /* A kicker sale to somebody who already had one. Two on a roster is poor strategy and fair game. */
  const doubles = sales
    .filter((sale) => sale.position === 'K' && (kickersHeld.get(sale.manager) ?? 0) >= 2)
    .map((sale) => ({ sale, count: kickersHeld.get(sale.manager) ?? 2 }))

  /* Seven or more at one position after this sale. See HOARDER_OVER. */
  const hoards = sales
    .filter((sale) => heldBy(sale.manager, sale.position) > HOARDER_OVER)
    .map((sale) => ({ sale, count: heldBy(sale.manager, sale.position) }))

  /*
   * Reduced to minimum bids: MAX BID has hit the floor, so this manager cannot outbid anybody on anything.
   * The board already calls this state `broke` (`rowState`), and the floor is why `<=` rather than `===` --
   * `maxBid` is `Math.max(minBid, ...)`, so an OVERSPENT manager sits at the same number.
   *
   * Only the buyer's MAX BID can move on a sale, so the buyer is the only candidate worth testing.
   */
  const brokeNow = sales.filter((sale) => {
    const bid = maxBids?.[sale.manager]
    return bid !== undefined && bid !== null && bid <= league.minBid
  })

  /*
   * The highest price on the board BEFORE this poll, which is what a "new highest sale" has to beat.
   *
   * Read from the sheet minus this poll's own slots, rather than from the log, so it counts KEEPERS too.
   * That is the honest reading: if the biggest price on the board is a $61 keeper, a $62 auction sale is
   * genuinely the new top of the board -- and the floor is what stops that being announced.
   */
  const thisPoll = new Set(sales.map((sale) => sale.slot))
  let record = 0
  for (const [key, held] of Object.entries(slots)) {
    if (thisPoll.has(key) || !creditable(held)) continue
    if (held.price > record) record = held.price
  }
  const beats = Math.max(record, BIG_SPENDER_OVER)

  /*
   * Who this poll finished off -- NEEDS reaching 0, which is the same thing as holding `auctionSlots`
   * picks. Read from the SHEET rather than by counting the log, so it is right even on the first poll
   * after a reload, and so a manager who was already full when this board opened has no sale to fire on.
   */
  const filled = picksByManager(slots)
  const isFull = (manager: string) => (filled.get(manager) ?? 0) >= league.auctionSlots
  const finishers = sales.filter((sale) => isFull(sale.manager))

  /*
   * When the LAST manager finishes, the draft is over and `Complete.tsx` takes the screen with the
   * awards. Congratulating one manager in front of that would bury the bigger moment, so the final
   * roster-full is left to the finale.
   *
   * Judged from the sheet: every manager who appears in it is full. That is sound here because by the
   * time anyone can be full, all twelve have nominated and therefore all twelve hold picks.
   */
  const everyoneFull = filled.size > 1 && [...filled.keys()].every(isFull)
  /*
   * A new record, and above the floor. Highest price wins, ties broken by the earlier observation so the
   * choice is deterministic when two land in one poll.
   */
  const spends = sales
    .filter((sale) => sale.price > beats && sale.price <= MAX_PLAUSIBLE_PRICE)
    .sort((a, b) => b.price - a.price || a.seq - b.seq)

  /*
   * Belt and braces on the log as well as on `fired`.
   *
   * `firedFromLog` seeds the set from a restored session, so in practice the set alone is enough. Checking
   * the log directly costs one predicate and means a lost or mis-wired seed cannot re-punt a kicker that
   * this board already announced -- which is the one failure the room would actually notice.
   */
  const kickerAlreadySold = log.some((sale) => sale.position === 'K')

  /*
   * Order is priority order. The kicker can only ever happen once all night, so it outranks everything;
   * a finished roster is the moment the room actually stops for, so it outranks a big spend.
   */
  const candidates: Moment[] = []
  /*
   * FIRST, ahead of the first-kicker punt. If a sale is both, the two-kickers joke is the better one --
   * and in practice they rarely compete, because a manager holding a keeper kicker is an unaccounted
   * kicker in the sheet, which suppresses `firstKicker` anyway.
   */
  for (const { sale, count } of doubles) {
    if (!fired.has(idOf('extraKicker', sale))) {
      candidates.push({ kind: 'extraKicker', sale, count })
    }
  }
  if (kicker && !fired.has('firstKicker') && !kickerAlreadySold) {
    candidates.push({ kind: 'firstKicker', sale: kicker })
  }
  for (const sale of finishers) {
    if (!everyoneFull && !fired.has(idOf('rosterFull', sale))) {
      candidates.push({ kind: 'rosterFull', sale })
    }
  }
  /*
   * BELOW roster full, unlike the two-kicker joke above it. If one sale both completes a roster and tips
   * somebody into hoarding, DONE is the moment the room stops for -- the stack of running backs will still
   * be on the board afterwards, and their roster being finished will not be news again.
   */
  for (const { sale, count } of hoards) {
    if (!fired.has(idOf('hoarder', sale))) candidates.push({ kind: 'hoarder', sale, count })
  }
  if (!fired.has('firstBroke')) {
    const broke = brokeNow[0]
    if (broke !== undefined) candidates.push({ kind: 'firstBroke', sale: broke })
  }
  for (const sale of sales) {
    if (namedPlayerFor(sale.player) !== null && !fired.has(idOf('namedPlayer', sale))) {
      candidates.push({ kind: 'namedPlayer', sale })
    }
    const tag = firstTagOf(sale.tags ?? [])
    if (tag !== null && !fired.has(`playerTag:${sale.slot}:${tag.tag}`)) {
      candidates.push({ kind: 'playerTag', sale, tag })
    }
  }
  for (const sale of spends) {
    if (!fired.has(idOf('bigSpender', sale))) candidates.push({ kind: 'bigSpender', sale })
  }
  if (candidates.length === 0) return null

  /* Consume everything this poll earned, whether or not it is shown. See MOMENT_MAX_BATCH. */
  const consume = () => {
    for (const moment of candidates) fired.add(idOf(moment.kind, moment.sale))
  }

  if (sales.length > MOMENT_MAX_BATCH) {
    consume()
    return null
  }

  consume()
  return candidates[0] ?? null
}

/**
 * Seed the fired set from a restored sale log.
 *
 * Deliberately NOT a field on `SessionRecord`. `looksLikeRecord` is a hand-written type assertion, so a
 * new required field either types an old record as valid and crashes on `undefined`, or joins the shape
 * check and silently discards the pointer AND the ticker on every watchdog reload -- a cost this project
 * already judged unacceptable once, which is why `migrate` exists. The restored log answers the same
 * question with no schema surface at all.
 *
 * Deliberately BROADER than the trigger for big spends: every logged sale above the floor is marked,
 * without working out which of them were records at the time. Marking one that never fired costs a
 * celebration nobody was expecting; missing one costs a repeat of a celebration the room already had.
 *
 * `rosterFull` is deliberately NOT seeded here, and cannot be: a log holds sales, not roster sizes, and a
 * restored log is a partial night. It does not need to be -- a manager who was already full when this
 * board opened produces no further sale to fire on, and the one who fills the last slot after a reload
 * genuinely has just finished. The only exposure is a manager who filled up, had a pick retracted, and
 * re-filled across a reload, which announces them twice.
 */
export function firedFromLog(log: readonly SaleEvent[]): Set<string> {
  const fired = new Set<string>()
  for (const sale of log) {
    if (sale.position === 'K') {
      fired.add('firstKicker')
      /*
       * Conservative: every kicker sale in the log has its slot marked, without working out which of them
       * were second kickers at the time. Marking one that never fired costs a joke nobody expected;
       * missing one repeats a joke the room already had.
       */
      fired.add(idOf('extraKicker', sale))
    }
    if (sale.price > BIG_SPENDER_OVER && sale.price <= MAX_PLAUSIBLE_PRICE) {
      fired.add(idOf('bigSpender', sale))
    }
  }
  return fired
}

/**
 * `?moment=kicker` / `?moment=spender`, for the layout gate. FIXTURE-ONLY, by construction.
 *
 * A pinned overlay has no timer and no key out -- that is what makes it measurable -- so a
 * `?moment=kicker` left in a bookmark would strand the projector on an undismissable gif for the
 * evening. `?view=complete` is survivable because `Esc` closes it; this is not, so it is gated on a
 * fixture being loaded, which no live board ever does.
 */
/**
 * `?clip=N`, 1-based, to preview a specific clip for a pinned moment.
 *
 * The clip a moment gets is deterministic on the player's or manager's name, which is what makes it
 * testable and unpredictable in the room -- but it also means the PINNED preview always shows the same one,
 * because the stand-in sale always names the same stand-in player. On a real draft each record-breaker and
 * each finishing manager gets their own; only the preview needed a way to cycle.
 *
 * Out-of-range values wrap rather than fail: this is a preview knob, and `?clip=9` should show something.
 */
export function pinnedClip(search: string): number | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('clip')
  if (raw === null) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function pinnedMomentKind(search: string): MomentKind | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  if (params.get('fixture') === null) return null
  switch (params.get('moment')) {
    case 'kicker':
      return 'firstKicker'
    case 'extra':
      return 'extraKicker'
    case 'spender':
      return 'bigSpender'
    case 'done':
      return 'rosterFull'
    case 'broke':
      return 'firstBroke'
    case 'hoarder':
      return 'hoarder'
    case 'named':
      return 'namedPlayer'
    case 'tag':
      return 'playerTag'
    default:
      return null
  }
}
