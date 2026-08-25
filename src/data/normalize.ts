/**
 * Cell-level normalization rules (docs/DESIGN.md section 5.5).
 *
 * Kept separate from the grid walk so each rule is testable in isolation --
 * these are where the sheet's human-entered messiness gets absorbed, and they
 * are the rules most likely to need a tweak on draft night.
 */

import { league, type Position } from '../config/league'

/**
 * Result of reading a price cell. The three cases are deliberately distinct
 * because section 5.3 hangs the slot test on them:
 *
 *   'blank'       -- no price typed yet. NOT a pick. Silent, not an error.
 *   'ok'          -- parsed. A pick at `value`.
 *   'unparseable' -- something is typed but it is not a number. A pick at $0,
 *                    and a warning, because it is a real data problem.
 *
 * Collapsing 'blank' into 'unparseable' is the bug review caught: the
 * commissioner types the player name and the price as two keystrokes, so every
 * sale passes through a blank-price state that a 3 s poll can catch. Treating
 * that as a $0 pick makes the winning bidder's MAX BID flicker by $1.
 */
export type PriceRead =
  | { kind: 'blank' }
  | { kind: 'ok'; value: number }
  | { kind: 'unparseable'; raw: string }

/**
 * Accepts `$10`, `10`, `10.00`, `$1,200`, `(5)` and a bare `-` (a dash is how
 * spreadsheets often render zero). Rejects anything with a non-numeric residue
 * rather than salvaging a leading number, so `12abc` surfaces instead of
 * silently becoming $12.
 */
export function readPrice(raw: string): PriceRead {
  const text = raw.trim()
  if (!text) return { kind: 'blank' }

  // A lone dash or en-dash is a spreadsheet's zero.
  if (/^[-–—]$/.test(text)) return { kind: 'ok', value: 0 }

  // Accounting-style negatives: (5) means -5.
  const parenthesized = /^\((.*)\)$/.exec(text)
  const body = parenthesized?.[1] ?? text

  const cleaned = body.replace(/[$,\s]/g, '').replace(/−/g, '-')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { kind: 'unparseable', raw: text }

  const value = Number(cleaned)
  if (!Number.isFinite(value)) return { kind: 'unparseable', raw: text }

  return { kind: 'ok', value: parenthesized ? -value : value }
}

/** Reads an integer stat cell (`Needs`, position counts). `null` when unusable. */
export function readInt(raw: string): number | null {
  const price = readPrice(raw)
  if (price.kind !== 'ok') return null
  return Number.isInteger(price.value) ? price.value : null
}

const POSITION_ALIASES: Record<string, Position | 'DEF'> = {
  'D/ST': 'DEF',
  DST: 'DEF',
  DEF: 'DEF',
  DEFENSE: 'DEF',
  D: 'DEF',
  PK: 'K',
  KICKER: 'K',
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
}

/**
 * Normalizes a `Pos` cell. Returns `null` for blank or unrecognized values --
 * bench rows legitimately carry no label until a player is typed in, so an
 * absent position is normal rather than an error (section 5.4 step 3).
 */
export function readPosition(raw: string): Position | 'DEF' | null {
  const key = raw.trim().toUpperCase().replace(/\.$/, '')
  if (!key) return null
  return POSITION_ALIASES[key] ?? null
}

/**
 * Resolves a manager name against every name the league knows, applying aliases
 * and ignoring case and surrounding whitespace. Returns `null` for a name the
 * league does not know, which the caller surfaces rather than guessing at.
 *
 * Recognition spans seasons on purpose: `managers` is the *current* twelve, but a
 * past tab legitimately contains whoever played that year, so `pastManagers` is
 * consulted too. Resolving a name is not the same as putting someone in this
 * season's league -- only `managers` decides order, roster length and totals.
 */
const KNOWN_MANAGERS: readonly string[] = [...league.managers, ...league.pastManagers]

export function readManagerName(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const aliased = league.aliases[text] ?? text
  const match = KNOWN_MANAGERS.find((m) => m.toLowerCase() === aliased.toLowerCase())
  if (match) return match

  // Aliases are configured canonically, but tolerate a differently-cased key.
  const aliasKey = Object.keys(league.aliases).find((k) => k.toLowerCase() === text.toLowerCase())
  const target = aliasKey ? league.aliases[aliasKey] : undefined
  if (target) {
    return KNOWN_MANAGERS.find((m) => m.toLowerCase() === target.toLowerCase()) ?? null
  }

  return null
}
