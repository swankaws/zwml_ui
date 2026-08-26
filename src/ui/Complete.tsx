/**
 * The finale. Every roster is full, so the board's job is done.
 *
 * A full-screen takeover, which is the one moment in the night it is the right answer: there is no
 * bidding left to interrupt, no MAX BID anyone needs, and nothing to obscure. Every other overlay in
 * this app is either in the flow (`Notices`) or explicitly summoned (`Help`) precisely because the
 * board underneath is load-bearing — here it is not.
 *
 * Shown on the TRANSITION to complete, never merely because a finished board was loaded. Reopening the
 * tab the next morning should show a board, not re-run the party; and it means every `?fixture=2025`
 * layout case still measures a board rather than this. `?view=complete` is how the harness reaches it.
 *
 * The awards are derived (`model/awards.ts`), so this screen is different every year and cannot go
 * stale — and every one of them is optional, so a draft that does not support an award simply does not
 * show it rather than inventing a winner.
 */

import { money } from './columns'
import { awards } from '../model/awards'
import type { LeagueState } from '../model/derive'
import type { SaleEvent } from '../model/diff'

export interface CompleteProps {
  year: number
  state: LeagueState
  /**
   * The night's sale log, for the one award that needs chronology.
   *
   * LOOOO-SER is "whoever paid the most for their LAST pick", and the sheet records no pick order at
   * all -- so the log is the only place that answer exists (7.3).
   */
  sales?: readonly SaleEvent[]
}

export function Complete({ year, state, sales = [] }: CompleteProps) {
  const won = awards(state, sales)
  const spent = state.leagueSpent

  return (
    <div className="complete">
      <div className="complete-card">
        <p className="complete-kicker">ZWML {year} · ALL ROSTERS FULL</p>
        {/*
         * The line the maintainer asked for. Kept as the loudest thing on screen, because at this
         * point in the evening that is the entire point of the screen.
         */}
        <h1 className="complete-headline">
          THE DRAFT IS OVER,
          <br />
          RIGHT MEOW
        </h1>

        <p className="complete-total">
          {state.slotsFilled} players · {money(spent)} spent
          {state.leagueBonus !== 0 && <> · {money(state.leagueBonus)} of it bonus money</>}
        </p>

        {won.length > 0 && (
          <dl className="complete-awards">
            {won.map((award) => (
              <div className="complete-award" key={award.key}>
                <dt>{award.title}</dt>
                <dd>
                  <span className="complete-winner">{award.manager}</span>
                  <span className="complete-detail">{award.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* The way out, said plainly: a wall with no way back to the board is a broken wall. */}
        <p className="complete-exit">
          <kbd>R</kbd> rosters · <kbd>H</kbd> every sale · <kbd>Esc</kbd> back to the board
        </p>
      </div>
    </div>
  )
}
