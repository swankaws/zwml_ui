/**
 * Warnings and data problems, on the wall (docs/DESIGN.md sections 5.5, 6, 8).
 *
 * Sections 5.5 and 6 promise that an unmatched or duplicated manager name is *visible*
 * rather than dropped, and until now that promise was not kept: both reached the
 * console and nobody reads a console during an auction. `LeagueState.unmatched` carried
 * a comment saying exactly that. This is the fix.
 *
 * One rule shapes it, and it is not aesthetic: a notice may not cost the room a manager.
 * The first draft was a fixed overlay in the bottom-right corner, on the argument that
 * with the rail on that corner is reliably blank. The layout gate disproved it -- four
 * warnings stack 239px tall against a 78px row, and `noticesCover` caught the strip
 * painting over four managers' MAX BID and position counts at three resolutions. So this
 * is a single in-flow line at the foot of the shell instead. In the flow it can push, and
 * pushing is measurable and bounded; as an overlay it could only cover, and no corner is
 * blank in every configuration this thing has to run in.
 *
 * It costs the rows nothing when there is nothing to say -- returning `null` leaves no
 * grid item, so the footer row collapses (`.footer:empty` in theme.css).
 *
 * Capped at two, because the budget is now horizontal. Late in a broken draft there could
 * be dozens; two messages and a count is what fits on one line at 1024px, and the console
 * has all of them -- which the entry point makes true by logging the full list on change.
 */

import type { BoardProblem } from '../live/boardStore'

export interface NoticesProps {
  /** Actionable and blocking. Shown first, message and fix together. */
  problem: BoardProblem | null
  warnings: readonly string[]
  /** Name cells matching no configured manager (5.5). */
  unmatched?: readonly string[]
  /** Names appearing in more than one block -- each one costs a roster row (6). */
  duplicated?: readonly string[]
}

const VISIBLE = 2

export function Notices({ problem, warnings, unmatched = [], duplicated = [] }: NoticesProps) {
  /*
   * Data problems first. A warning about a fumbled `?scale=` is cosmetic; a manager
   * whose name did not match is a row of wrong numbers, or a missing row -- which is
   * the thing someone in the room can actually see and query.
   */
  const lines = [
    ...unmatched.map((name) => `Unrecognized manager "${name}" — not in this season's roster.`),
    ...duplicated.map((name) => `"${name}" appears in two blocks — one roster is being lost.`),
    ...warnings,
  ]

  if (problem === null && lines.length === 0) return null

  const shown = lines.slice(0, VISIBLE)
  const hidden = lines.length - shown.length

  return (
    <aside className="notices" data-severity={problem ? 'problem' : 'warning'}>
      {problem && (
        <span className="notice-problem">
          <b>{problem.message}</b> {problem.action}
        </span>
      )}
      {shown.map((line) => (
        <span className="notice" key={line}>
          {line}
        </span>
      ))}
      {/*
       * Last, and the one item that never shrinks (`.notice-more` in theme.css). The
       * messages ahead of it ellipsise when the line runs out; if the count did too, a
       * board with fifteen problems would look like a board with two.
       */}
      {hidden > 0 && <span className="notice notice-more">+{hidden} more (see the console)</span>}
    </aside>
  )
}
