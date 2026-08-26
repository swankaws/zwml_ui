/**
 * End-of-draft superlatives, derived rather than invented.
 *
 * These exist for the finale screen (`ui/Complete.tsx`), and the point of computing them from the sale
 * data is that they are different every year and cannot go stale. Nothing here is hard-coded about the
 * 2026 league.
 *
 * WHY NOT "BEST VALUE". The obvious award is worthless in this format: every manager fills fifteen slots
 * out of the same $200, so dollars-per-player lands within pennies of $13.33 for all twelve and the
 * "winner" is decided by rounding. Every award below is chosen because it genuinely varies -- somebody
 * really did pay the most for one player, and somebody really did overpay for their last roster spot.
 *
 * Every award is OPTIONAL. Each returns nothing when the data does not support it, so a draft where
 * every final pick went for a dollar simply has no LOOOO-SER rather than an arbitrary one.
 */

import { league } from '../config/league'
import type { SaleEvent } from './diff'
import type { LeagueState, ManagerState } from './derive'

export interface Award {
  /** Stable id, for React keys and for the layout gate to count. */
  key: string
  /** The shouty part. */
  title: string
  /** Who won it. */
  manager: string
  /** The evidence, so nobody has to take the board's word for it. */
  detail: string
}

/** Highest price paid for a single player. Always exists once anyone has bought anybody. */
function bigSpender(state: LeagueState): Award | null {
  let best: { manager: ManagerState; player: string; price: number } | null = null
  for (const manager of state.managers) {
    for (const pick of manager.picks) {
      if (best === null || pick.price > best.price) {
        best = { manager, player: pick.player, price: pick.price }
      }
    }
  }
  if (best === null || best.price <= league.minBid) return null
  return {
    key: 'big-spender',
    title: 'BIGGEST SPLASH',
    manager: best.manager.name,
    detail: `$${best.price} on ${best.player}`,
  }
}

/** Most players bought at the minimum bid. The opposite temperament to the above. */
function bargainBin(state: LeagueState): Award | null {
  let best: { manager: ManagerState; count: number } | null = null
  for (const manager of state.managers) {
    const count = manager.picks.filter((pick) => pick.price <= league.minBid).length
    if (best === null || count > best.count) best = { manager, count }
  }
  // Two or fewer is just how a roster fills out; it is only funny as a strategy.
  if (best === null || best.count < 3) return null
  return {
    key: 'bargain-bin',
    title: 'DUMPSTER DIVER',
    manager: best.manager.name,
    detail: `${best.count} players at $${league.minBid}`,
  }
}

/**
 * Whoever paid the most for their LAST pick — the LOOOO-SER.
 *
 * The sharpest available measure of a badly run budget, and better than the obvious "left the most money
 * unspent": leftover cash is the symptom, but a fat price on a final roster spot is the CONSEQUENCE.
 * It means they arrived at the end of the night with money they could no longer spread, and had to dump
 * it on whoever was left in the pool.
 *
 * Chronology comes from the sale log, which is the only place it exists -- the sheet records no
 * timestamps and no pick order, so a manager's "last pick" is simply their highest observed `seq`
 * (7.3). Two honest consequences of that:
 *
 *   - Keepers are not in the log and cannot win this. Correct: they were not bought at the auction.
 *   - A board opened LATE has a partial log, so this measures the last pick it actually watched. The
 *     award is skipped entirely on an empty log rather than guessing from roster order, which carries
 *     no chronology at all.
 *
 * Managers are scanned in board order so a tie resolves the same way on every render.
 */
function loser(state: LeagueState, sales: readonly SaleEvent[]): Award | null {
  const lastOf = new Map<string, SaleEvent>()
  for (const sale of sales) {
    const held = lastOf.get(sale.manager)
    if (held === undefined || sale.seq > held.seq) lastOf.set(sale.manager, sale)
  }

  let best: { manager: ManagerState; sale: SaleEvent } | null = null
  for (const manager of state.managers) {
    const sale = lastOf.get(manager.name)
    if (sale === undefined) continue
    if (best === null || sale.price > best.sale.price) best = { manager, sale }
  }

  // A $1 final pick is thrift, not a punchline.
  if (best === null || best.sale.price <= league.minBid) return null
  return {
    key: 'loser',
    title: 'LOOOO-SER',
    manager: best.manager.name,
    detail: `$${best.sale.price} on their last pick — ${best.sale.player}`,
  }
}

/** The most lopsided roster: the largest count at any single position. */
function hoarder(state: LeagueState): Award | null {
  let best: { manager: ManagerState; position: string; count: number } | null = null
  for (const manager of state.managers) {
    for (const position of league.positions) {
      const count = manager.positionCounts[position] ?? 0
      if (best === null || count > best.count) best = { manager, position, count }
    }
  }
  if (best === null || best.count < 4) return null
  return {
    key: 'hoarder',
    title: `${best.position} HOARDER`,
    manager: best.manager.name,
    detail: `${best.count} of them`,
  }
}

/**
 * In a fixed order, so the screen reads the same way every year, and ties resolve deterministically:
 * each award scans managers in board order and keeps the FIRST of an equal-highest, so re-rendering
 * cannot shuffle who won.
 */
export function awards(state: LeagueState, sales: readonly SaleEvent[] = []): Award[] {
  return [bigSpender(state), loser(state, sales), bargainBin(state), hoarder(state)].filter(
    (award): award is Award => award !== null,
  )
}
