/**
 * Every sale of the night (docs/DESIGN.md 7.3, 7.4).
 *
 * The rail shows four. This shows all of them, and it is the ONE screen in this app allowed to
 * scroll on a desktop or a projector — a deliberate exception, because the alternatives are worse:
 * a hundred and eighty sales cannot be paged without someone driving the pager, and truncating is
 * exactly what the rail already does. Nothing else scrolls, and the board's twelve rows never will.
 *
 * NEWEST FIRST by default, because the reason to open this mid-draft is almost always to audit
 * something that just happened — "what did that go for", "did the price get typed wrong". Oldest
 * first is the better read *after* the draft, when the question becomes how the night unfolded, so
 * it is a button rather than a rebuild.
 *
 * The `#` column always counts chronologically regardless of sort order: sale 1 is the first player
 * sold whether it appears at the top or the bottom. Numbering the display order instead would make
 * the same sale change number when the button is pressed, which is precisely wrong for an audit.
 *
 * WHO NOMINATED is the column the sheet cannot give us. The tab records the buyer of every pick and
 * says nothing about who put the player up, so `nominatorBySeq` recovers it by replaying the
 * rotation — the same replay the ON THE CLOCK pointer uses. It is therefore exactly as trustworthy
 * as the configured order and no more: with a placeholder rotation every name in that column is
 * wrong in the same way the pointer is. Hence a dash rather than a guess when it is unknown.
 */

import { useState } from 'react'
import { money } from './columns'
import { fitPlayerName } from './playerName'
import type { SaleEvent } from '../model/diff'

export interface HistoryProps {
  /** Any order; this sorts by `seq` itself. */
  sales: readonly SaleEvent[]
  /** From `nominatorBySeq`. Empty when no order is configured. */
  nominators: Map<number, string>
  /** Characters a player name may take. Generous: this view has a whole screen of width. */
  nameChars?: number
  /** Pinned for the layout gate, which needs to measure both orders without a keyboard. */
  initialOldestFirst?: boolean
}

export function History({
  sales,
  nominators,
  nameChars = 28,
  initialOldestFirst = false,
}: HistoryProps) {
  const [oldestFirst, setOldestFirst] = useState(initialOldestFirst)

  const chronological = [...sales].sort((a, b) => a.seq - b.seq)
  /** Chronological position, fixed to the sale rather than to the row it is drawn in. */
  const numberOf = new Map(chronological.map((sale, index) => [sale.seq, index + 1]))
  const shown = oldestFirst ? chronological : [...chronological].reverse()

  const total = chronological.reduce((sum, sale) => sum + sale.price, 0)

  return (
    <div className="history">
      <div className="history-head">
        <span className="history-count">
          {chronological.length} {chronological.length === 1 ? 'SALE' : 'SALES'}
        </span>
        {chronological.length > 0 && (
          <span className="history-total">
            {money(total)} spent · avg {money(Math.round(total / chronological.length))}
          </span>
        )}
        <button
          type="button"
          className="history-sort"
          onClick={() => setOldestFirst((was) => !was)}
        >
          {oldestFirst ? 'OLDEST FIRST' : 'NEWEST FIRST'}
        </button>
      </div>

      {chronological.length === 0 ? (
        /*
         * The state this view is in for the first minutes of every draft, and it must not look
         * broken. Keepers are the baseline and correctly never appear here (7.3).
         */
        <p className="history-empty">
          No sales yet. Players sold during the auction appear here as they are entered.
        </p>
      ) : (
        <div className="history-table">
          <div className="history-row history-labels">
            <span>#</span>
            <span>NOMINATED BY</span>
            <span>PLAYER</span>
            <span>POS</span>
            <span className="history-price">PRICE</span>
            <span>WON BY</span>
          </div>
          {shown.map((sale) => (
            <div className="history-row" key={sale.seq}>
              <span className="history-index">{numberOf.get(sale.seq)}</span>
              <span className="history-nominator">{nominators.get(sale.seq) ?? '—'}</span>
              <span
                className="history-player"
                data-position={sale.position ?? 'none'}
                title={sale.player}
              >
                {fitPlayerName(sale.player, nameChars)}
              </span>
              <span className="history-pos" data-position={sale.position ?? 'none'}>
                {sale.position ?? '·'}
              </span>
              <span className="history-price">{money(sale.price)}</span>
              <span className="history-buyer">{sale.manager}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
