/**
 * Which managers' figures just changed (docs/DESIGN.md 7.7, and §4's "flashing values that moved").
 *
 * A per-manager counter that increments only when that manager's numbers actually move. The UI keys
 * the row on it, so a bump remounts the row and restarts a CSS animation — which is the only reliable
 * way to re-fire one, since an animation does not restart on an attribute change.
 *
 * WHY A COUNTER AND NOT A BOOLEAN, OR THE SNAPSHOT ITSELF. Three tempting signals are all wrong here:
 *
 *   - A `changed` boolean never re-fires. Two sales for the same manager in a row leave it `true`
 *     throughout, so the second one does not flash.
 *   - The snapshot reference changes on the AGE TICK. The store re-publishes once a second so a
 *     climbing `STALE · 47s` stays honest, so anything keyed on the snapshot flashes the whole board
 *     every second for as long as the feed is unwell — which is exactly the "motion that pulls the eye
 *     during bidding" that 7.7 bans, arriving at the worst possible moment.
 *   - A poll counter has the same defect, one flash per poll forever.
 *
 * WHAT COUNTS AS A CHANGE. `spent`, `bonus` and `slotsFilled` — the three INPUTS. Everything else on a
 * manager (`remaining`, `needs`, `maxBid`, `pctRemaining`, the position counts) is derived from them,
 * so watching the inputs catches every real movement without double-counting: a sale moves all five
 * derived figures at once and should be one flash, not five.
 */

import type { LeagueState, ManagerState } from './derive'

/** Manager name to revision. Starts empty; a manager's first appearance does not count as a change. */
export type Revisions = Readonly<Record<string, number>>

export const NO_REVISIONS: Revisions = {}

/**
 * Above this share of the board changing at once, nobody flashes.
 *
 * A batch — the first good poll after a network outage, or a restored session reconciling — can move
 * eight managers in one frame, and eight rows lighting up together is a strobe rather than a signal.
 * 7.7's rule is that motion must be purposeful; motion that says "most of the board" says nothing.
 */
const STROBE_FRACTION = 0.5

function inputsOf(manager: ManagerState): string {
  return `${manager.spent}|${manager.bonus}|${manager.slotsFilled}`
}

/**
 * Bump the managers whose inputs moved between two derived states.
 *
 * Returns `previous` UNCHANGED, by reference, when nothing moved. That matters beyond tidiness: this
 * goes into the board snapshot, and `boardStore.equivalent` compares it by reference to decide whether
 * to notify — a fresh object every poll would re-render the board once a second forever.
 *
 * `before === null` is the first parse of a session, including after a reload. Nothing flashes then:
 * the room is looking at a board that has just appeared, and every figure on it is new.
 */
export function bumpRevisions(
  previous: Revisions,
  before: LeagueState | null,
  after: LeagueState,
): Revisions {
  if (before === null) return previous

  const was = new Map(before.managers.map((m) => [m.name, inputsOf(m)]))
  const moved = after.managers.filter((m) => {
    const prior = was.get(m.name)
    // A manager who was not on the previous board is an arrival, not a change -- a blank name cell
    // recovering, or a roster edit. Flashing them would announce something that did not happen.
    return prior !== undefined && prior !== inputsOf(m)
  })

  if (moved.length === 0) return previous
  if (after.managers.length > 0 && moved.length > after.managers.length * STROBE_FRACTION) {
    return previous
  }

  const next: Record<string, number> = { ...previous }
  for (const manager of moved) next[manager.name] = (next[manager.name] ?? 0) + 1
  return next
}
