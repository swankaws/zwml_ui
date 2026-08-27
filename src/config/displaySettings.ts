/**
 * Display settings, resolved from the SETTINGS tab / URL / built-in defaults
 * (docs/DESIGN.md sections 7.1, 7.5 and 9).
 *
 * Why this exists: the projector is not available until the day before the draft,
 * so §7.1's type arithmetic cannot be confirmed while layout rework is still
 * cheap. Every knob the on-site spike might want to turn therefore has to be
 * reachable *without a rebuild* -- because a rebuild that late costs a Pages
 * deploy plus up to 10 minutes of CDN propagation (§10), on the night.
 *
 * This module is deliberately pure: no fetch, no DOM, no React. It parses and
 * validates, and phase 4's sheet client supplies the grid. That split is what
 * lets the whole precedence chain be unit-tested with no network at all.
 *
 * Read the ceiling in §7.1 before reaching for `scale`: at 1080p with twelve rows
 * the type is bound by ROW HEIGHT, not by width or by this multiplier, so `scale`
 * has only ~15% of usable headroom before glyphs start clipping. Measured, in the
 * table in §7.1. `columns` and `rail` free up *width*, which is not the scarce
 * axis at 1080p -- they matter at other resolutions and they are what keeps a
 * raised `scale` legible rather than cramped.
 */

import { COLUMNS, type ColumnKey } from '../ui/columns'
import { clampScale } from '../ui/useDisplayScale'
import { league } from './league'

export interface DisplaySettings {
  /** Root type multiplier. `null` = leave it to the operator's keys / default 1. */
  scale: number | null
  /**
   * Force an exact column set, bypassing the priority system. `null` = let the
   * priority system choose, which is what it is for.
   */
  columns: readonly ColumnKey[] | null
  /** Show the nomination + sales rail at all. */
  rail: boolean
  /**
   * The in-draft moments (§7.3). The kill switch.
   *
   * A full-screen overlay covers the board, and the roster-full one covers it for 30 seconds. If that
   * turns out to be wrong in the room, it has to be switchable from a phone in the moment -- not by a
   * deploy and a CDN wait.
   */
  eggs: boolean
  /** Nomination order (§7.5). `null` = fall back to `league.nominationOrder`. */
  order: readonly string[] | null
  /**
   * Which palette. `null` = dark, which is what §7.7 argues for and what every measurement in
   * this project was taken against.
   *
   * It is settable because §7.7's argument is a prediction, not a measurement: "projector bulbs
   * wash out dark-on-white" is true of some rooms and some bulbs, and the projector is not
   * available until the day before the draft. A dim or low-contrast bulb can make light-on-dark
   * the harder read, and finding that out at 7pm with no way to change it would be the expensive
   * version of being wrong.
   */
  theme: 'dark' | 'light' | null
}

export const DEFAULT_SETTINGS: DisplaySettings = {
  scale: null,
  columns: null,
  rail: true,
  eggs: true,
  order: null,
  theme: null,
}

/**
 * A1 of the SETTINGS tab must read this, exactly (case- and space-insensitively).
 *
 * Not decoration -- it is the guard against the nastiest failure mode available to
 * this design. §5.2 verified that gviz's `&sheet=<name>` selector answers
 * `status:"ok"` with the WRONG TAB's data when the name does not match, so a
 * renamed or misspelled SETTINGS tab would otherwise hand this parser the auction
 * grid and let it apply whatever happened to look like a key. With the anchor, a
 * wrong tab yields zero settings and one loud warning, and the defaults stand.
 */
export const SETTINGS_ANCHOR = 'zwml settings'

export interface ParseResult {
  settings: Partial<DisplaySettings>
  warnings: string[]
}

/*
 * Lowercase spelling -> the real key. Nobody hand-typing a spreadsheet cell is
 * going to reproduce `maxBid`'s capital B, and a settings tab that silently
 * ignores `maxbid` is a settings tab that fails at 7pm.
 */
const COLUMN_KEYS = new Map<string, ColumnKey>(COLUMNS.map((c) => [c.key.toLowerCase(), c.key]))
const PROTECTED: ColumnKey[] = COLUMNS.filter((c) => c.priority === 1).map((c) => c.key)

/**
 * Parses a two-column `key | value` grid. Position-independent by design: blank
 * rows, reordered rows and extra columns are all fine, which is also what makes
 * this safe to read over gviz if `/export` is unavailable -- gviz's empty-row
 * collapsing (§5.0) shifts row indices, and nothing here depends on them.
 *
 * Unknown keys are ignored with a warning rather than treated as errors. Someone
 * will put a note in this tab, and a comment must not take the board down.
 */
export function parseSettingsGrid(
  rows: readonly (readonly string[])[],
  roster: readonly string[] = league.managers,
): ParseResult {
  const warnings: string[] = []

  /*
   * A blank tab is not a wrong tab, and must not warn.
   *
   * The anchor below exists to catch gviz handing us the auction grid, and the
   * auction grid is never empty. A freshly created `Settings` tab, on the other
   * hand, is empty by definition -- which is the normal state between "create the
   * tab so its gid can be committed" and "fill it in". Warning about that on every
   * poll would teach whoever is watching to ignore warnings, on the one night the
   * warnings matter.
   */
  if (rows.every((row) => row.every((cell) => cell.trim() === ''))) {
    return { settings: {}, warnings: [] }
  }

  const anchor = (rows[0]?.[0] ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (anchor !== SETTINGS_ANCHOR) {
    return {
      settings: {},
      warnings: [
        `SETTINGS tab anchor missing: A1 is "${rows[0]?.[0] ?? ''}", expected "${SETTINGS_ANCHOR}". ` +
          'Ignoring the whole tab -- this is most likely the wrong tab (see DESIGN.md 5.2).',
      ],
    }
  }

  const settings: Partial<DisplaySettings> = {}

  for (const row of rows.slice(1)) {
    const key = (row[0] ?? '').trim().toLowerCase()
    const raw = (row[1] ?? '').trim()
    if (key === '' && raw === '') continue
    if (key === '') continue

    switch (key) {
      case 'scale': {
        const parsed = Number.parseFloat(raw)
        if (Number.isNaN(parsed)) {
          warnings.push(`SETTINGS: scale "${raw}" is not a number; ignoring.`)
        } else {
          const clamped = clampScale(parsed)
          if (clamped !== parsed) {
            warnings.push(`SETTINGS: scale ${parsed} clamped to ${clamped}.`)
          }
          settings.scale = clamped
        }
        break
      }

      case 'columns': {
        const requested = splitList(raw)
        if (requested.length === 0) {
          warnings.push('SETTINGS: columns is empty; leaving the priority system in charge.')
          break
        }
        const unknown = requested.filter((c) => !COLUMN_KEYS.has(c))
        if (unknown.length > 0) {
          warnings.push(
            `SETTINGS: unknown column(s) ${unknown.join(', ')}; ignoring the columns setting. ` +
              `Valid keys: ${[...COLUMN_KEYS.values()].join(', ')}.`,
          )
          break
        }
        const resolved = requested.map((c) => COLUMN_KEYS.get(c) as ColumnKey)
        settings.columns = withProtected(resolved, warnings)
        break
      }

      case 'rail': {
        const value = parseBoolean(raw)
        if (value === null) warnings.push(`SETTINGS: rail "${raw}" is not on/off; ignoring.`)
        else settings.rail = value
        break
      }

      case 'theme': {
        const value = raw.trim().toLowerCase()
        if (value === 'light' || value === 'dark') settings.theme = value
        else warnings.push(`SETTINGS: theme "${raw}" is not light/dark; ignoring.`)
        break
      }

      case 'eggs': {
        const value = parseBoolean(raw)
        if (value === null) warnings.push(`SETTINGS: eggs "${raw}" is not on/off; ignoring.`)
        else settings.eggs = value
        break
      }

      /*
       * Retired, and recognised only so it does not warn.
       *
       * `$/SLOT` was removed -- it moved with nomination order rather than with the market -- but the
       * live SETTINGS tab may well still carry a `perslot` row, and the alternative to swallowing it is
       * an amber `unknown key` notice on the wall on draft night for a setting that no longer exists.
       * Silence is the kinder failure here; the row simply does nothing.
       */
      case 'perslot':
      case '$/slot':
        break

      case 'order': {
        const result = parseOrder(raw, roster)
        warnings.push(...result.warnings)
        if (result.order) settings.order = result.order
        break
      }

      default:
        warnings.push(`SETTINGS: ignoring unrecognized key "${row[0]}".`)
    }
  }

  return { settings, warnings }
}

/**
 * The same keys, from the query string: `?scale=1.1&columns=manager,maxBid&rail=off`.
 *
 * This is the layer that needs nothing at all to work -- no sheet, no network, no
 * gid, no deploy. If the projector evening goes badly and the sheet is unreachable
 * or fumbled, a URL typed into the address bar still fixes the wall, which is why
 * it sits above the sheet in the precedence below.
 */
export function settingsFromQuery(
  search: string,
  roster: readonly string[] = league.managers,
): ParseResult {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const rows: string[][] = [[SETTINGS_ANCHOR]]
  for (const key of ['scale', 'columns', 'rail', 'eggs', 'order', 'theme']) {
    const value = params.get(key)
    if (value !== null) rows.push([key, value])
  }
  return parseSettingsGrid(rows, roster)
}

/**
 * True when `?columns=` is what set the column list, in which case it is an in-room
 * override and outranks the fit test (see `SelectOptions.forcedFrom`).
 *
 * `resolveSettings` merges the layers into one object and loses which one won, so
 * this asks the query directly -- the same shape as `scalePinnedByQuery`, and for the
 * same reason: the query is the only layer whose author can see the screen.
 */
export function columnsPinnedByQuery(search: string): boolean {
  return new URLSearchParams(search.replace(/^\?/, '')).get('columns') !== null
}

/**
 * Later sources win. Order is deliberate:
 *
 *   defaults  <  SETTINGS tab  <  query string
 *
 * The sheet is the durable, phone-editable, shared source, so it beats the
 * defaults. The URL beats the sheet because it is the in-room override -- whoever
 * is standing at the projector can see the wall, and nobody editing a spreadsheet
 * from the couch can. `scale` has a third layer above both, the `+`/`-` keys
 * (useDisplayScale), for the same reason; `0` clears that nudge and hands control
 * back to the sheet.
 */
export function resolveSettings(...layers: readonly Partial<DisplaySettings>[]): DisplaySettings {
  let resolved = { ...DEFAULT_SETTINGS }
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) resolved = { ...resolved, [key]: value }
    }
  }
  return resolved
}

/** Comma-, space- or `>`-separated. `>` because that is how the sheet writes an order. */
function splitList(raw: string): string[] {
  return raw
    .split(/[,>\n]|\s{2,}/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
}

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase()
  if (['on', 'true', 'yes', '1', 'y'].includes(value)) return true
  if (['off', 'false', 'no', '0', 'n'].includes(value)) return false
  return null
}

/**
 * A forced set still cannot drop MANAGER or MAX BID. The priority-1 columns are
 * priority 1 for a reason (§7.2), and "the operator asked for it" is not a good
 * enough reason to put a board on the wall that cannot answer who can bid what.
 */
function withProtected(requested: ColumnKey[], warnings: string[]): ColumnKey[] {
  const missing = PROTECTED.filter((key) => !requested.includes(key))
  if (missing.length > 0) {
    warnings.push(`SETTINGS: columns must include ${missing.join(', ')}; added back.`)
  }
  return [...requested, ...missing]
}

/**
 * Twelve names, validated against the roster. Aliases are honoured and case is
 * ignored, but an unrecognized name rejects the WHOLE order rather than dropping
 * one name: a partial rotation is a wrong rotation, and silently skipping a
 * manager on the wall is worse than falling back to the committed copy (§7.5).
 */
export function parseOrder(
  raw: string,
  roster: readonly string[] = league.managers,
  /**
   * Which source this order came from, for the warning text.
   *
   * It used to be hard-coded as `SETTINGS:` for every caller, and `resolveNominationOrder` calls this
   * for cell A1 and for the committed fallback too -- so a problem in A1 told the room to go and look at
   * the SETTINGS tab. On the 2025 board that produced two near-identical amber lines side by side, both
   * blaming a tab that neither had come from.
   */
  source = 'SETTINGS',
): { order: readonly string[] | null; warnings: string[] } {
  const warnings: string[] = []
  const parts = raw
    .split(/[,>\n]|\s{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return { order: null, warnings }

  /*
   * `roster` defaults to the committed list but is meant to be the roster parsed
   * from the sheet. That matters more than it looks: this function rejects the whole
   * order on an unknown name, so validating against a stale committed list would
   * reject a *correct* order the moment the league changes a manager -- and the
   * fallback it drops to would be the equally stale committed order. The sheet knows
   * who is playing; ask it.
   */
  const canonical = new Map<string, string>()
  for (const name of roster) canonical.set(name.toLowerCase(), name)
  for (const [alias, name] of Object.entries(league.aliases)) {
    // Only honour an alias whose target is actually on this roster.
    if (canonical.has(name.toLowerCase())) canonical.set(alias.toLowerCase(), name)
  }

  const resolved: string[] = []
  for (const part of parts) {
    const name = canonical.get(part.toLowerCase())
    if (name === undefined) {
      warnings.push(
        `${source}: "${part}" is not a known manager, so this order is not being used.`,
      )
      return { order: null, warnings }
    }
    resolved.push(name)
  }

  const duplicates = resolved.filter((name, index) => resolved.indexOf(name) !== index)
  if (duplicates.length > 0) {
    warnings.push(
      `${source}: ${[...new Set(duplicates)].join(', ')} appear(s) more than once in the order; ` +
        'ignoring it and using the committed copy.',
    )
    return { order: null, warnings }
  }

  /*
   * Short of twelve is a warning, not a rejection. The rotation still works -- it
   * just excludes whoever is missing, which is a visible, self-explaining state on
   * the wall, unlike a silently reordered rotation.
   */
  if (resolved.length !== roster.length) {
    warnings.push(
      `${source}: order lists ${resolved.length} of ${roster.length} managers. ` +
        'Using it as given; the rest will not nominate.',
    )
  }

  return { order: resolved, warnings }
}
