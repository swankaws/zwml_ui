/**
 * The right-hand rail: nomination order + recent sales (docs/DESIGN.md section 7.2).
 *
 * Deliberately small. Review found the first draft over-subscribed: ~1052px of
 * content demanded against ~1000px available, which would have pushed the table
 * rows down until they clipped. The fix was to make the rail a *window* -- five
 * live nominators and four sales, ~664px -- rather than a full list.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nominationWindow, type NominationEntry } from './nominations'
import { money } from './columns'
import type { ManagerState } from '../model/derive'
import type { SaleEvent } from '../model/diff'
import { highestSeq, newSaleSeqs } from '../model/revisions'

export interface RailProps {
  managers: ManagerState[]
  order: readonly string[]
  /** Index into `order` of whoever is nominating, or `null` if unknown. nominations.ts. */
  cursor: number | null
  /** Newest first. */
  sales: readonly SaleEvent[]
  liveCount?: number
  saleCount?: number
  /**
   * Pretend everything on screen has just arrived. **Measurement only.**
   *
   * The rail's washes are correct precisely because they never fire on a first paint -- which also
   * means a static fixture can never show them, so the layout gate could not measure them at all. An
   * unmeasured animation is exactly how the notices strip shipped covering four managers' figures, so
   * this exists to let the harness see it once. Never set on the live path.
   */
  demoFlash?: boolean
}

const VISIBLE_SALES = 4

/**
 * A one-shot flag, captured when the element mounts and never revisited (7.7).
 *
 * This is the load-bearing piece of both flashes here, and the reason a plain prop does not work. The
 * store re-publishes once a second so a climbing `STALE · 47s` stays honest, so this component
 * re-renders about once a second -- and by the next render the "is this new" answer has become false.
 * A `data-flash` attribute driven straight from a prop would therefore be REMOVED roughly one second
 * into a 1.1s animation, cancelling it just before the end. Freezing the answer at mount means the
 * element keeps it for its whole life, and CSS runs the animation exactly once.
 */
function useFlashOnce(flash: boolean): boolean {
  const [captured] = useState(flash)
  return captured
}

export function Rail({
  managers,
  order,
  cursor,
  sales,
  liveCount = 5,
  saleCount = VISIBLE_SALES,
  demoFlash = false,
}: RailProps) {
  const full = new Set(managers.filter((m) => m.maxBid === null).map((m) => m.name))
  const entries = nominationWindow({
    order,
    cursor,
    liveCount,
    isFull: (name) => full.has(name),
  })

  /*
   * What was on screen last time, so a flash marks an ARRIVAL rather than a first paint.
   *
   * Refs written in an effect, deliberately: the value read during render is the one from the previous
   * COMMIT, which is exactly "what the room was looking at a moment ago". `null` on the very first
   * render is what suppresses the flash at page load and after every watchdog reload -- otherwise all
   * four ticker entries and the nominator would light up announcing things that did not just happen.
   */
  const seenSeq = useRef<number | null>(demoFlash ? 0 : null)
  const seenOnClock = useRef<string | null>(demoFlash ? '\u0000' : null)

  const top = highestSeq(sales)
  const fresh = newSaleSeqs(sales, seenSeq.current)

  const onClockName = entries.find((entry) => entry.onClock)?.name ?? null
  const clockMoved = seenOnClock.current !== null && onClockName !== seenOnClock.current

  useEffect(() => {
    if (top !== null) seenSeq.current = top
    // Only once somebody IS on the clock: going from "nobody knows" to a name is not a hand-off.
    if (onClockName !== null) seenOnClock.current = onClockName
  }, [top, onClockName])

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
              <Nominee
                /*
                 * Keyed on the on-clock flag as well as the name, so a manager moving from ON DECK to
                 * ON THE CLOCK REMOUNTS. Without that they keep their existing element -- and their
                 * captured flag, which was false when they were merely next -- so the hand-off would
                 * never animate.
                 */
                key={`${entry.name}:${entry.onClock}`}
                entry={entry}
                flash={entry.onClock && clockMoved}
              />
            ))
          )}
        </div>
      </section>

      <section className="rail-sales">
        <h2>LAST PURCHASED</h2>
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
              <SaleEntry key={sale.seq} sale={sale} flash={fresh.has(sale.seq)}>
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
                {/*
                 * Position, then manager, then amount -- the designer's order. It reads as a sentence
                 * ("a WR, to Kevin, for $61") where the previous arrangement led with the money.
                 */}
                {/*
                 * A flex row, not inline text. Written as adjacent JSX elements it rendered
                 * `WRKevin$4` -- JSX drops the whitespace between elements on separate lines, so the
                 * three parts ran together and "Kevin$61" read as one token. Explicit gaps cannot have
                 * that bug.
                 */}
                <div className="sale-price">
                  {sale.position && <span className="sale-pos">{sale.position}</span>}
                  <span className="sale-manager">{sale.manager}</span>
                  <b className="sale-amount">{money(sale.price)}</b>
                </div>
              </SaleEntry>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}

/**
 * One nomination-order name.
 *
 * A component rather than a bare span purely so the flash can be frozen at mount -- see
 * `useFlashOnce`. The wash marks a HAND-OFF: whoever just came on the clock.
 */
function Nominee({ entry, flash }: { entry: NominationEntry; flash: boolean }) {
  const washing = useFlashOnce(flash)
  return (
    <span
      className="nominee"
      data-onclock={entry.onClock}
      data-full={entry.full}
      data-flash={washing ? '' : undefined}
    >
      {entry.name}
      {entry.full && <span className="tag">FULL</span>}
    </span>
  )
}

/**
 * One LAST SOLD entry, washing once if it has just arrived.
 *
 * Its own component for the same reason as `Nominee`: the flag has to be captured at mount, because
 * this list re-renders about once a second while the feed is anything but healthy.
 */
function SaleEntry({
  sale,
  flash,
  children,
}: {
  sale: SaleEvent
  flash: boolean
  children: ReactNode
}) {
  const washing = useFlashOnce(flash)
  return (
    <div className="sale" data-seq={sale.seq} data-flash={washing ? '' : undefined}>
      {children}
    </div>
  )
}
