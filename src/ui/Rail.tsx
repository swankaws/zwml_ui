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
import type { SaleEvent } from '../model/diff'

export interface RailProps {
  managers: ManagerState[]
  order: readonly string[]
  /** Index into `order` of whoever is nominating, or `null` if unknown. nominations.ts. */
  cursor: number | null
  /** Newest first. */
  sales: readonly SaleEvent[]
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
        {/*
         * The heading is the claim, so it changes with what we actually know. `ON THE
         * CLOCK` over a list where nobody is highlighted invites the room to read the
         * top name as the nominator, which is a guess we have not earned until phase 6
         * replays the rotation. `NOMINATION ORDER` promises only what is on screen.
         */}
        <h2>{cursor === null ? 'NOMINATION ORDER' : 'ON THE CLOCK'}</h2>
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
            /*
             * Keyed by sequence, not by array index. Index keying remounts every visible
             * entry whenever a sale is prepended, which is invisible today and would make
             * an entry animation play across the whole list the moment one is added.
             */
            sales.slice(0, saleCount).map((sale) => (
              <div key={sale.seq}>
                {/*
                 * Position colors the NAME (7.3) but the LABEL rides on the price line.
                 * Measured, not chosen: a three-character prefix on the name line overflows
                 * 1440x900 by 12px, 1280x1024 by 10px and 1080p at the scale ceiling by
                 * 29px -- three configurations already in the layout matrix -- while the
                 * same text on the price line overflows nothing anywhere. 7.7 forbids color
                 * as the sole signal, so the label is not optional.
                 */}
                <div className="sale-player" data-position={sale.position ?? 'none'}>
                  {sale.player}
                </div>
                <div className="sale-price">
                  {sale.position && <span className="sale-pos">{sale.position}</span>}
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
