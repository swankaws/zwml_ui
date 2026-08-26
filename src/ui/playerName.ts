/**
 * Fitting a player's name into a fixed number of characters (docs/DESIGN.md 7.4).
 *
 * The roster view shows twelve managers' full squads at once, which is up to 180 names on
 * a 1920px wall. There is no arrangement in which every name fits at a legible size, so
 * names have to degrade -- and HOW they degrade decides whether the room can still read
 * the board. The rule the maintainer set: shorten the first name to an initial, then eat
 * into the last name from the end, and fall back to initials for the pathological cases.
 *
 * Degrading in that order is not arbitrary. A surname carries almost all of the
 * identifying information in this context -- everyone in the room knows who `Barkley` is
 * and nobody needs `Saquon` -- so the first name is the cheapest thing to spend. The last
 * name is spent only after the first is gone, and its beginning is kept because that is
 * what a reader recognizes.
 *
 * Every rung is measured against the real league data, which turns out to contain more
 * shapes than a naive splitter survives:
 *
 *   Jacory Croskey-Merritt   22 chars, hyphenated SURNAME -- the widest name in either tab
 *   Amon-Ra St.Brown         hyphenated FIRST name, and a period inside the surname
 *   Brian Thomas Jr          a suffix, with no period
 *   JJ F'ing McCarthy        a joke middle token, which the league does use
 *   Ja'Marr Chase            an apostrophe in the first name
 *
 * Pure, and deliberately character-based rather than pixel-based: the caller measures once
 * to learn its budget in characters, and the type here is tabular-figure monospace-ish
 * enough at display sizes that per-glyph measurement would buy nothing for the complexity.
 */

/** Recognized name suffixes. Dropped before the surname is truncated, never after. */
const SUFFIX = /^(?:jr|sr|i{1,3}|iv|v)\.?$/i

const ELLIPSIS = '…'

interface Parts {
  first: string
  /** Joke tokens and genuine middle names alike. The first thing spent. */
  middles: string[]
  last: string
  /** `Jr`, `III`, ... exactly as the sheet spelled it. */
  suffix: string | null
}

export function splitName(name: string): Parts {
  const tokens = name.trim().split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0) return { first: '', middles: [], last: '', suffix: null }

  let suffix: string | null = null
  /*
   * Only ever treated as a suffix when something precedes it. A one-token name that
   * happens to be `V` is that player's whole name, not a numeral hanging off nothing.
   */
  if (tokens.length > 1 && SUFFIX.test(tokens[tokens.length - 1]!)) {
    suffix = tokens.pop()!
  }

  if (tokens.length === 1) return { first: '', middles: [], last: tokens[0]!, suffix }

  const first = tokens.shift()!
  const last = tokens.pop()!
  return { first, middles: tokens, last, suffix }
}

/**
 * Initials of a surname, keeping hyphen structure: `Croskey-Merritt` -> `C-M`.
 *
 * The hyphen survives because it is the one mark that says this is a double-barrelled
 * name rather than a typo, and `C-M` is guessable in a way `CM` is not.
 */
function surnameInitials(last: string): string {
  return last
    .split('-')
    .map((part) => part.trim()[0] ?? '')
    .filter((letter) => letter !== '')
    .join('-')
}

/** `S` from `Saquon`, `A` from `Amon-Ra`, `J` from `Ja'Marr`. */
function initial(first: string): string {
  return first.trim()[0] ?? ''
}

/**
 * The shortest form that still names a person: `J C-M`, then `JC-M` if even that is wide.
 *
 * This is the floor, not a preference. It is reached only when the budget cannot hold an
 * initial plus a few letters of surname -- a twelve-column arrangement on a 4:3 screen, or
 * a phone. Above that budget, truncation wins because partial letters beat initials for
 * recognition.
 */
function initialsForm(parts: Parts, max: number): string {
  const surname = surnameInitials(parts.last)
  const lead = initial(parts.first)
  const spaced = lead === '' ? surname : `${lead} ${surname}`
  if (spaced.length <= max) return spaced

  const tight = `${lead}${surname}`
  if (tight.length <= max) return tight

  // Nothing legible fits. Hand back the hardest-cut surname rather than an empty cell.
  return tight.slice(0, Math.max(1, max))
}

/**
 * Truncate a surname from the end, spending one character on the ellipsis.
 *
 * Returns `null` when the budget is too small to leave a recognizable stem -- fewer than
 * three letters plus the ellipsis is noise, and the caller should drop to initials instead.
 */
function clipSurname(last: string, max: number): string | null {
  if (max >= last.length) return last
  const stem = max - 1
  if (stem < 3) return null
  return `${last.slice(0, stem)}${ELLIPSIS}`
}

/**
 * The best rendering of `name` within `max` characters.
 *
 * Rungs, in order, each tried only when the one above it does not fit:
 *
 *   1. `Saquon Barkley`      exactly as the sheet spells it
 *   2. `JJ McCarthy`         middle tokens dropped -- least information, most width
 *   3. `S. Barkley`          first name to an initial
 *   4. `B. Thomas`           suffix dropped
 *   5. `J. Croskey-Mer` +    surname eaten from the end
 *   6. `J C-M`               initials, the floor
 */
export function fitPlayerName(name: string, max: number): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (max <= 0) return ''
  if (trimmed.length <= max) return trimmed

  const parts = splitName(trimmed)
  const suffix = parts.suffix === null ? '' : ` ${parts.suffix}`

  // 2. Drop middle tokens. `JJ F'ing McCarthy` -> `JJ McCarthy` keeps the real first name,
  //    which rung 3 would have thrown away for a single letter.
  if (parts.middles.length > 0) {
    const dropped = `${parts.first} ${parts.last}${suffix}`.trim()
    if (dropped.length <= max) return dropped
  }

  const lead = initial(parts.first)
  const abbreviated = lead === '' ? parts.last : `${lead}. ${parts.last}`

  // 3. First name to an initial, suffix retained.
  if (`${abbreviated}${suffix}`.length <= max) return `${abbreviated}${suffix}`
  // 4. Then without the suffix.
  if (abbreviated.length <= max) return abbreviated

  // 5. Eat into the surname. The lead and its `. ` are already paid for.
  const prefix = lead === '' ? '' : `${lead}. `
  const clipped = clipSurname(parts.last, max - prefix.length)
  if (clipped !== null) return `${prefix}${clipped}`

  // 6. Initials.
  return initialsForm(parts, max)
}
