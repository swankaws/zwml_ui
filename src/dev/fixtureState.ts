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
import { resolveNominationOrder } from '../model/order'
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
  const resolved = resolveOrder(params.get('demoOrder'), state, parsed.orderHint)

  return {
    year: fixture.year,
    state,
    sales: recentSales(state),
    order: resolved.order,
    warnings: [...parsed.warnings.map((w) => `${w.ref}: ${w.message}`), ...resolved.warnings],
  }
}

/**
 * Nomination order for a fixture. The real chain -- A1, then the committed copy, both
 * validated against the roster parsed from *this* tab -- lives in `model/order.ts` and
 * is shared with the live store, so it is not duplicated here. This adds exactly one
 * thing on top of it: the `?demoOrder=1` escape hatch.
 *
 * (The SETTINGS tab and `?order=` sit above both and are applied by `App`.)
 *
 * `?demoOrder=1` stays because the rail's vertical budget is the one thing review caught
 * here: the first draft demanded ~1052px against ~1000px available, and the fix was to
 * window it to five nominators and four sales. That has to stay verifiable even when no
 * real order resolves -- which is the normal state on a past tab, where the committed
 * order correctly refuses to apply.
 */
function resolveOrder(
  flag: string | null,
  state: LeagueState,
  hint: string,
): { order: readonly string[]; warnings: string[] } {
  const roster = state.managers.map((m) => m.name)
  if (flag !== null && flag !== '0') return { order: roster, warnings: [] }
  return resolveNominationOrder(roster, hint)
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
