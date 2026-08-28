/**
 * Recorder tags in the player cell (docs/DESIGN.md 7.3).
 *
 * The person entering picks types a marker into the name -- `Josh Allen (h)` -- and the board turns it into
 * a moment. It is the cheapest possible input: no extra column to add to the sheet, no second tab to keep in
 * step, and nothing to remember when the room is loud.
 *
 * STRIPPED AT THE PARSE BOUNDARY, which is the whole design decision here. The tag is removed the moment the
 * cell is read, so `Pick.player` -- and therefore every slot, every sale, the ticker, the history and the
 * roster -- only ever holds the clean name. The alternative was stripping at each display site, which is four
 * places today and however many the next view adds; the first one anybody forgets shows `Josh Allen (h)` on
 * the wall. Carrying the tags alongside the name costs one field and cannot be forgotten.
 *
 * A TABLE, so another marker is a line of data rather than a new `MomentKind` and a switch arm in two files.
 */

export interface PlayerTag {
  /** The letter inside the parentheses, lower case. */
  tag: string
  /**
   * The joke, and the only thing the room reads. Upper case to match the other moments' headlines.
   *
   * There is deliberately no per-tag BANNER here: the small line above the headline is one shared string
   * (`TAG_LABEL` in `MomentOverlay`), so every tag moment reads the same way by construction rather than by
   * somebody remembering to keep them in step.
   */
  headline: string
  /** Clips to choose between, so the same joke twice in a night is not the same picture twice. */
  clips: readonly string[]
}

export const PLAYER_TAGS: readonly PlayerTag[] = [
  { tag: 'h', headline: 'HOMER', clips: ['homer_1.gif', 'homer_2.gif', 'homer_3.gif', 'homer_4.gif'] },
  { tag: 'd', headline: 'DICK MOVE', clips: ['dick_move_1.gif', 'dick_move_2.gif'] },
]

/**
 * Any `(x)` group, anywhere in the cell, with any spacing.
 *
 * Deliberately broad about WHERE: a recorder typing fast may land it before the name, after it, or with no
 * space. Deliberately narrow about WHAT: one or two letters only, so a genuine parenthetical in a name --
 * `Robert Griffin (III)` is not real, but `(Jr)` and `(IV)` are the shape of thing that appears in a
 * spreadsheet -- is not silently eaten. Unknown letters are stripped as well as known ones, because a typo'd
 * tag reaching the wall as part of a player's name is worse than a tag that simply does nothing.
 */
const TAG_GROUP = /\s*\(([A-Za-z]{1,2})\)\s*/g

export interface TaggedPlayer {
  /** The name with every tag group removed and whitespace tidied. */
  player: string
  /** Recognised tags, lower-cased, in the order the table lists them. Empty is the ordinary case. */
  tags: readonly string[]
}

export function readTaggedPlayer(raw: string): TaggedPlayer {
  const found = new Set<string>()
  const stripped = raw.replace(TAG_GROUP, (_match, letters: string) => {
    found.add(letters.toLowerCase())
    /*
     * A single space, not nothing: `Josh(h)Allen` would otherwise become `JoshAllen`. The collapse below
     * tidies the leading and trailing cases this leaves behind.
     */
    return ' '
  })

  return {
    player: stripped.replace(/\s+/g, ' ').trim(),
    /* Table order, not typing order, so two tags on one pick always resolve to the same moment. */
    tags: PLAYER_TAGS.filter((entry) => found.has(entry.tag)).map((entry) => entry.tag),
  }
}

/** The table entry for a tag, or `null`. */
export function playerTagFor(tag: string): PlayerTag | null {
  return PLAYER_TAGS.find((entry) => entry.tag === tag.toLowerCase()) ?? null
}

/** The first recognised tag on a pick, which is the one that gets the moment. */
export function firstTagOf(tags: readonly string[]): PlayerTag | null {
  for (const tag of tags) {
    const entry = playerTagFor(tag)
    if (entry !== null) return entry
  }
  return null
}
