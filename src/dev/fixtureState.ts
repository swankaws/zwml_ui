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
import type { SaleEvent } from '../model/diff'

const FIXTURES: Record<string, { year: number; csv: string }> = {
  '2026': { year: 2026, csv: raw2026 },
  '2025': { year: 2025, csv: raw2025 },
}

export interface FixtureState {
  year: number
  state: LeagueState
  sales: SaleEvent[]
  order: readonly string[]
  warnings: string[]
}

/** `?sales=N`, clamped. Defaults to six so no existing layout case changes. */
function saleCount(params: URLSearchParams): number {
  const raw = params.get('sales')
  if (raw === null) return 6
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 60)) : 6
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
    sales: recentSales(state, saleCount(params)),
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
 * Layout stand-in for the sale feed. A static CSV carries no chronology, so these are not
 * "recent" in any real sense -- they exist so the rail is measured against real content.
 *
 * Sorted by NAME LENGTH, not by price. It used to sort by price, and the effect was that
 * the longest name in either fixture -- `Jacory Croskey-Merritt`, 22 characters -- had
 * never once been rendered in the rail across all 25 layout cases, because it never made
 * the top six by price. The widest string is the whole point of a layout fixture.
 *
 * `?sales=N` sizes the list: `?sales=0` is the only way to measure `NO SALES YET`, which
 * is the state the live board is genuinely in for the first minutes of every draft.
 */
function recentSales(state: LeagueState, count: number): SaleEvent[] {
  const all = state.managers
    .flatMap((m, block) =>
      m.picks.map((p, index) => ({
        slot: `${block}:${p.row}`,
        seq: block * 100 + index + 1,
        player: p.player,
        price: p.price,
        manager: m.name,
        position: p.position,
      })),
    )
    .sort((a, b) => b.player.length - a.player.length || b.price - a.price)

  /*
   * Widest name PER POSITION first, then the next widest overall.
   *
   * Sorting by length alone gave four RBs -- the longest names in both fixtures happen to
   * be running backs -- so four of the five position colors were never rendered anywhere in
   * the layout matrix, and neither was the `null` position an unlabeled bench row produces.
   * Taking one per position first keeps the widest-string property that makes this a layout
   * fixture while also putting the whole palette on screen, which is what Friday's
   * projector rehearsal has to judge by eye.
   */
  const seen = new Set<string>()
  const spread = all.filter((sale) => {
    const key = sale.position ?? 'none'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const rest = all.filter((sale) => !spread.includes(sale))
  return [...spread, ...rest].slice(0, count)
}
