/**
 * The board shell (docs/DESIGN.md section 7.2).
 *
 * Owns no fetching and no polling: it takes a derived `LeagueState` and renders.
 * Phase 3 hands it fixture-derived state and phase 4 swaps in the live client
 * without touching anything below this line.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Header, type FeedState } from './Header'
import { Board } from './Board'
import { Rail } from './Rail'
import { REFERENCE_TYPE_PX, selectColumns, type ColumnKey } from './columns'
import { useDisplayScale } from './useDisplayScale'
import { Roster } from './Roster'
import { History } from './History'
import { Help } from './Help'
import { useHelp, useView } from './useView'
import { useTheme } from './useTheme'
import { sortByMaxBid, type LeagueState } from '../model/derive'
import { derivePointer, nominatorBySeq, type PointerBasis } from '../model/pointer'
import type { SaleEvent } from '../model/diff'
import { DEFAULT_SETTINGS, type DisplaySettings } from '../config/displaySettings'

export interface AppProps {
  year: number
  state: LeagueState
  order?: readonly string[]
  /**
   * Who is nominating, as an index into the order. Used only when `pointer` is absent --
   * the fixture path's `?cursor=N`, which keeps the on-clock styling in the layout gate.
   */
  cursor?: number | null
  /**
   * The live pointer, derived HERE rather than in the store.
   *
   * It has to be: the pointer is an index into `nominationOrder` below, and that is
   * `settings.order ?? order` -- the SETTINGS tab and `?order=` can both replace the list
   * the store parsed (7.5). A pointer derived against the store's own order would index a
   * different array than the one being rendered, and the failure is the wrong name under
   * ON THE CLOCK, which is the single most-watched string on the wall.
   */
  pointer?: PointerBasis | null
  sales?: readonly SaleEvent[]
  /** Per-manager change counters, for the once-only flash (7.7). See `model/revisions.ts`. */
  revisions?: Readonly<Record<string, number>>
  enabledColumns?: ColumnKey[]
  feed?: FeedState
  feedLabel?: string
  /**
   * Resolved display settings (`config/displaySettings.ts`): SETTINGS tab under
   * query string under defaults. Everything the projector evening might need to
   * change without a rebuild arrives through here.
   */
  settings?: DisplaySettings
  /**
   * Which layer supplied `settings.columns`, since `resolveSettings` merges them and
   * loses that. Only `'query'` overrules the fit test -- see `SelectOptions.forcedFrom`.
   *
   * Defaults to the cautious answer on purpose. Forgetting to thread this through then
   * costs a forced set its bypass, which is visible and recoverable (`?columns=` still
   * works); the other default would silently truncate every phone in the league.
   */
  columnsFrom?: 'query' | 'sheet'
  /**
   * The notices strip (`ui/Notices.tsx`), as a slot rather than props.
   *
   * It has to be *inside* this grid: as an overlay it covered four managers' figures at
   * three of the matrix resolutions (see the header of `Notices.tsx`). A slot keeps the
   * shell from knowing what a warning is, and keeps `Notices` from knowing it is the
   * last row of a grid -- the standby screen renders the same element with room to spare.
   */
  notices?: ReactNode
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
  cursor = null,
  pointer = null,
  sales = [],
  revisions = {},
  enabledColumns = [],
  feed,
  feedLabel,
  settings = DEFAULT_SETTINGS,
  columnsFrom = 'sheet',
  notices = null,
}: AppProps) {
  const { scale, nudged } = useDisplayScale(settings.scale)
  const [tableRef, metrics] = useTableMetrics<HTMLDivElement>(scale)
  const { view, toggle: toggleView, show: showView } = useView()
  const { open: helpOpen, toggle: toggleHelp } = useHelp()
  const { theme, toggle: toggleTheme } = useTheme(settings.theme)
  /*
   * `?sort=oldest` exists only so the layout gate can measure the flipped order, which has no
   * keyboard route and a button the harness would otherwise have to click.
   */
  const oldestFirstPinned =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search.replace(/^\?/, '')).get('sort') === 'oldest'

  // Before the first measurement, assume the projector rather than assume nothing:
  // a width of 0 would drop every optional column for one frame and flash.
  const columns = selectColumns({
    width: metrics.width || 1300,
    typePx: metrics.typePx || REFERENCE_TYPE_PX,
    enabled: settings.perSlot ? [...enabledColumns, 'perSlot'] : enabledColumns,
    forced: settings.columns,
    // A URL is typed by someone looking at this screen; the sheet is not. Only the
    // former gets to overrule the fit test.
    forcedFrom: columnsFrom,
  })

  // The sheet's order wins over the committed fallback copy (7.5).
  const nominationOrder = settings.order ?? order
  /*
   * An explicit `cursor` wins over the derived pointer.
   *
   * Both exist because they answer different needs: `?cursor=N` pins the on-clock highlight so the
   * layout gate can measure it, while `pointer` is the real replay. Precedence used to run the other
   * way, which meant the fixture path could not supply a pointer basis at all without breaking the
   * `?cursor=` cases -- and that in turn left the history view's NOMINATED BY column rendering
   * nothing but dashes in every gate case, so its width was never measured.
   */
  const onClock =
    cursor !== null ? cursor : pointer ? derivePointer({ order: nominationOrder, ...pointer }) : null

  return (
    <div className="app">
      <Header
        year={year}
        league={state}
        feed={feed}
        feedLabel={feedLabel}
        /*
         * Both controls beside the title, on any display with a keyboard. Each is also a key (`?`
         * and `T`), and each is here because a key nobody knows about is a key that does not
         * exist -- the standby screen advertises them and it is on screen for about two seconds.
         *
         * The theme toggle is a TOGGLE, not a setup step, which is why it is visible rather than
         * buried in the overlay. Room lights come on and go off during an evening draft, a bulb
         * shifts as it warms, and a phone in sunlight wants the opposite of a phone indoors -- so
         * whichever palette is easier to read can change while the board is up.
         *
         * They fit because the header gives up the word AUCTION below 1600px (see `.title-word`).
         * That was the honest trade: the header sits within ~10px of its limit at 1024x768, and the
         * first attempt at a second button pushed the TITLE into "ZWML 202..." -- 7.1's silent
         * truncation, caught by `h1Truncated`. Spending a word nobody needs beats hiding a control.
         */
        help={
          <span className="title-controls">
            <button
              type="button"
              className="title-button"
              onClick={toggleHelp}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>
            <button
              type="button"
              className="title-button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
              title={theme === 'light' ? 'Dark mode (T)' : 'Light mode (T)'}
            >
              {theme === 'light' ? '◐' : '◑'}
            </button>
          </span>
        }
        /*
         * Touch controls, mobile-only by CSS. A phone has no keyboard, so every key-only action is
         * simply unavailable there (7.9 requires a tap route for anything reachable only by key).
         *
         * There is no `?` here on purpose. It used to be, and it was a button that opened a KEYBOARD
         * reference on a device with no keyboard -- eight lines of things the reader cannot do. What
         * a phone actually needs are the two actions it cannot otherwise reach.
         */
        action={
          <div className="touch-controls">
            <button type="button" className="touch-button" onClick={toggleView}>
              {view === 'roster' ? 'BOARD' : 'ROSTERS'}
            </button>
            <button
              type="button"
              className="touch-button"
              onClick={() => showView(view === 'history' ? 'board' : 'history')}
            >
              {view === 'history' ? 'BOARD' : 'SALES'}
            </button>
            <button
              type="button"
              className="touch-button"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            >
              {theme === 'light' ? 'DARK' : 'LIGHT'}
            </button>
          </div>
        }
      />
      {/*
       * The view swaps the CONTENT ROW, keeping the header and the footer. A full-screen
       * sibling was the alternative and it buys only ~72px at 1080p (+7.4%) while costing
       * the room the header's SPENT/CHASING/SLOTS totals and the notices strip -- the two
       * things that say whether what is on the wall can be trusted at all (7.8).
       */}
      {view === 'history' ? (
        <div className="stage" data-rail="off">
          <History
            sales={sales}
            /*
             * Recovered from the same replay the pointer uses, because the sheet records only the
             * BUYER of each pick. It is exactly as trustworthy as the configured order -- with a
             * placeholder rotation every name in that column is wrong the same way ON THE CLOCK is.
             */
            nominators={
              pointer ? nominatorBySeq({ order: nominationOrder, ...pointer }) : new Map()
            }
            initialOldestFirst={oldestFirstPinned}
          />
        </div>
      ) : view === 'roster' ? (
        <div className="stage" data-rail="off" ref={tableRef}>
          <Roster managers={state.managers} />
        </div>
      ) : (
      <div className="stage" data-rail={settings.rail ? 'on' : 'off'}>
        <div className="table-area" ref={tableRef}>
          <Board
            managers={sortByMaxBid(state.managers)}
            columns={columns}
            revisions={revisions}
          />
        </div>
        {/*
         * Not merely hidden: dropping it entirely gives the table the rail's width
         * back. This is the structural escape hatch for a projector that turns out
         * to be dimmer or further away than 7.1 assumed.
         */}
        {settings.rail && (
          <Rail managers={state.managers} order={nominationOrder} cursor={onClock} sales={sales} />
        )}
      </div>
      )}
      {/*
       * The footer exists only when it has something in it: `Notices` renders nothing when
       * there is nothing to say and the badge waits for a keypress, so in the ordinary case
       * this element has no children at all and `.footer:empty` takes it out of the grid --
       * gap included. That matters because 7.1's row budget has no slack to spend on chrome
       * that is usually invisible, and the documented `scale: 1.15` ceiling was measured
       * without it.
       */}
      <Help open={helpOpen} onClose={toggleHelp} theme={theme} onToggleTheme={toggleTheme} />
      <div className="footer">
        {notices}
        {/* Only after someone actually presses a key -- otherwise it is noise on the wall. */}
        {nudged && <div className="scale-badge">SCALE {scale.toFixed(2)}</div>}
      </div>
    </div>
  )
}
