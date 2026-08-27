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
import type { CursorAdjustment } from '../model/pointer'

/**
 * Refused if older than this. 7.5's reasoning: a genuine mid-draft reload is seconds old, so a
 * short window keeps all of the value, while a multi-hour TTL would let projector-open time plus
 * a four-hour draft slip through -- and re-baselining at hour four loses the sale log outright,
 * which is worse than the bug the window exists to prevent.
 */
export const SESSION_MAX_AGE_MS = 30 * 60_000

/** How long the `resynced` notice stays on the wall after a restore absorbed something. */
export const RESYNC_NOTICE_MS = 30_000

/**
 * WHICH sheet and tab this session belongs to, as a short opaque digest.
 *
 * Keying by year alone was not enough, and the route is one address-bar edit: `sessionStorage` is scoped
 * to the TAB, not to the document, so it survives a same-tab navigation to `?sheet=<other>` or a
 * re-pasted `#sheet=` -- including the setup card's own `reload()`. Rehearse against a COPY of the
 * workbook, then point that same tab at the live sheet, and the copy's baseline and sale log are restored
 * against the live sheet: real player names at real prices on LAST PURCHASED that never sold tonight, and
 * ON THE CLOCK several managers along, before the first fetch even returns. The 30-minute window does not
 * help -- `savedAt` is refreshed on every poll, so the record is seconds old at the moment of the switch.
 *
 * WHY A DIGEST RATHER THAN THE ID ITSELF. Not secrecy: `localStorage['zwml:sheetId']` already holds the id
 * in the clear (9.1), so this would add no new exposure on disk. It is repo containment. A key containing
 * the id is a human-visible, copy-pasteable string, and the shape it invites -- a troubleshooting note
 * reading "delete zwml:session:<id>" -- is one `no-committed-sheet-id.test.ts` cannot catch: there is no
 * `/spreadsheets/d/` prefix, no `sheetId =` assignment, and its base64 pass is `[A-Za-z0-9+/]`, which a
 * base64url id containing `-` or `_` never matches. So a raw-id key opens an unguarded route for the id
 * into the tree. A digest cannot be pasted back into anything and separates two sheets just as well.
 *
 * FNV-1a twice rather than Web Crypto, because the key is needed synchronously at store construction:
 * `crypto.subtle.digest` is async AND requires a secure context, and this board is opened over plain http
 * on localhost and across the LAN during rehearsal. Collision resistance does not need to be
 * cryptographic -- a collision costs one baseline, and the first reconcile absorbs rather than replays.
 */
export function sheetFingerprint(spreadsheetId: string, gid: string): string {
  // `:` cannot appear in either input -- ids are `[A-Za-z0-9_-]` and gids are digits -- so the separator
  // cannot be forged by shifting characters from one field into the other.
  return fnv1a(`${spreadsheetId}:${gid}`, 2166136261) + fnv1a(`${gid}:${spreadsheetId}`, 16777619)
}

/** 32-bit FNV-1a as 8 hex characters. `Math.imul` because `*` would lose the low bits to a double. */
function fnv1a(text: string, offsetBasis: number): string {
  let hash = offsetBasis >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The `sessionStorage` key for one (spreadsheet, tab, year).
 *
 * `year` stays in the clear even though the fingerprint already covers the gid: it costs nothing, it is
 * the one part an operator reading the DevTools Application panel at 8pm can act on, and
 * `SessionRecord.year` plus `isRestorable` still check it independently.
 */
export function sessionKey(spreadsheetId: string, gid: string, year: number): string {
  return `zwml:session:${year}:${sheetFingerprint(spreadsheetId, gid)}`
}

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
  /**
   * The operator's `N`/`Shift+N` corrections, each stamped with when it was made. A reload must not
   * silently undo them, and the history view needs to know WHEN each one happened.
   */
  adjustments: CursorAdjustment[]
}

export interface SessionStore {
  read(): SessionRecord | null
  write(record: SessionRecord): void
  clear(): void
}

/**
 * Is this record worth trusting?
 *
 * Age and year only. WHICH SHEET is deliberately not checked here, because it cannot be got wrong here:
 * a record is only ever reachable through `sessionKey()`, which folds the spreadsheet id and the gid into
 * the storage key. The *content* check -- does the sheet still match what we remember -- cannot
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
    typeof record.baselineCounts === 'object' &&
    record.baselineCounts !== null &&
    typeof record.slots === 'object' &&
    record.slots !== null &&
    Array.isArray(record.saleLog) &&
    Array.isArray(record.adjustments)
  )
}

/**
 * Upgrade a record written before corrections were stamped.
 *
 * Older sessions stored a single `cursorOffset` number. Rejecting them outright would be safe but
 * costly in the one case that matters: a watchdog reload moments after a deploy would drop the night's
 * ticker and the pointer for no reason. Converting instead keeps the correction, dated to `afterSeq: 0`
 * -- i.e. treated as though it had always been in force, which is the only reading available once the
 * timing has been lost, and the same reading the old code used everywhere.
 */
function migrate(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const record = value as Partial<SessionRecord> & { cursorOffset?: unknown }
  if (Array.isArray(record.adjustments) || typeof record.cursorOffset !== 'number') return value
  const offset = record.cursorOffset
  return {
    ...record,
    adjustments: offset === 0 ? [] : [{ afterSeq: 0, delta: offset }],
  }
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
        const parsed: unknown = migrate(JSON.parse(raw))
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
