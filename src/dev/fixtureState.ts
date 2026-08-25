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
import { parseOrder } from '../config/displaySettings'
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
 * Nomination order, cheapest usable source first (7.5, 9.2):
 *
 *   `?demoOrder=1`          a stand-in for layout work -- roster order, not the league's
 *   A1 of the auction tab   what the maintainer actually curates
 *   `league.nominationOrder`  the committed fallback
 *
 * The SETTINGS tab and `?order=` sit above all of these and are applied by `App`,
 * so they are not repeated here.
 *
 * A1 is validated against the roster **as parsed from this tab**, not against the
 * committed list, which is the whole point: it lets a manager the config has never
 * heard of appear in the order without a deploy. A stale or fumbled A1 rejects
 * wholesale and falls through to the committed copy -- and it *does* go stale, so
 * this is not theoretical: both committed fixtures still carry an A1 naming `Rob`,
 * who has not played in years.
 *
 * `?demoOrder=1` stays because the rail's vertical budget is the one thing review
 * caught here: the first draft demanded ~1052px against ~1000px available, and the
 * fix was to window it to five nominators and four sales. It must stay verifiable
 * even when no real order resolves.
 */
function resolveOrder(
  flag: string | null,
  state: LeagueState,
  hint: string,
): { order: readonly string[]; warnings: string[] } {
  if (flag !== null && flag !== '0') {
    return { order: state.managers.map((m) => m.name), warnings: [] }
  }

  const roster = state.managers.map((m) => m.name)
  const fromSheet = parseOrder(hint, roster)
  if (fromSheet.order) return { order: fromSheet.order, warnings: fromSheet.warnings }

  /*
   * The committed order is validated too, against this board.
   *
   * Skipping that looks harmless -- it is our own list -- and is not. It names the
   * CURRENT season's managers, so on a past tab it names someone with no row. The
   * rail then treats a manager it cannot find as "not full", i.e. able to nominate,
   * and 2025 rendered `Kris` ON THE CLOCK on a draft that finished a year ago, while
   * the same state reported `draftComplete`. A rotation naming someone who is not on
   * the board is not a usable rotation; showing none is honest.
   */
  const fromConfig = parseOrder(league.nominationOrder.join(' > '), roster)
  return {
    order: fromConfig.order ?? [],
    warnings: [...fromSheet.warnings, ...fromConfig.warnings],
  }
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
