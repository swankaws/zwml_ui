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
  /**
   * Bonus money awarded on draft night, from the sheet. `0` for 2025 and for any manager who has
   * not been awarded any.
   *
   * It is real budget: `remaining = league.budget + bonus - spent`, so MAX BID rises with it and the
   * $200 cap becomes a $200-plus-bonus cap for that manager. Kept on the state rather than folded
   * silently into `remaining` so the board can SAY why someone has more money than the others --
   * a manager showing more than $200 left with nothing explaining it reads as a broken board.
   */
  bonus: number
  /**
   * `budget + bonus - spent`. Never floored at 0 -- historical tabs go negative (section 5.7).
   */
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
  /**
   * Names appearing in more than one block. Each duplicate costs a row and shrinks
   * `totalSlots`, so it must not pass silently.
   *
   * Both this and `unmatched` are rendered by `ui/Notices.tsx`, which is what keeps
   * DESIGN.md 5.5 and 6's promise that they are *visible*. Through phase 3 they reached
   * the console only, and nobody reads a console during an auction.
   */
  duplicated: string[]
  leagueSpent: number
  /** Sum of bonus money awarded (2026). `0` until the league runners award any. */
  leagueBonus: number
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
  const { minBid, auctionSlots } = league
  const picks = block.picks
  /*
   * The budget is PER MANAGER now, not a league constant.
   *
   * Bonus money (2026) is added rather than tracked separately, because every number downstream
   * wants the combined figure: `maxBid` falls out correctly with no change, the overspend check
   * becomes a $200-plus-bonus cap for that manager on its own, and `leagueRemaining` picks it up for
   * free. A negative bonus -- a penalty -- works the same way in reverse.
   */
  const bonus = block.bonus
  const budget = league.budget + bonus

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
    bonus,
    remaining,
    slotsFilled,
    needs,
    maxBid,
    /*
     * Against this manager's OWN budget, bonus included -- "what share of their money is left",
     * which is the only reading that stays comparable once budgets differ. Denominating on the
     * league's $200 would make a manager with a bonus read as having more than 100%.
     */
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
  /*
   * Keyed by name, which means two cells holding the same name would silently
   * overwrite each other: one manager vanishes from the wall AND the SLOTS
   * denominator quietly shrinks, so the board looks internally consistent while
   * being wrong. That is the same class of failure as the dropped-manager bug above,
   * so it is reported rather than tolerated -- a duplicated name cell is a typo in
   * the sheet, and the person who can fix it is in the room.
   */
  const duplicated: string[] = []
  const byName = new Map<string, ManagerState>()
  for (const block of blocks) {
    const name = block.name ?? block.rawName.trim()
    if (name === '') continue
    if (byName.has(name)) duplicated.push(name)
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
  /*
   * Total bonus in play, so the header can explain itself. Without it, `CHASING` exceeding
   * 12 x $200 looks like an arithmetic bug rather than money the league actually awarded.
   */
  const leagueBonus = managers.reduce((sum, m) => sum + m.bonus, 0)
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
    duplicated,
    leagueSpent,
    leagueBonus,
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
