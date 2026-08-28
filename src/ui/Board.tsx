/**
 * The manager table (docs/DESIGN.md section 7.2).
 *
 * A table, not cards: twelve managers sharing a baseline down each column is what
 * makes them comparable at a glance. One table of 12, not two of 6 -- splitting
 * would double the row height, but two sets of column baselines destroys the
 * at-a-glance comparison that is the entire point.
 */

import { useEffect, useState } from 'react'
import { POSITION_COLUMNS, atPositionLimit, cellValue, pressureLevel, type Column } from './columns'
import type { ManagerState } from '../model/derive'
import { league } from '../config/league'

export interface BoardProps {
  managers: ManagerState[]
  columns: Column[]
  /**
   * Per-manager change counters (`model/revisions.ts`). Used as part of the row `key`, which is what
   * restarts the flash animation: a CSS animation does not re-fire on an attribute change, so the row
   * has to be a new element. Absent on the fixture path, where nothing changes.
   */
  revisions?: Readonly<Record<string, number>>
  /**
   * Manager -> team name, for the tooltip. Empty is the ordinary case and means no tooltip anywhere.
   *
   * A convenience for whoever is running the draft, who knows the teams and is learning the names.
   */
  teams?: Readonly<Record<string, string>>
}

/** How long a tapped tooltip stays up. Long enough to read a team name, short enough to forget about. */
const TIP_MS = 4_000

/** Which visual state a row is in. Meaning only -- never decoration. */
function rowState(m: ManagerState, topMaxBid: number | null): string {
  if (m.maxBid === null) return 'full'
  if (m.maxBid <= league.minBid) return 'broke'
  if (topMaxBid !== null && m.maxBid === topMaxBid) return 'leader'
  return 'normal'
}

/**
 * The top max bid, or `null` when too many managers share it to be worth marking.
 *
 * At the open every roster is empty and all twelve tie at $186, so highlighting the
 * maximum lights up the whole board -- and a highlight on the majority tells the
 * room nothing. It earns its colour once the field has actually separated.
 */
function distinguishingTopBid(managers: ManagerState[]): number | null {
  const bids = managers.map((m) => m.maxBid).filter((b): b is number => b !== null)
  if (bids.length === 0) return null
  const top = Math.max(...bids)
  const tied = bids.filter((b) => b === top).length
  return tied > managers.length / 2 ? null : top
}

export function Board({ managers, columns, revisions = {}, teams = {} }: BoardProps) {
  const template = columns.map((c) => `minmax(0, ${c.width}fr)`).join(' ')
  const topMaxBid = distinguishingTopBid(managers)

  /*
   * The tapped tooltip, for a phone -- `title` covers hover and does nothing on touch.
   *
   * `position: fixed` and coordinates taken from the tapped cell, because `.rows` is `overflow: hidden`
   * and an absolutely-positioned bubble inside a row would be clipped away. Nothing in this stylesheet
   * uses `transform`, so fixed really is viewport-relative here.
   */
  const [tip, setTip] = useState<{ team: string; x: number; y: number } | null>(null)

  useEffect(() => {
    if (tip === null) return
    const timer = window.setTimeout(() => setTip(null), TIP_MS)
    return () => window.clearTimeout(timer)
  }, [tip])

  return (
    <div className="board">
      <div className="row head" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <div
            key={column.key}
            /*
             * The positions header carries its column class so the tinted panel behind the QB..K matrix
             * starts at the header and runs down through every row as one continuous shape.
             *
             * Only that one. The other header cells deliberately do NOT get a `cell-<key>` class:
             * `.cell-maxBid` and `.cell-spent`/`.cell-needs`/`.cell-perSlot` set text colours chosen for
             * FIGURES, and handing them to the header would repaint the header row off `--fg-dim`.
             */
            className={column.key === 'positions' ? 'cell cell-positions' : 'cell'}
            data-align={column.align}
          >
            {column.key === 'positions' ? (
              <div className="positions">
                {POSITION_COLUMNS.map((p) => (
                  <span key={p} data-position={p}>
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              column.label
            )}
          </div>
        ))}
      </div>

      <div className="rows">
        {managers.map((m) => (
          <div
            /*
             * The revision is part of the key so a change REMOUNTS the row, which is the only reliable
             * way to restart a CSS animation -- it will not re-fire on an attribute change alone.
             * Twelve rows is cheap to remount, and the row holds no state to lose.
             */
            key={`${m.name}:${revisions[m.name] ?? 0}`}
            className="row"
            style={{ gridTemplateColumns: template }}
            data-state={rowState(m, topMaxBid)}
            data-invalid={m.overspent || m.overRostered}
            /*
             * Only once a manager has actually moved. Without this every row would flash on first
             * paint, and again on every watchdog reload -- announcing a board that merely appeared.
             */
            data-flash={(revisions[m.name] ?? 0) > 0 ? '' : undefined}
          >
            {columns.map((column) => (
              <div
                key={column.key}
                className={`cell cell-${column.key}`}
                data-align={column.align}
                /* How close this figure is to the edge (7.7). `'none'` on most cells, most of
                   the night -- see `pressureLevel`. */
                data-pressure={pressureLevel(column.key, m)}
              >
                {column.key === 'positions' ? (
                  <div className="positions">
                    {POSITION_COLUMNS.map((p) => {
                      const count = m.positionCounts[p]
                      const full = atPositionLimit(p, count)
                      return (
                        <span
                          key={p}
                          className={count === 0 ? 'zero' : undefined}
                          /*
                           * Colour-coded per the designer's note, using the same palette as the
                           * ticker and the roster view so a position means one colour everywhere.
                           * The column HEADER carries the letters, which is what keeps 7.7's rule
                           * that colour is never the only signal.
                           */
                          data-position={p}
                          /*
                           * At the league's cap for this position: QB 3, TE 3, K 2. Red, because the
                           * useful thing for a bidder is that this manager CANNOT take another.
                           */
                          data-limit={full ? '' : undefined}
                          /*
                           * The one place the state is available as text. Colour is the signal on the
                           * wall, but a walk-up reader on a laptop gets the sentence.
                           */
                          title={full ? `${m.name} is at the ${p} limit (${count})` : undefined}
                        >
                          {/* A dim dot, not a 0: unfilled needs should pop out
                              rather than drown in a wall of zeros. */}
                          {count === 0 ? '·' : count}
                        </span>
                      )
                    })}
                  </div>
                ) : column.key === 'manager' && teams[m.name] !== undefined ? (
                  /*
                   * `title` is the whole feature on a desktop -- native, free, and it cannot break the
                   * board. The tap handler exists only because `title` does nothing on touch.
                   */
                  <span
                    className="manager-name"
                    title={teams[m.name]}
                    onPointerUp={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      setTip({ team: teams[m.name] as string, x: rect.left, y: rect.bottom })
                    }}
                  >
                    {cellValue(column.key, m)}
                  </span>
                ) : (
                  <span className={isNegative(column, m) ? 'negative' : undefined}>
                    {cellValue(column.key, m)}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {tip !== null && (
        <div className="team-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} role="presentation">
          {tip.team}
        </div>
      )}
    </div>
  )
}

/** Negative money is shown honestly, in warning colour, never floored at $0. */
function isNegative(column: Column, m: ManagerState): boolean {
  if (column.key === 'left') return m.remaining < 0
  if (column.key === 'spent') return m.spent < 0
  return false
}
