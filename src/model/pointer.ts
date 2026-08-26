/**
 * Whose turn it is to nominate (docs/DESIGN.md 7.5).
 *
 * The league's rules make this derivable rather than guessable: the order is fixed for
 * the season, nominations rotate strictly through it, every nomination ends in a sale, and
 * a manager at fifteen picks drops out of the rotation. So the pointer is a pure function
 * of `(order, baseline, saleLog)` and needs no operator input in the normal case.
 *
 * WHY THIS REPLAYS RATHER THAN COUNTS. Both cheaper formulas are wrong, and phase 3 proved
 * it by writing them and deleting them (the note at the foot of `ui/nominations.ts`):
 *
 *   - `saleCount % order.length` diverges the moment anyone's roster fills, because a full
 *     manager is skipped without consuming a nomination.
 *   - Replaying against *current* fullness over-advances, because a manager who is full now
 *     was not full on their earlier turns, so the replay skips turns that really happened.
 *
 * Fullness has to be evaluated as it was at each nomination, which is exactly what a
 * chronological sale log gives us. Hence: start from the roster state at auction open and
 * walk forward one sale at a time.
 */

import { league } from '../config/league'
import type { SaleEvent } from './diff'

/**
 * Everything needed to derive the pointer EXCEPT the order.
 *
 * Split out because the order is decided later than the sale log is. `App` renders
 * `settings.order ?? order` (7.5's four sources), so the SETTINGS tab and `?order=` can
 * both replace the list the store parsed -- and the pointer is an *index into that list*.
 * Deriving it in the store against the store's own order would index a different array
 * than the one on the wall, which is the wrong name under ON THE CLOCK at the most-watched
 * moment of the night. So the store publishes this basis and the pointer is derived beside
 * the order actually being rendered.
 */
export interface PointerBasis {
  baselineCounts: Readonly<Record<string, number>>
  log: readonly SaleEvent[]
  offset: number
}

export interface PointerInput {
  /** The nomination order. Empty means it was never configured -- the pointer is unknown. */
  order: readonly string[]
  /**
   * Picks each manager already held at the baseline, by display name.
   *
   * Keepers, in the normal case. 7.5: the pointer "must start from the roster state at
   * auction start, not from zero picks", because keepers are entered in the days before
   * the draft and a manager whose keepers already fill their roster never nominates at all.
   */
  baselineCounts: Readonly<Record<string, number>>
  /** Chronological, oldest first. */
  log: readonly SaleEvent[]
  /**
   * The operator's running correction, in eligible positions. Positive is forward.
   *
   * 7.5: "`N` advances, `Shift+N` retreats. The manual offset persists alongside the
   * pointer." Persisting is the whole point -- a one-shot nudge would be undone by the very
   * next sale, so the operator would have to re-correct after every player, all night. As
   * an offset, one keystroke fixes the rotation for good.
   */
  offset?: number
}

/**
 * Index into `order`, or `null` for "nobody knows".
 *
 * `null` is a real answer and not a failure: with no order configured, or with every roster
 * full, naming someone would be a guess. `ui/nominations.ts` renders `null` as the plain
 * order with nobody highlighted, which is what the room read off the wall for years.
 */
export function derivePointer(input: PointerInput): number | null {
  const { order, baselineCounts, log, offset = 0 } = input
  if (order.length === 0) return null

  const counts = new Map<string, number>(Object.entries(baselineCounts))
  const slots = league.auctionSlots
  const isFull = (name: string) => (counts.get(name) ?? 0) >= slots

  /*
   * Where the rotation starts. `order[0]` unless their keepers already filled them, in
   * which case they were never in it.
   */
  let index = firstEligible(order, 0, isFull)
  if (index === null) return null

  for (const sale of [...log].sort((a, b) => a.seq - b.seq)) {
    /*
     * Credit the buyer BEFORE advancing, and note that the buyer is usually NOT the
     * nominator -- anyone may outbid the person who nominated. What matters here is only
     * that this sale may have just filled someone's roster, and if it filled the next
     * manager's, the rotation has to step over them.
     */
    counts.set(sale.manager, (counts.get(sale.manager) ?? 0) + 1)
    const next = firstEligible(order, index + 1, isFull)
    if (next === null) return null // Every roster full: the auction is over.
    index = next
  }

  return applyOffset(order, index, offset, isFull)
}

/** Roster sizes at the baseline, from the same slot map the diff engine baselines on. */
export function countsFromSlots(slots: Readonly<Record<string, { manager: string }>>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of Object.values(slots)) {
    counts[slot.manager] = (counts[slot.manager] ?? 0) + 1
  }
  return counts
}

/**
 * First manager at or after `from` who can still nominate, wrapping once.
 *
 * One lap only: when nobody is eligible the auction is over, and an unbounded scan for a
 * nominator who does not exist spins forever -- on the machine driving the projector, with
 * nobody sitting at it.
 */
function firstEligible(
  order: readonly string[],
  from: number,
  isFull: (name: string) => boolean,
): number | null {
  for (let step = 0; step < order.length; step += 1) {
    const index = wrap(from + step, order.length)
    const name = order[index]
    if (name !== undefined && !isFull(name)) return index
  }
  return null
}

/**
 * Walk `offset` eligible positions from `index`.
 *
 * Counted in *eligible* positions rather than raw ones, so one press of `N` always lands
 * on somebody who can actually nominate. Raw stepping would put a struck-through name on
 * the clock late in the draft, when most of the field is full -- which is precisely when
 * the operator is reaching for the key.
 */
function applyOffset(
  order: readonly string[],
  index: number,
  offset: number,
  isFull: (name: string) => boolean,
): number {
  const step = offset < 0 ? -1 : 1
  let current = index
  for (let n = 0; n < Math.abs(offset); n += 1) {
    let moved = false
    for (let probe = 1; probe <= order.length; probe += 1) {
      const candidate = wrap(current + step * probe, order.length)
      const name = order[candidate]
      if (name !== undefined && !isFull(name)) {
        current = candidate
        moved = true
        break
      }
    }
    // Only one eligible nominator left: nudging is a no-op rather than a wrap onto
    // themselves, which would look like the key did nothing anyway.
    if (!moved) break
  }
  return current
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length
}
