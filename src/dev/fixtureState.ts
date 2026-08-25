/**
 * Fixture-derived state for the phase-3 static board (docs/DESIGN.md section 12).
 *
 * No network. The real CSVs captured in docs/data-samples go through the real
 * parser and the real model, so what the projector shows during the legibility
 * spike is genuine data at genuine widths -- real player names, real three-digit
 * prices, real FULL rows.
 *
 * `?fixture=2025` switches to the completed 2025 board. That matters for the
 * spike: 2026 is mostly keepers, so only 2025 exercises worst-case content --
 * every roster full, the widest names, and the `$/SLOT` = null path.
 *
 * PHASE 4 REMOVES THIS FROM THE ENTRY POINT. It imports both CSVs with `?raw`,
 * which bundles them; the live client replaces it.
 */

import raw2026 from '../../docs/data-samples/2026-auction.csv?raw'
import raw2025 from '../../docs/data-samples/2025-auction.csv?raw'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid } from '../data/gridParser'
import { deriveLeague, type LeagueState } from '../model/derive'
import { league } from '../config/league'
import type { Sale } from '../ui/Rail'

const FIXTURES: Record<string, { year: number; csv: string }> = {
  '2026': { year: 2026, csv: raw2026 },
  '2025': { year: 2025, csv: raw2025 },
}

export interface FixtureState {
  year: number
  state: LeagueState
  sales: Sale[]
  order: readonly string[]
  warnings: string[]
}

export function loadFixture(search: string): FixtureState {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const requested = params.get('fixture') ?? '2026'
  const fixture = FIXTURES[requested] ?? FIXTURES['2026']!

  const parsed = parseAuctionGrid(parseCsv(fixture.csv))
  const state = deriveLeague(parsed.blocks)

  return {
    year: fixture.year,
    state,
    sales: recentSales(state),
    order: demoOrder(params.get('demoOrder'), state),
    warnings: parsed.warnings.map((w) => `${w.ref}: ${w.message}`),
  }
}

/**
 * `?demoOrder=1` fills the rail with a stand-in order. NOT the league's order --
 * that is still unanswered and lives in `league.nominationOrder`.
 *
 * It exists because the rail's vertical budget is the one thing review actually
 * caught here: the first draft demanded ~1052px against ~1000px available, and the
 * fix was to window it to five nominators and four sales. With the real order empty
 * the rail renders a one-line placeholder, so that fix would ship unverified.
 */
function demoOrder(flag: string | null, state: LeagueState): readonly string[] {
  if (flag === null || flag === '0') return league.nominationOrder
  return state.managers.map((m) => m.name)
}

/**
 * Stand-in for the phase-5 sale feed. A static CSV carries no chronology, so this
 * is the highest-priced picks -- not "recent" in any real sense, just the longest
 * names and widest prices, which is what the rail layout needs to be tested against.
 */
function recentSales(state: LeagueState): Sale[] {
  return state.managers
    .flatMap((m) => m.picks.map((p) => ({ player: p.player, price: p.price, manager: m.name })))
    .sort((a, b) => b.price - a.price)
    .slice(0, 6)
}
