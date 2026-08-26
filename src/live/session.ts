/**
 * Surviving a mid-draft reload (docs/DESIGN.md 7.5).
 *
 * The nomination pointer and the sales ticker are both derived from `(baseline, saleLog)`, and
 * both live in memory. So a reload throws them away and the board re-baselines from whatever the
 * sheet holds at that moment: the pointer silently restarts at the top of the order and the
 * ticker forgets the night. That is not a hypothetical -- the watchdog reloads the page on
 * purpose when the feed is broken (8.1), so the recovery mechanism for one failure was quietly
 * causing another.
 *
 * WHY `sessionStorage` RATHER THAN `localStorage`. 7.5 says `localStorage`, and this deliberately
 * does not, because the hazard 7.5 spends most of its words on is a baseline that outlives the
 * session that made it: rehearse on Wednesday, enter six more keepers on Thursday, open the board
 * on Friday, and the restored baseline predates those keepers -- so the diff engine calls them
 * six new sales and the pointer opens the night six managers along, at the moment the room is
 * paying most attention.
 *
 * `sessionStorage` cannot do that. It survives `location.reload()`, which is the case that
 * matters, and dies with the tab, which is the case that hurts. The staleness guards below are
 * kept anyway -- a projector tab left open from Thursday to Saturday is a real thing, and cheap
 * insurance is still worth buying.
 *
 * Everything here is JSON-serializable by construction, which is why `model/diff.ts` uses plain
 * records and arrays rather than a `Map`.
 */

import type { SaleEvent, SlotMap } from '../model/diff'

/**
 * Refused if older than this. 7.5's reasoning: a genuine mid-draft reload is seconds old, so a
 * short window keeps all of the value, while a multi-hour TTL would let projector-open time plus
 * a four-hour draft slip through -- and re-baselining at hour four loses the sale log outright,
 * which is worse than the bug the window exists to prevent.
 */
export const SESSION_MAX_AGE_MS = 30 * 60_000

/** How long the `resynced` notice stays on the wall after a restore absorbed something. */
export const RESYNC_NOTICE_MS = 30_000

export interface SessionRecord {
  /** Refreshed on EVERY successful poll, not only on change -- see `isRestorable`. */
  savedAt: number
  /** Guards against a `?year=` rehearsal poisoning the live tab's session. */
  year: number
  /** Picks each manager held when the auction opened: where the rotation starts. */
  baselineCounts: Record<string, number>
  /**
   * The LAST poll's slots, not the baseline's.
   *
   * This is the subtle one. The diff engine compares each poll against the previous poll, so
   * without this the first poll after a reload would compare against nothing and re-announce
   * every player in the sheet as a fresh sale.
   */
  slots: SlotMap
  saleLog: SaleEvent[]
  /** The operator's `N`/`Shift+N` correction. A reload must not silently undo it. */
  cursorOffset: number
}

export interface SessionStore {
  read(): SessionRecord | null
  write(record: SessionRecord): void
  clear(): void
}

/**
 * Is this record worth trusting?
 *
 * Age and year only. The *content* check -- does the sheet still match what we remember -- cannot
 * happen here because it needs a parse; the store does it on the first poll after a restore and
 * absorbs anything unaccounted for rather than replaying it as sales (7.5 rule 2).
 */
export function isRestorable(record: SessionRecord, year: number, now: number): boolean {
  if (record.year !== year) return false
  const age = now - record.savedAt
  // A negative age means the clock moved backwards (NTP, timezone, a laptop waking up). Treat it
  // as untrustworthy rather than as infinitely fresh.
  return age >= 0 && age <= SESSION_MAX_AGE_MS
}

/** Shape check, because `sessionStorage` can hold anything a previous version wrote. */
function looksLikeRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<SessionRecord>
  return (
    typeof record.savedAt === 'number' &&
    typeof record.year === 'number' &&
    typeof record.cursorOffset === 'number' &&
    typeof record.baselineCounts === 'object' &&
    record.baselineCounts !== null &&
    typeof record.slots === 'object' &&
    record.slots !== null &&
    Array.isArray(record.saleLog)
  )
}

/**
 * A `SessionStore` over a real `Storage`, or a working in-memory one when there is none.
 *
 * Private-browsing modes throw on *access*, not on use, and a quota error on write must never
 * take the board down -- so every path here is wrapped. Losing the session costs the ticker its
 * history; throwing would cost the room the auction.
 */
export function browserSession(storage: Storage | null, key = 'zwml:session'): SessionStore {
  if (!storage) {
    let held: SessionRecord | null = null
    return {
      read: () => held,
      write: (record) => void (held = record),
      clear: () => void (held = null),
    }
  }

  return {
    read() {
      try {
        const raw = storage.getItem(key)
        if (raw === null) return null
        const parsed: unknown = JSON.parse(raw)
        return looksLikeRecord(parsed) ? parsed : null
      } catch {
        return null
      }
    },
    write(record) {
      try {
        storage.setItem(key, JSON.stringify(record))
      } catch {
        // Quota, private mode, or a serialization failure. The session is lost, not the board.
      }
    },
    clear() {
      try {
        storage.removeItem(key)
      } catch {
        // Nothing was stored, or storage is unavailable. Either way there is nothing to do.
      }
    },
  }
}

/** `sessionStorage`, or `null` where reading it throws. Mirrors `safeSessionStorage` in main. */
export function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
