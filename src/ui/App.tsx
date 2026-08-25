/**
 * The board shell (docs/DESIGN.md section 7.2).
 *
 * Owns no fetching and no polling: it takes a derived `LeagueState` and renders.
 * Phase 3 hands it fixture-derived state and phase 4 swaps in the live client
 * without touching anything below this line.
 */

import { useEffect, useRef, useState } from 'react'
import { Header, type FeedState } from './Header'
import { Board } from './Board'
import { Rail, type Sale } from './Rail'
import { REFERENCE_TYPE_PX, selectColumns, type ColumnKey } from './columns'
import { useDisplayScale } from './useDisplayScale'
import { sortByMaxBid, type LeagueState } from '../model/derive'
import { DEFAULT_SETTINGS, type DisplaySettings } from '../config/displaySettings'

export interface AppProps {
  year: number
  state: LeagueState
  order?: readonly string[]
  cursor?: number
  sales?: Sale[]
  enabledColumns?: ColumnKey[]
  feed?: FeedState
  feedLabel?: string
  /**
   * Resolved display settings (`config/displaySettings.ts`): SETTINGS tab under
   * query string under defaults. Everything the projector evening might need to
   * change without a rebuild arrives through here.
   */
  settings?: DisplaySettings
}

/**
 * Measures the table area rather than the window: at <= 16:10 the rail moves below
 * the table, so the same window width leaves the table far more room. Deciding
 * which columns fit from `window.innerWidth` would drop columns the layout could
 * comfortably have shown.
 */
interface Metrics {
  width: number
  /** Root font size in px -- the fit test needs both. See columns.ts. */
  typePx: number
}

/**
 * `scale` is a dependency, not decoration: nudging the type scale changes the root
 * font size without changing the table's width, so the ResizeObserver never fires
 * and the fit test would keep using the type size from before the keypress.
 */
function useTableMetrics<T extends HTMLElement>(scale: number): [React.RefObject<T | null>, Metrics] {
  const ref = useRef<T>(null)
  const [metrics, setMetrics] = useState<Metrics>({ width: 0, typePx: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const measure = () =>
      setMetrics({
        width: node.getBoundingClientRect().width,
        typePx: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      })
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [scale])

  return [ref, metrics]
}

export function App({
  year,
  state,
  order = [],
  cursor = 0,
  sales = [],
  enabledColumns = [],
  feed,
  feedLabel,
  settings = DEFAULT_SETTINGS,
}: AppProps) {
  const { scale, nudged } = useDisplayScale(settings.scale)
  const [tableRef, metrics] = useTableMetrics<HTMLDivElement>(scale)

  // Before the first measurement, assume the projector rather than assume nothing:
  // a width of 0 would drop every optional column for one frame and flash.
  const columns = selectColumns({
    width: metrics.width || 1300,
    typePx: metrics.typePx || REFERENCE_TYPE_PX,
    enabled: settings.perSlot ? [...enabledColumns, 'perSlot'] : enabledColumns,
    forced: settings.columns,
  })

  // The sheet's order wins over the committed fallback copy (7.5).
  const nominationOrder = settings.order ?? order

  return (
    <div className="app">
      <Header year={year} league={state} feed={feed} feedLabel={feedLabel} />
      <div className="stage" data-rail={settings.rail ? 'on' : 'off'}>
        <div className="table-area" ref={tableRef}>
          <Board managers={sortByMaxBid(state.managers)} columns={columns} />
        </div>
        {/*
         * Not merely hidden: dropping it entirely gives the table the rail's width
         * back. This is the structural escape hatch for a projector that turns out
         * to be dimmer or further away than 7.1 assumed.
         */}
        {settings.rail && (
          <Rail managers={state.managers} order={nominationOrder} cursor={cursor} sales={sales} />
        )}
      </div>
      {/* Only after someone actually presses a key -- otherwise it is noise on the wall. */}
      {nudged && <div className="scale-badge">SCALE {scale.toFixed(2)}</div>}
    </div>
  )
}
