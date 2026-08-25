/**
 * The screen before -- or instead of -- a board (docs/DESIGN.md section 8).
 *
 * There is no state in which this app shows an empty screen. Either the board is up,
 * or this says what is happening in letters readable from across the room, with the fix
 * underneath it. The person who needs to read it is standing by a projector, not
 * sitting at a keyboard with devtools open.
 */

import type { ReactNode } from 'react'
import type { BoardProblem } from '../live/boardStore'

export interface StandbyProps {
  year: number
  /** `null` while the first fetch is simply in flight. */
  problem: BoardProblem | null
  feedLabel: string
  /**
   * The notices strip, same element the board gets. There is nothing to cover on this
   * screen, so it is allowed to wrap and be read in full (`.standby .notices`) -- and
   * this is the screen where a warning about a fumbled setting is most likely to be the
   * only clue to why there is no board.
   */
  notices?: ReactNode
}

export function Standby({ year, problem, feedLabel, notices = null }: StandbyProps) {
  return (
    <div className="standby" data-problem={problem?.kind ?? 'none'}>
      <h1>ZWML {year} AUCTION</h1>
      {problem === null ? (
        <>
          <p className="standby-message">Reading the sheet…</p>
          {/*
           * The feed label, even here. "Reading the sheet" on its own is indistinguishable
           * from a hang after about ten seconds; with `OFFLINE · 2m` under it the room
           * knows whether to wait or to go and find the maintainer.
           */}
          <p className="standby-action">{feedLabel}</p>
        </>
      ) : (
        <>
          <p className="standby-message">{problem.message}</p>
          <p className="standby-action">{problem.action}</p>
        </>
      )}
      {notices}
    </div>
  )
}
