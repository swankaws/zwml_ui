/**
 * ManagerBlock[] + config -> ManagerState[] + LeagueState (docs/DESIGN.md section 6).
 *
 * Pure. No DOM, no fetching, no config reads beyond `league`. This is where the
 * numbers the room actually reads come from, so it is the one module worth being
 * fussy about: `maxBid` is the reason the display exists, and it is the number
 * people get wrong in their heads.
 *
 * We recompute rather than trust the sheet's formulas (D6), but we keep the
 * sheet's own figures alongside ours so any disagreement is visible in the debug
 * overlay instead of silently contradicting the board (section 5.7).
 */

import { league, totalAuctionSlots, type Position } from '../config/league'
import type { ManagerBlock, Pick } from '../data/gridParser'

export interface Disagreement {
  field: 'spent' | 'remaining' | 'needs' | 'maxBid'
  ours: number | null
  sheet: number | null
}

export interface ManagerState {
  name: string
  picks: Pick[]
  spent: number
  /** `budget - spent`. Never floored at 0 -- historical tabs go negative (section 5.7). */
  remaining: number
  slotsFilled: number
  needs: number
  /** `null` when the roster is full: no bid is possible, so render `FULL`. */
  maxBid: number | null
  pctRemaining: number
  /** `null` when the roster is full, for the same reason as `maxBid`. */
  avgPerSlot: number | null
  positionCounts: Record<Position, number>
  overspent: boolean
  overRostered: boolean
  /** Where our numbers and the sheet's differ. Empty is the expected case. */
  disagreements: Disagreement[]
}

export interface LeagueState {
  managers: ManagerState[]
  /** Blocks whose name cell matched no configured manager (surfaced, not dropped). */
  unmatched: string[]
  leagueSpent: number
  /** Dollars that can still chase players -- active managers only. See below. */
  leagueRemaining: number
  leagueNeeds: number
  slotsFilled: number
  totalSlots: number
  /** `null` once every roster is full: there is no pace left to report. */
  avgPerRemainingSlot: number | null
  draftComplete: boolean
}

function emptyCounts(): Record<Position, number> {
  return Object.fromEntries(league.positions.map((p) => [p, 0])) as Record<Position, number>
}

export function deriveManager(block: ManagerBlock & { name: string }): ManagerState {
  const { budget, minBid, auctionSlots } = league
  const picks = block.picks

  const spent = picks.reduce((sum, p) => sum + p.price, 0)
  const remaining = budget - spent
  const slotsFilled = picks.length
  const needs = auctionSlots - slotsFilled

  // max(1, remaining - needs + 1): hold back $1 for each slot still to fill.
  // Verified against the sheet's own Max Bid on live data (section 5.7).
  const maxBid = needs <= 0 ? null : Math.max(minBid, remaining - (needs - 1) * minBid)

  const positionCounts = emptyCounts()
  for (const pick of picks) {
    if (pick.position) positionCounts[pick.position] += 1
  }

  const disagreements: Disagreement[] = []
  const compare = (field: Disagreement['field'], ours: number | null, sheet: number | null) => {
    if (sheet !== null && ours !== null && sheet !== ours) {
      disagreements.push({ field, ours, sheet })
    }
  }
  compare('spent', spent, block.sheet.total)
  compare('remaining', remaining, block.sheet.remaining)
  compare('needs', needs, block.sheet.needs)
  compare('maxBid', maxBid, block.sheet.maxBid)

  return {
    name: block.name,
    picks,
    spent,
    remaining,
    slotsFilled,
    needs,
    maxBid,
    pctRemaining: remaining / budget,
    avgPerSlot: needs > 0 ? remaining / needs : null,
    positionCounts,
    overspent: league.enforceBudgetCap && remaining < 0,
    overRostered: slotsFilled > auctionSlots,
    disagreements,
  }
}

export function deriveLeague(blocks: ManagerBlock[]): LeagueState {
  const unmatched = blocks.filter((b) => b.name === null && b.rawName).map((b) => b.rawName)

  /*
   * A manager the config does not recognize still gets a row, under whatever the
   * sheet calls them.
   *
   * This used to drop them. `league.managers` is a committed list, so a roster
   * change -- someone leaves, someone joins, a name is spelled differently -- meant
   * eleven rows on the wall and no indication that a twelfth person existed. The
   * warning was raised, but warnings are not what the room is looking at.
   *
   * The sheet is the authority on who is in the league: those twelve cells are
   * maintained all season by the person running the draft, and they are the same
   * cells the money is read from. Deferring to them is what makes a roster change
   * need no deploy -- the point of the SETTINGS work in 9.2, applied to names.
   *
   * The wrong-tab guard does not weaken, because it lives in the parser and keys off
   * how many names it *recognized* (gridParser: zero recognized is fatal). A genuinely
   * wrong tab does not contain eleven correct league names and one surprise.
   */
  const byName = new Map<string, ManagerState>()
  for (const block of blocks) {
    const name = block.name ?? block.rawName.trim()
    if (name === '') continue
    byName.set(name, deriveManager({ ...block, name }))
  }

  /*
   * Config order first, so a known roster renders in a stable, familiar order and a
   * missing block just goes absent rather than reshuffling the table. Anyone the
   * config has not heard of follows, in grid order. (The board sorts by max bid for
   * display anyway; this only decides the tie-break and the roster view.)
   */
  const roster: readonly string[] = league.managers
  const known = league.managers.map((n) => byName.get(n)).filter((m): m is ManagerState => !!m)
  const extra = [...byName.values()].filter((m) => !roster.includes(m.name))
  const managers = [...known, ...extra]

  const leagueSpent = managers.reduce((sum, m) => sum + m.spent, 0)
  const leagueNeeds = managers.reduce((sum, m) => sum + m.needs, 0)
  const slotsFilled = managers.reduce((sum, m) => sum + m.slotsFilled, 0)

  /*
   * Two bugs review found here, both in a header that is on screen all night:
   *
   * 1. `leagueRemaining` must sum only over managers who can still bid. A manager
   *    holding $14 with a full roster is holding dead money -- counting it
   *    inflates "dollars still chasing players" exactly when the room is using
   *    that number to judge whether the last players will go cheap.
   * 2. `avgPerRemainingSlot` must guard `leagueNeeds === 0`. It reaches zero the
   *    instant the final slot fills, and the unguarded form renders `$Infinity`
   *    at the most-watched moment of the draft.
   */
  const active = managers.filter((m) => m.needs > 0)
  const leagueRemaining = active.reduce((sum, m) => sum + m.remaining, 0)

  return {
    managers,
    unmatched,
    leagueSpent,
    leagueRemaining,
    leagueNeeds,
    slotsFilled,
    /*
     * Counted from who is actually on the board, not from the committed roster
     * length. The header reads "SLOTS 9/180" all night; if the league ever runs
     * eleven or thirteen managers, a constant 180 is quietly wrong in the one place
     * everyone is looking. Falls back to the constant only for an empty board, so
     * the denominator is never 0.
     */
    totalSlots: managers.length > 0 ? managers.length * league.auctionSlots : totalAuctionSlots,
    avgPerRemainingSlot: leagueNeeds > 0 ? leagueRemaining / leagueNeeds : null,
    draftComplete: managers.length > 0 && leagueNeeds === 0,
  }
}

/** Board default: max bid descending -- the room's real question is who can outbid whom. */
export function sortByMaxBid(managers: ManagerState[]): ManagerState[] {
  return [...managers].sort((a, b) => {
    // FULL rosters sort last; they cannot bid at all.
    if (a.maxBid === null && b.maxBid === null) return a.name.localeCompare(b.name)
    if (a.maxBid === null) return 1
    if (b.maxBid === null) return -1
    return b.maxBid - a.maxBid || a.name.localeCompare(b.name)
  })
}
