/**
 * What the wall shows when the real board cannot render (docs/DESIGN.md section 8.1).
 *
 * The requirement is specific: the room keeps the figures. So this is not a "something
 * went wrong" card -- it is the same numbers, drawn by the dumbest code in the project.
 *
 * Deliberately primitive. No hooks, no measurement, no ResizeObserver, no column fit
 * test, no scale nudging, no derived state beyond reading fields off `LeagueState`. It
 * is the fallback for a render that already failed once, so every mechanism it skips is
 * one that cannot fail it a second time.
 */

import { money } from './columns'
import type { LeagueState } from '../model/derive'

export interface FrozenBoardProps {
  /** The last board that rendered successfully. `null` if there never was one. */
  state: LeagueState | null
  year: number
  /** The store's feed label, so staleness is still honest here. */
  feedLabel: string
}

export function FrozenBoard({ state, year, feedLabel }: FrozenBoardProps) {
  return (
    <div className="frozen">
      <div className="frozen-banner">
        DISPLAY ERROR · ZWML {year} · FIGURES BELOW ARE THE LAST GOOD READING · {feedLabel}
      </div>

      {state === null ? (
        <div className="frozen-empty">NO FIGURES YET — RELOAD THE PAGE</div>
      ) : (
        <table className="frozen-table">
          <thead>
            <tr>
              <th>MANAGER</th>
              <th>SPENT</th>
              <th>LEFT</th>
              <th>NEEDS</th>
              <th>MAX BID</th>
            </tr>
          </thead>
          <tbody>
            {state.managers.map((manager) => (
              <tr key={manager.name}>
                <td>{manager.name}</td>
                <td>{money(manager.spent)}</td>
                <td>{money(manager.remaining)}</td>
                <td>{manager.needs}</td>
                <td>{manager.maxBid === null ? 'FULL' : money(manager.maxBid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
