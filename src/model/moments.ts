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
 *   2. A board opened LATE, or reopened in a fresh tab, starts with an empty log and absorbs the
 *      kicker that already sold into its baseline -- so the SECOND kicker of the night would read as
 *      the first. Closed by `everyKickerWatched`.
 *   3. A row inserted into the sheet re-keys every slot below it and reads as dozens of new sales, one
 *      of which will be a kicker. Closed by `MOMENT_MAX_BATCH`, the same reasoning `revisions.ts`
 *      already applies to the value flash.
 *   4. Firing twice for one sale. Closed by `fired`, which the caller owns and which deliberately
 *      survives `X` -- see `boardStore`.
 */

import { league } from '../config/league'
import { creditable, type SaleEvent, type SlotMap } from './diff'

export type MomentKind = 'firstKicker' | 'bigSpender'

export interface Moment {
  kind: MomentKind
  /** The sale that earned it. The overlay names the player, the manager and the price. */
  sale: SaleEvent
}

/**
 * Strictly over this. `$65` does not fire; `$66` does.
 *
 * The maintainer's figure. Checked against the 2025 draft: exactly three of 180 picks cleared it
 * (Justin Jefferson $72, Bijan Robinson $69, Saquon Barkley $66), which is a moment three times in an
 * evening rather than a running gag.
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

/** Stable id for the fired set. One per kicker-moment ever; one per slot for big spends. */
function idOf(kind: MomentKind, sale: SaleEvent): string {
  return kind === 'firstKicker' ? 'firstKicker' : `bigSpender:${sale.slot}`
}

/**
 * Every creditable kicker the sheet currently holds has a sale we watched.
 *
 * The guard for trap 2. If the sheet shows two kickers and we only ever saw one sold, the one we saw is
 * not the first -- somebody's kicker was already there when this tab opened, whether as a keeper or from
 * a session this tab never had. It fails in the safe direction by construction: an unaccounted kicker
 * suppresses the moment rather than guessing.
 */
function everyKickerWatched(
  slots: SlotMap,
  log: readonly SaleEvent[],
  sales: readonly SaleEvent[],
): boolean {
  const watched = new Set([...log, ...sales].map((sale) => sale.slot))
  for (const [key, slot] of Object.entries(slots)) {
    // `creditable` is diff.ts's own predicate: exactly the slots it would emit a sale for.
    if (slot.position === 'K' && creditable(slot) && !watched.has(key)) return false
  }
  return true
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
  const { sales, log, slots, fired } = input
  if (sales.length === 0) return null

  const kicker = sales.find((sale) => sale.position === 'K') ?? null
  /* Highest price wins, ties broken by the earlier observation so the choice is deterministic. */
  const spends = sales
    .filter((sale) => sale.price > BIG_SPENDER_OVER && sale.price <= MAX_PLAUSIBLE_PRICE)
    .sort((a, b) => b.price - a.price || a.seq - b.seq)

  /*
   * Belt and braces on the log as well as on `fired`.
   *
   * `firedFromLog` seeds the set from a restored session, so in practice the set alone is enough. Checking
   * the log directly costs one predicate and means a lost or mis-wired seed cannot re-punt a kicker that
   * this board already announced -- which is the one failure the room would actually notice.
   */
  const kickerAlreadySold = log.some((sale) => sale.position === 'K')

  const candidates: Moment[] = []
  if (kicker && !fired.has('firstKicker') && !kickerAlreadySold) {
    candidates.push({ kind: 'firstKicker', sale: kicker })
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

  const kickerMoment = candidates.find((moment) => moment.kind === 'firstKicker')
  if (kickerMoment && !everyKickerWatched(slots, log, sales)) {
    /*
     * Suppressed AND consumed. Consuming matters: without it the next kicker to sell would be announced
     * as the first, which is the same wrong claim one poll later.
     */
    consume()
    const spend = candidates.find((moment) => moment.kind === 'bigSpender')
    return spend ?? null
  }

  consume()
  return kickerMoment ?? candidates[0] ?? null
}

/**
 * Seed the fired set from a restored sale log.
 *
 * Deliberately NOT a field on `SessionRecord`. `looksLikeRecord` is a hand-written type assertion, so a
 * new required field either types an old record as valid and crashes on `undefined`, or joins the shape
 * check and silently discards the pointer AND the ticker on every watchdog reload -- a cost this project
 * already judged unacceptable once, which is why `migrate` exists. The restored log answers the same
 * question with no schema surface at all.
 */
export function firedFromLog(log: readonly SaleEvent[]): Set<string> {
  const fired = new Set<string>()
  for (const sale of log) {
    if (sale.position === 'K') fired.add('firstKicker')
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
export function pinnedMomentKind(search: string): MomentKind | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  if (params.get('fixture') === null) return null
  switch (params.get('moment')) {
    case 'kicker':
      return 'firstKicker'
    case 'spender':
      return 'bigSpender'
    default:
      return null
  }
}
