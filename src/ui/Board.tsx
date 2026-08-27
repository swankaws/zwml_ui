/**
 * The manager table (docs/DESIGN.md section 7.2).
 *
 * A table, not cards: twelve managers sharing a baseline down each column is what
 * makes them comparable at a glance. One table of 12, not two of 6 -- splitting
 * would double the row height, but two sets of column baselines destroys the
 * at-a-glance comparison that is the entire point.
 */

import { POSITION_COLUMNS, cellValue, pressureLevel, type Column } from './columns'
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
}

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

export function Board({ managers, columns, revisions = {} }: BoardProps) {
  const template = columns.map((c) => `minmax(0, ${c.width}fr)`).join(' ')
  const topMaxBid = distinguishingTopBid(managers)

  return (
    <div className="board">
      <div className="row head" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <div key={column.key} className="cell" data-align={column.align}>
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
                        >
                          {/* A dim dot, not a 0: unfilled needs should pop out
                              rather than drown in a wall of zeros. */}
                          {count === 0 ? '·' : count}
                        </span>
                      )
                    })}
                  </div>
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
    </div>
  )
}

/** Negative money is shown honestly, in warning colour, never floored at $0. */
function isNegative(column: Column, m: ManagerState): boolean {
  if (column.key === 'left') return m.remaining < 0
  if (column.key === 'spent') return m.spent < 0
  return false
}
