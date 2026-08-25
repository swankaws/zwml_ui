/**
 * The right-hand rail: nomination order + recent sales (docs/DESIGN.md section 7.2).
 *
 * Deliberately small. Review found the first draft over-subscribed: ~1052px of
 * content demanded against ~1000px available, which would have pushed the table
 * rows down until they clipped. The fix was to make the rail a *window* -- five
 * live nominators and four sales, ~664px -- rather than a full list.
 */

import { nominationWindow } from './nominations'
import { money } from './columns'
import type { ManagerState } from '../model/derive'

export interface Sale {
  player: string
  price: number
  manager: string
}

export interface RailProps {
  managers: ManagerState[]
  order: readonly string[]
  /** Index into `order` of whoever is nominating. See nominations.ts. */
  cursor: number
  /** Newest first. */
  sales: Sale[]
  liveCount?: number
  saleCount?: number
}

const VISIBLE_SALES = 4

export function Rail({ managers, order, cursor, sales, liveCount = 5, saleCount = VISIBLE_SALES }: RailProps) {
  const full = new Set(managers.filter((m) => m.maxBid === null).map((m) => m.name))
  const entries = nominationWindow({
    order,
    cursor,
    liveCount,
    isFull: (name) => full.has(name),
  })

  return (
    <aside className="rail">
      {/*
       * Two sections, each owning its own heading. The stacked 4:3 layout turns the
       * rail into a two-column grid, and a bare heading as a third child landed in
       * the wrong cell -- "LAST SOLD" ended up alone at the far right.
       */}
      <section className="rail-nominations">
        <h2>ON THE CLOCK</h2>
        <div className="nomination">
          {/*
           * Three states, not two. An unset order is a configuration gap and says
           * so -- it must never take the board down with it (8) -- while an order
           * with nobody eligible means the draft is done, which is worth saying
           * plainly instead of showing twelve crossed-out names.
           */}
          {order.length === 0 ? (
            <span className="empty">NOMINATION ORDER NOT SET</span>
          ) : entries.length === 0 ? (
            <span className="empty">DRAFT COMPLETE</span>
          ) : (
            entries.map((entry) => (
              <span
                key={entry.name}
                className="nominee"
                data-onclock={entry.onClock}
                data-full={entry.full}
              >
                {entry.name}
                {entry.full && <span className="tag">FULL</span>}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="rail-sales">
        <h2>LAST SOLD</h2>
        <div className="sales">
          {sales.length === 0 ? (
            <span className="empty">NO SALES YET</span>
          ) : (
            sales.slice(0, saleCount).map((sale, index) => (
              <div key={`${sale.player}-${index}`}>
                <div className="sale-player">{sale.player}</div>
                <div className="sale-price">
                  <b>{money(sale.price)}</b> {sale.manager}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}
