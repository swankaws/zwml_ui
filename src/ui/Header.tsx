/**
 * League totals strip (docs/DESIGN.md sections 6, 7.2).
 *
 * One line, always on screen. `$/SLOT` here is the market pace -- dollars that can
 * still chase players over slots still to fill -- and it is `null` once every
 * roster is full. It renders as an em dash then, never as a number: section 6's
 * unguarded form put `$Infinity` on the wall at the loudest moment of the night.
 */

import { money } from './columns'
import type { LeagueState } from '../model/derive'
import type { FeedState } from '../data/sheetClient'

/*
 * Re-exported, not re-declared. It was declared here in phase 3 and again in the
 * client in phase 4, and two identical string unions are worse than one shared type:
 * they typecheck against each other until someone adds a fourth state to one of them,
 * at which point the compiler reports the error in the wrong file. The data layer
 * decides what feed health is; this file only draws it.
 */
export type { FeedState }

export interface HeaderProps {
  year: number
  league: LeagueState
  /** Feed health. Phase 4 drives this; phase 3 pins it to `live`. */
  feed?: FeedState
  feedLabel?: string
}

export function Header({ year, league, feed = 'live', feedLabel = 'LIVE' }: HeaderProps) {
  return (
    <header className="header">
      <h1>ZWML {year} AUCTION</h1>
      <div className="totals">
        <span>
          SPENT <b>{money(league.leagueSpent)}</b>
        </span>
        <span>
          CHASING <b>{money(league.leagueRemaining)}</b>
        </span>
        <span>
          SLOTS{' '}
          <b>
            {league.slotsFilled}/{league.totalSlots}
          </b>
        </span>
        <span>
          $/SLOT{' '}
          <b>
            {league.avgPerRemainingSlot === null
              ? '—'
              : money(Math.floor(league.avgPerRemainingSlot))}
          </b>
        </span>
        <span className="status" data-state={feed}>
          <span className="dot" />
          {feedLabel}
        </span>
      </div>
    </header>
  )
}
