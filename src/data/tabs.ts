/**
 * Which tab to read (docs/DESIGN.md section 5.2).
 *
 * `/export?format=csv` selects a tab by **gid only** -- there is no name-based
 * selector -- so the year/gid mapping is committed in `config/league.ts` and this
 * module picks from it. That constraint is a feature: gviz's `&sheet=<name>` answers
 * `status:"ok"` with the WRONG TAB when the name does not match, which is the nastiest
 * failure available to this design because it renders a plausible board full of wrong
 * numbers. A gid either exists or 400s.
 */

import { league, type AuctionTab } from '../config/league'

export interface TabChoice extends AuctionTab {
  /** Set when `?year=` asked for a year that is not configured. */
  warning: string | null
}

/**
 * The highest configured year, or `?year=` if it names a configured tab.
 *
 * An unknown `?year=` falls back to the newest tab with a warning rather than
 * refusing to render: on draft night a fumbled URL parameter must cost a warning
 * line, not the board. `?year=2025` is how a past season gets rendered now that the
 * fixture harness is no longer the default path.
 */
export function pickAuctionTab(search = ''): TabChoice {
  const tabs = [...league.auctionTabs].sort((a, b) => b.year - a.year)
  // A season with no configured tabs is a config error, not a runtime state; the
  // committed list is non-empty and `league.test.ts` pins that.
  const newest = tabs[0] as AuctionTab

  const requested = new URLSearchParams(search.replace(/^\?/, '')).get('year')
  if (requested === null) return { ...newest, warning: null }

  const match = tabs.find((tab) => String(tab.year) === requested.trim())
  if (match) return { ...match, warning: null }

  return {
    ...newest,
    warning:
      `?year=${requested} is not a configured tab (have ${tabs.map((t) => t.year).join(', ')}); ` +
      `showing ${newest.year}.`,
  }
}
