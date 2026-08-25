/**
 * The nomination window (docs/DESIGN.md sections 7.2, 7.5).
 *
 * The order rotates strictly and a manager whose roster is full is skipped, so
 * "who is up next" is not simply the next name in the list. Section 7.2's vertical
 * budget only affords five live nominators in the rail, which makes this a window
 * over the order rather than a render of the whole thing.
 *
 * Skipped managers are still shown, struck through: the room knows the order by
 * heart, and a name silently vanishing reads as a bug, not as "their roster is
 * full".
 */

export interface NominationEntry {
  name: string
  /** Roster full -- cannot nominate. Rendered struck through, not hidden. */
  full: boolean
  /** The one nominating right now. */
  onClock: boolean
}

export interface WindowOptions {
  /** Configured order. Empty until the league sets it (Q14). */
  order: readonly string[]
  /** Full rosters are skipped. Unknown names are treated as able to nominate. */
  isFull: (name: string) => boolean
  /** Position in `order` to start scanning from -- derived from the sale count. */
  cursor: number
  /** How many nominators to show. Five is what 7.2's vertical budget affords. */
  liveCount?: number
  /**
   * Hard cap on rendered lines, skips included. The rail has a fixed height and
   * cannot negotiate: see below.
   */
  maxEntries?: number
}

/**
 * Returns entries from `cursor` forward, wrapping, until `liveCount` managers who
 * can actually nominate have been collected. Full managers encountered along the
 * way are included but do not count toward the total.
 *
 * Empty means *nobody can nominate* -- the draft is over. That is distinct from an
 * empty `order`, which means the order was never configured, and the two want very
 * different things on screen.
 */
export function nominationWindow(options: WindowOptions): NominationEntry[] {
  const { order, isFull, cursor, liveCount = 5, maxEntries = liveCount + 1 } = options
  if (order.length === 0 || liveCount <= 0) return []

  const entries: NominationEntry[] = []
  let live = 0
  // At most one full lap: when every roster is full the draft is over, and an
  // unbounded scan for a nominator who does not exist would spin forever.
  for (let step = 0; step < order.length && live < liveCount; step += 1) {
    const index = (((cursor + step) % order.length) + order.length) % order.length
    const name = order[index]
    if (name === undefined) continue

    const full = isFull(name)
    /*
     * Skips are shown, but not without limit. Late in the draft most of the field
     * is full, and an uncapped window rendered all twelve names struck through --
     * which is both the rail over-subscription 7.2 exists to prevent and useless
     * information, since the table already says FULL for every one of them.
     */
    if (full && entries.length >= maxEntries) continue

    entries.push({ name, full, onClock: !full && live === 0 })
    if (!full) live += 1
  }

  // Nobody eligible anywhere in the order: report that, rather than a list of
  // crossed-out names that looks like a rendering fault.
  return live === 0 ? [] : entries
}

/*
 * NOT here: deriving the cursor from the sale count.
 *
 * `saleCount % order.length` is the obvious formula and it is wrong. Full managers
 * are skipped without consuming a nomination, so after anyone fills up the raw
 * position and the number of sales diverge -- the board would put a manager who
 * just nominated back on the clock.
 *
 * Replaying the rotation against *current* fullness does not fix it either: a
 * manager who is full now still nominated earlier, so the replay skips turns that
 * really happened and over-advances by exactly that many.
 *
 * The cursor has to be replayed chronologically, with the roster state as it was
 * at each sale, which needs the ordered sale sequence the phase-5 diff engine
 * produces. Phase 6 owns it. Until then the cursor is passed in.
 */
