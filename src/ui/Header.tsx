/**
 * League totals strip (docs/DESIGN.md sections 6, 7.2).
 *
 * One line, always on screen. `$/SLOT` here is the market pace -- dollars that can
 * still chase players over slots still to fill -- and it is `null` once every
 * roster is full. It renders as an em dash then, never as a number: section 6's
 * unguarded form put `$Infinity` on the wall at the loudest moment of the night.
 */

import type { ReactNode } from 'react'
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
  /**
   * Touch controls, as a slot. Hidden by CSS on anything with a keyboard.
   *
   * The header rather than the footer, and that is not arbitrary: `.footer:empty` is what keeps
   * the footer's ~35px off the twelve-row budget, so a child rendered there unconditionally --
   * even one set to `display: none` -- would make the footer non-empty and cost the projector its
   * measured 1.15 scale ceiling (7.1).
   */
  action?: ReactNode
  /**
   * The `?` beside the title. Desktop only, by CSS.
   *
   * The keyboard reference was advertised on the standby screen, which is shown for a couple of
   * seconds at startup and is therefore easy to miss entirely -- and then the eight bound keys are
   * undiscoverable for the rest of the night. A permanent mark next to the title is the cheapest
   * fix that does not touch the row budget (`.footer:empty`, see 7.1).
   *
   * Absent on a phone, where the touch controls already carry a `?`.
   */
  help?: ReactNode
}

export function Header({
  year,
  league,
  feed = 'live',
  feedLabel = 'LIVE',
  action = null,
  help = null,
}: HeaderProps) {
  return (
    <header className="header">
      {/* One flex item, so the `?` travels with the title rather than being spaced away from it. */}
      <div className="title">
        {/*
          * The word AUCTION is spendable, and below 1600px it is spent.
          *
          * The header is a single nowrap strip sized from `vw`, and at 1024x768 it sits within
          * ~10px of its limit -- so the two title controls did not fit and the h1 absorbed the
          * overflow into "ZWML 202...", which is 7.1's silent truncation. `ZWML 2026` says
          * everything the room needs; a hidden control does not. Rendered and hidden by CSS rather
          * than branched in JS so there is no width to measure and no frame where it is wrong.
          */}
        <h1>
          ZWML {year}
          <span className="title-word"> AUCTION</span>
        </h1>
        {help}
      </div>
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
          {action}
</header>
  )
}
