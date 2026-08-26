/**
 * The diff engine: consecutive parses -> a chronological sale log (docs/DESIGN.md 7.3).
 *
 * The sheet records no timestamps and no global pick order, so "what just sold" and
 * "whose turn is it" are not answerable from one snapshot. Both come from watching
 * values change between polls. Pure: no clock, no DOM, no fetching. Everything it
 * returns is JSON-serializable, because 7.5 persists `(order, baseline, saleLog)` and a
 * `Map` or a class instance would have to be rewritten to get there.
 *
 * WHY SLOTS ARE ADDRESSED GEOMETRICALLY, not by manager name.
 *
 * 7.3's rule is "match on manager + slot, not on player name", and the literal reading
 * -- key on the manager's name plus the roster row -- has a failure this league has
 * already had once. The name cell is editable and it does get edited: `Nick` became
 * `Kris` on 2026-08-25. Keyed by name, that single cell edit reads as fifteen slots
 * disappearing and fifteen appearing, i.e. fifteen phantom sales, a ticker full of
 * players who sold weeks ago, and a nomination pointer fifteen managers along.
 *
 * `${col}:${row}` cannot do that. Both come from the grid geometry, which 5.3 fixes for
 * the season -- no rows are inserted mid-draft -- and a band's four blocks have distinct
 * `col`s while different bands have distinct `row`s, so the pair is unique workbook-wide.
 * The manager's name is then just a display field, read from the block at the moment the
 * sale is observed.
 *
 * This also means the engine works on `ManagerBlock[]` rather than on `LeagueState`.
 * `deriveLeague` keys managers by name and drops a block whose name cell is blank
 * (derive.ts:150), and a diff that cannot see a block cannot tell "this manager left" from
 * "these fifteen picks were deleted".
 */

import { league, type Position } from '../config/league'
import type { ManagerBlock } from '../data/gridParser'

/**
 * One filled roster row, as it looked on some poll.
 *
 * `manager` is denormalized on purpose: a sale has to name a buyer forever, and the
 * block's name cell can change afterwards. What the wall said when it sold is the truth
 * about that sale.
 */
export interface SlotState {
  player: string
  price: number
  manager: string
  position: Position | null
  /** The price cell did not parse and was read as $0 (gridParser). Held back -- see below. */
  suspect: boolean
}

/** Serializable slot map, addressed `${col}:${row}`. This is 7.5's `baseline`. */
export type SlotMap = Record<string, SlotState>

export interface SaleEvent {
  /** `${col}:${row}`. Identity, and what a later price correction is matched on. */
  slot: string
  player: string
  price: number
  manager: string
  position: Position | null
  /** 1-based observation order. The pointer counts these; the ticker sorts by them. */
  seq: number
}

export interface DiffResult {
  /** New sales, in the order the slots appear in the grid. Empty is the common case. */
  sales: SaleEvent[]
  /**
   * Slots whose player or price changed after the fact, and the corrected values.
   *
   * NOT new sales. 7.3: "A price edited after the fact produces an update, not a
   * duplicate sale". The caller rewrites the matching entry where it sits in the log
   * rather than appending, so a typo fix does not re-announce a player who sold an hour
   * ago and does not advance the pointer a second time.
   */
  corrections: SaleEvent[]
  /**
   * Slots that went from filled to empty.
   *
   * Kept as a distinct outcome rather than deleting history: 7.5 requires the pointer to
   * be *recomputed from the sale log* after any correction, and 5.11 makes the same
   * argument for the durable log -- "an append-only event stream, not state". The caller
   * drops the retracted entry from the log and recomputes; it never patches the pointer.
   */
  retracted: string[]
}

/**
 * Every filled slot in this parse.
 *
 * A blank player cell or a blank price emits no `Pick` at all (gridParser: `collect`
 * skips both), so this map is sparse and an empty roster row is an *absence*. That is
 * what makes "a player appeared where nothing was" observable, and it is also why a
 * half-typed row -- a name with no price yet -- cannot produce a sale: the parser has
 * already hidden it.
 */
export function snapshotSlots(blocks: readonly ManagerBlock[]): SlotMap {
  const slots: SlotMap = {}
  for (const block of blocks) {
    const manager = block.name ?? block.rawName.trim()
    /*
     * A block with no name at all is skipped entirely. Its picks are real, but a sale
     * has to be attributable -- `$61 -> (nobody)` on the wall is worse than silence --
     * and `ui/Notices.tsx` is already telling the room about the blank name cell.
     */
    if (manager === '') continue
    for (const pick of block.picks) {
      slots[`${block.col}:${pick.row}`] = {
        player: pick.player,
        price: pick.price,
        manager,
        position: pick.position,
        suspect: pick.priceSuspect,
      }
    }
  }
  return slots
}

/**
 * Is this slot worth announcing yet?
 *
 * A price the parser could not read becomes `$0` with `priceSuspect` set, and a lone `-`
 * in the price column reads as a legitimate `$0` (normalize.ts) -- so the sheet has two
 * ways to hold a player at no price, and neither is a sale. Held back rather than
 * dropped: the slot stays out of the log until a poll gives it a real price, at which
 * point it is announced once, correctly. The cost is up to one poll of latency on a
 * genuine data error; the benefit is that `$0 -> Kevin` never reaches the wall and the
 * nomination pointer never advances on a half-finished row.
 */
function creditable(slot: SlotState): boolean {
  return !slot.suspect && slot.price >= league.minBid
}

/**
 * Compare two parses. `previous` is the baseline (7.5) -- on the first poll of a session
 * that is everything already in the sheet, which is why keepers correctly never appear as
 * sales.
 *
 * `nextSeq` is the sequence number the first new sale should carry, i.e. one past the
 * highest already in the log.
 */
export function diffSlots(previous: SlotMap, next: SlotMap, nextSeq: number): DiffResult {
  const sales: SaleEvent[] = []
  const corrections: SaleEvent[] = []
  const retracted: string[] = []

  let seq = nextSeq
  for (const [slot, state] of Object.entries(next)) {
    const before = previous[slot]

    if (before === undefined) {
      // Nothing was here. A creditable price makes it a sale; anything else waits.
      if (creditable(state)) sales.push({ slot, seq: seq++, ...display(state) })
      continue
    }

    /*
     * The slot was already occupied. Three sub-cases, and only one of them is a sale:
     * a slot that was held back for want of a price finally gets one. The parser gives
     * us no way to distinguish "the same player, repriced" from "a different player at
     * the same desk", and it does not matter -- 7.3 says match on the slot, so both are
     * an update to what sold there.
     */
    if (!creditable(before) && creditable(state)) {
      sales.push({ slot, seq: seq++, ...display(state) })
      continue
    }
    if (!creditable(state)) {
      // Went from a real price back to $0 or unparseable: the sale is being undone.
      if (creditable(before)) retracted.push(slot)
      continue
    }
    if (before.player !== state.player || before.price !== state.price) {
      // seq 0 is a placeholder: the caller keeps the entry's original sequence, since
      // this is the same sale with better information, not a later one.
      corrections.push({ slot, seq: 0, ...display(state) })
    }
  }

  for (const [slot, state] of Object.entries(previous)) {
    if (next[slot] === undefined && creditable(state)) retracted.push(slot)
  }

  return { sales, corrections, retracted }
}

function display(state: SlotState): Omit<SaleEvent, 'slot' | 'seq'> {
  return {
    player: state.player,
    price: state.price,
    manager: state.manager,
    position: state.position,
  }
}

/**
 * Fold a diff into a sale log. Pure, returns a new array, and returns the *same* array
 * when nothing changed -- `boardStore` publishes this straight into a snapshot the error
 * boundary uses as its reset key, so a gratuitously fresh reference is not free
 * (see boardStore's note on `equivalent`).
 *
 * NOT capped. 7.3 says "the queue is capped (8 entries); no unbounded array over a
 * 4-hour session", and the cap is wrong where it is aimed: 7.5 requires the pointer to
 * be recomputed from the whole log, which a truncated log cannot support, and the log is
 * bounded by construction anyway at twelve managers x fifteen slots = 180 entries. So 8
 * survives as what the *ticker shows* (`ui/Rail.tsx`), not as what the log keeps.
 */
export function applyDiff(log: readonly SaleEvent[], diff: DiffResult): readonly SaleEvent[] {
  if (diff.sales.length === 0 && diff.corrections.length === 0 && diff.retracted.length === 0) {
    return log
  }

  const dropped = new Set(diff.retracted)
  const corrected = new Map(diff.corrections.map((event) => [event.slot, event]))

  const kept = log
    .filter((event) => !dropped.has(event.slot))
    .map((event) => {
      const fix = corrected.get(event.slot)
      return fix === undefined ? event : { ...fix, seq: event.seq }
    })

  return [...kept, ...diff.sales]
}

/** Highest sequence issued so far, so the next poll continues rather than restarts. */
export function nextSequence(log: readonly SaleEvent[]): number {
  return log.reduce((max, event) => Math.max(max, event.seq), 0) + 1
}
