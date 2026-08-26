/**
 * The roster view: every manager's squad at once (docs/DESIGN.md 7.4).
 *
 * The second full-screen view, for when the room's question stops being "who has money"
 * and becomes "who still needs a tight end". The auction board answers the first and
 * cannot answer the second: it shows counts per position, not who is actually on a roster.
 *
 * WHY SIX ACROSS AND TWO BANDS, which is neither of the obvious arrangements:
 *
 *   12 across x 1 band   160px per column at 1080p. To fit even `S. Barkley` the type has
 *                        to come down to ~0.62em, and every name is abbreviated. Twelve
 *                        narrow columns also read as a wall of text rather than as blocks.
 *   4 across x 3 bands   the auction tab's own grammar, and 480px of width nobody needs --
 *                        but 48 rows of content in a ~20.5em budget forces ~0.36em type,
 *                        about 17px at 1080p. Too small to read across a room, which is the
 *                        entire point of this product.
 *   6 across x 2 bands   320px per column and 34 rows, which the vertical budget holds at
 *                        0.6em -- roughly 28px at 1080p. Most names fit whole, and the ones
 *                        that do not degrade gracefully (see `playerName.ts`).
 *
 * Six across is also the shape the maintainer reached for independently: the workbook
 * contains an `auction-display` tab laying twelve managers out as six summary cards across
 * two bands. Matching it is not imitation for its own sake -- it means the room is looking
 * at an arrangement it has already learned to read.
 *
 * The vertical budget is resolution-INVARIANT, which is what makes one arrangement work
 * across the matrix: both the budget and the type derive from viewport height
 * (`--type: clamp(13px, 4.35vh, 64px)`), so the content row is ~20.5em at 1080p, 1024x768,
 * 1280x1024 and 1440x900 alike. Only WIDTH changes between them, so only the name budget
 * has to move.
 */

import { useEffect, useRef, useState } from 'react'
import { league, type Position } from '../config/league'
import { money } from './columns'
import { fitPlayerName } from './playerName'
import type { ManagerState } from '../model/derive'
import type { Pick } from '../data/gridParser'

export interface RosterProps {
  managers: ManagerState[]
  /**
   * Fallback character budget for the first frame, before the real one is measured.
   *
   * Generous on purpose: too high shows a full name for one frame, too low shows initials.
   */
  nameChars?: number
}

/**
 * How many characters a player name may occupy, MEASURED from the rendered cell.
 *
 * The first version of this computed the budget arithmetically from the root font size and a
 * guessed chrome allowance, and it was wrong by about 2x: it charged 6.2em of chrome where
 * the cell actually spends 4.57em, and it sized glyphs off `0.6 x root` when the view's type
 * is `min(0.6em, 2.35vh)` -- smaller at every resolution in the matrix. The result was an
 * 8-character budget at 1080p and 4 at 1024x768, i.e. all 180 names rendered as bare
 * initials (`J D`) on three of the five screens.
 *
 * Worse, it was INVISIBLE. The abbreviation ladder absorbed the whole overflow, so
 * `.roster-player` never ellipsised, no probe fired, and the layout gate printed
 * `ok ... slack=0px` on every one of them -- exactly the failure 7.1 already records for the
 * header title. Measuring the cell cannot drift from the CSS the way a duplicated formula
 * can, which is why this reads the DOM instead.
 */
function useNameBudget(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [chars, setChars] = useState(fallback)

  useEffect(() => {
    const grid = ref.current
    if (!grid) return

    const measure = () => {
      const cell = grid.querySelector('.roster-player')
      if (!cell) return
      const style = getComputedStyle(cell)
      const fontPx = Number.parseFloat(style.fontSize)
      const width = (cell as HTMLElement).clientWidth
      if (!Number.isFinite(fontPx) || fontPx <= 0 || width <= 0) return
      /*
       * 0.6, calibrated against the harness rather than assumed. 0.55 is closer to the true
       * average for this sans stack, and it was optimistic often enough that CSS was still
       * ellipsising real names at three resolutions -- the ratio has to cover the WIDEST
       * plausible name, not the average one, because a single clipped name is a visible
       * defect while a name abbreviated one character early is not.
       */
      setChars(Math.max(3, Math.floor(width / (fontPx * 0.6)) - 1))
    }
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  return [ref, chars]
}

/**
 * Position order for grouping, with unlabeled picks last.
 *
 * An unlabeled bench row is normal, not an error (5.4): the sheet's bench rows carry no
 * `Pos` cell, so a player parked there has a real name and price and no position. They go
 * at the end under a neutral marker rather than being hidden or guessed at.
 */
const GROUPS: readonly (Position | null)[] = [...league.positions, null]

function groupPicks(picks: readonly Pick[]): { position: Position | null; picks: Pick[] }[] {
  return GROUPS.map((position) => ({
    position,
    picks: picks.filter((pick) => pick.position === position),
  })).filter((group) => group.picks.length > 0)
}

export function Roster({ managers, nameChars = 18 }: RosterProps) {
  const [gridRef, chars] = useNameBudget(nameChars)
  return (
    <div className="roster" ref={gridRef}>
      {managers.map((manager) => (
        <RosterBlock key={manager.name} manager={manager} nameChars={chars} />
      ))}
    </div>
  )
}

function RosterBlock({ manager, nameChars }: { manager: ManagerState; nameChars: number }) {
  const groups = groupPicks(manager.picks)
  /*
   * Placeholder rows for slots still to fill, per 7.4. They keep every block the same
   * height -- which is what lets twelve of them sit in a grid without the bands drifting --
   * and they are the answer to "how many does he still need" without arithmetic.
   */
  const empty = Math.max(0, league.auctionSlots - manager.slotsFilled)

  return (
    <section className="roster-block" data-full={manager.maxBid === null}>
      <header className="roster-head">
        <span className="roster-name">{manager.name}</span>
        {/*
         * Spent and left, because "similar to the 2026 Auction page" is what was asked for
         * and those are the two figures each block on that page carries. MAX BID is
         * deliberately NOT repeated here: it is the auction board's headline number, and a
         * second copy that lags a poll behind would be worse than no copy.
         */}
        {/* Spelled out here, where there is room, rather than as a badge. */}
        {manager.bonus !== 0 && (
          <span className="roster-bonus">
            {manager.bonus > 0 ? `+${money(manager.bonus)}` : money(manager.bonus)}
          </span>
        )}
        <span className="roster-spent">{money(manager.spent)}</span>
        <span className="roster-left" data-over={manager.overspent}>
          {money(manager.remaining)}
        </span>
      </header>

      <div className="roster-slots">
        {groups.map((group) => (
          <div className="roster-group" key={group.position ?? 'none'}>
            {group.picks.map((pick) => (
              <div className="roster-slot" key={`${pick.row}-${pick.player}`}>
                <span className="roster-pos" data-position={group.position ?? 'none'}>
                  {group.position ?? '·'}
                </span>
                <span className="roster-player" title={pick.player}>
                  {fitPlayerName(pick.player, nameChars)}
                </span>
                <span className="roster-price" data-suspect={pick.priceSuspect}>
                  {money(pick.price)}
                </span>
              </div>
            ))}
          </div>
        ))}

        {empty > 0 && (
          <div className="roster-group roster-open">
            {Array.from({ length: empty }, (_unused, index) => (
              <div className="roster-slot roster-empty" key={index}>
                <span className="roster-pos" data-position="none">
                  ·
                </span>
                <span className="roster-player">—</span>
                <span className="roster-price" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
