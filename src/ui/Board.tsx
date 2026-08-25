/**
 * The manager table (docs/DESIGN.md section 7.2).
 *
 * A table, not cards: twelve managers sharing a baseline down each column is what
 * makes them comparable at a glance. One table of 12, not two of 6 -- splitting
 * would double the row height, but two sets of column baselines destroys the
 * at-a-glance comparison that is the entire point.
 */

import { POSITION_COLUMNS, cellValue, type Column } from './columns'
import type { ManagerState } from '../model/derive'
import { league } from '../config/league'

export interface BoardProps {
  managers: ManagerState[]
  columns: Column[]
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

export function Board({ managers, columns }: BoardProps) {
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
                  <span key={p}>{p}</span>
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
            key={m.name}
            className="row"
            style={{ gridTemplateColumns: template }}
            data-state={rowState(m, topMaxBid)}
            data-invalid={m.overspent || m.overRostered}
          >
            {columns.map((column) => (
              <div
                key={column.key}
                className={`cell cell-${column.key}`}
                data-align={column.align}
              >
                {column.key === 'positions' ? (
                  <div className="positions">
                    {POSITION_COLUMNS.map((p) => {
                      const count = m.positionCounts[p]
                      return (
                        <span key={p} className={count === 0 ? 'zero' : undefined}>
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
