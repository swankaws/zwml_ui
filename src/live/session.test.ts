import { describe, expect, it } from 'vitest'
import {
  SESSION_MAX_AGE_MS,
  browserSession,
  isRestorable,
  sessionKey,
  sheetFingerprint,
  type SessionRecord,
} from './session'

const NOW = 1_700_000_000_000

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    savedAt: NOW,
    year: 2026,
    baselineCounts: { Kevin: 4 },
    slots: { '1:5': { player: 'Bijan Robinson', price: 61, manager: 'Kevin', position: 'RB', suspect: false } },
    saleLog: [],
    adjustments: [],
    ...over,
  }
}

/** A `Storage` that behaves, so the happy path is tested rather than only the guards. */
function fakeStorage(): Storage & { failWrites?: boolean } {
  const map = new Map<string, string>()
  const self = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => {
      if (self.failWrites) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    failWrites: false,
  }
  return self as unknown as Storage & { failWrites?: boolean }
}

describe('isRestorable', () => {
  it('accepts a session saved seconds ago', () => {
    expect(isRestorable(record({ savedAt: NOW - 2_000 }), 2026, NOW)).toBe(true)
  })

  it('accepts one saved exactly at the window edge', () => {
    expect(isRestorable(record({ savedAt: NOW - SESSION_MAX_AGE_MS }), 2026, NOW)).toBe(true)
  })

  it('refuses one saved past the window', () => {
    /*
     * The failure this closes: rehearse on Wednesday, enter six more keepers on Thursday, open the
     * board on Friday. A restored baseline that predates those keepers makes the diff engine call
     * them six new sales, so the night opens with fake ticker entries and the pointer six managers
     * along -- at the moment the room is paying most attention (7.5).
     */
    expect(isRestorable(record({ savedAt: NOW - SESSION_MAX_AGE_MS - 1 }), 2026, NOW)).toBe(false)
    expect(isRestorable(record({ savedAt: NOW - 2 * 24 * 3600_000 }), 2026, NOW)).toBe(false)
  })

  it('refuses a session from another year', () => {
    // `?year=2025` during a rehearsal must not poison the live tab's session.
    expect(isRestorable(record({ year: 2025 }), 2026, NOW)).toBe(false)
  })

  it('refuses a session from the future', () => {
    // The clock moved backwards -- NTP, a timezone change, a laptop waking up. "Fresh" is not the
    // safe reading of a negative age.
    expect(isRestorable(record({ savedAt: NOW + 60_000 }), 2026, NOW)).toBe(false)
  })
})

describe('browserSession', () => {
  it('round-trips a record', () => {
    const store = browserSession(fakeStorage())
    const written = record({ saleLog: [{ slot: '1:5', seq: 1, player: 'X', price: 3, manager: 'Kevin', position: null }] })
    store.write(written)
    expect(store.read()).toEqual(written)
  })

  it('returns null when nothing was ever stored', () => {
    expect(browserSession(fakeStorage()).read()).toBeNull()
  })

  it('clears', () => {
    const store = browserSession(fakeStorage())
    store.write(record())
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('keys by the name it is given, so a year cannot read another year', () => {
    const storage = fakeStorage()
    browserSession(storage, 'zwml:session:2026').write(record())
    expect(browserSession(storage, 'zwml:session:2025').read()).toBeNull()
  })

  it.each([
    ['not JSON at all', 'ZWML'],
    ['JSON but not an object', '42'],
    ['null', 'null'],
    ['an object missing fields', '{"savedAt":1}'],
    [
      'a saleLog that is not an array',
      '{"savedAt":1,"year":2026,"adjustments":[],"baselineCounts":{},"slots":{},"saleLog":{}}',
    ],
  ])('treats %s as no session rather than throwing', (_label, raw) => {
    // `sessionStorage` can hold whatever a previous version of this app wrote.
    const storage = fakeStorage()
    storage.setItem('zwml:session', raw)
    expect(browserSession(storage).read()).toBeNull()
  })

  it('survives a storage that throws on write', () => {
    // Quota or private mode. Losing the session costs the ticker its history; throwing would
    // cost the room the auction.
    const storage = fakeStorage()
    storage.failWrites = true
    const store = browserSession(storage)
    expect(() => store.write(record())).not.toThrow()
    expect(store.read()).toBeNull()
  })

  it('works with no storage at all, in memory', () => {
    // Private browsing throws on ACCESS, so the caller hands us null. An in-memory store still
    // makes a reload-free session behave, and costs nothing.
    const store = browserSession(null)
    store.write(record({ adjustments: [{ afterSeq: 2, delta: 3 }] }))
    expect(store.read()?.adjustments).toEqual([{ afterSeq: 2, delta: 3 }])
    store.clear()
    expect(store.read()).toBeNull()
  })
})

/*
 * Session identity (7.5, 9.1).
 *
 * The record belongs to a SHEET and a TAB, not just to a year. The route that made this necessary:
 * `sessionStorage` is scoped to the tab, so it survives a same-tab navigation to a different `?sheet=`
 * or `#sheet=`. Rehearse against a copy of the workbook, then point the same tab at the live sheet, and
 * a year-only key restored the copy's baseline and sale log -- phantom sales on LAST PURCHASED and ON
 * THE CLOCK several managers along. The 30-minute window does not close it, because `savedAt` is
 * refreshed on every successful poll, so the record is seconds old at the moment of the switch.
 */
describe('sessionKey', () => {
  /** The fictional ids allowlisted in `config/no-committed-sheet-id.test.ts`. Never a real one. */
  const SHEET_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x'
  const SHEET_B = '2ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-y'
  const AUCTION_GID = '1565415907'
  const PAST_GID = '599461641'

  it('is stable, so an ordinary reload still restores', () => {
    // The whole point of 7.5: a watchdog reload seconds later must find its own session again.
    expect(sessionKey(SHEET_A, AUCTION_GID, 2026)).toBe(sessionKey(SHEET_A, AUCTION_GID, 2026))
  })

  it('separates two workbooks on the same tab and the same year', () => {
    // The reported defect, at the identity layer.
    expect(sessionKey(SHEET_A, AUCTION_GID, 2026)).not.toBe(sessionKey(SHEET_B, AUCTION_GID, 2026))
  })

  it('separates two tabs of one workbook, and two years', () => {
    // gid follows year today, so the tab half is belt and braces -- until a season needs a second tab.
    expect(sessionKey(SHEET_A, AUCTION_GID, 2026)).not.toBe(sessionKey(SHEET_A, PAST_GID, 2026))
    expect(sessionKey(SHEET_A, AUCTION_GID, 2026)).not.toBe(sessionKey(SHEET_A, AUCTION_GID, 2025))
  })

  it('never writes the spreadsheet id, or any 12-character run of it, into the key (9.1)', () => {
    /*
     * This is the 9.1 decision enforced in code rather than only in a comment. A storage key is a string
     * an operator can read straight off the DevTools Application panel and paste into a note, and a dozen
     * characters of a real id is enough to find the sheet -- while `no-committed-sheet-id.test.ts` would
     * not catch it in that shape (no URL prefix, no assignment, and base64url defeats its base64 pass).
     */
    const key = sessionKey(SHEET_A, AUCTION_GID, 2026)
    expect(key).not.toContain(SHEET_A)
    for (let index = 0; index + 12 <= SHEET_A.length; index += 1) {
      expect(key).not.toContain(SHEET_A.slice(index, index + 12))
    }
  })

  it('digests to a fixed-length hex string', () => {
    // Fixed length means the key can never grow with its input, whatever a future id looks like.
    expect(sheetFingerprint(SHEET_A, AUCTION_GID)).toMatch(/^[0-9a-f]{16}$/)
    expect(sheetFingerprint(SHEET_B, PAST_GID)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not collide on ids differing in a single character', () => {
    // A copy of a workbook gets an unrelated id, but a MISTYPED one differs by one character.
    const near = `${SHEET_A.slice(0, -1)}y`
    expect(sheetFingerprint(near, AUCTION_GID)).not.toBe(sheetFingerprint(SHEET_A, AUCTION_GID))
  })

  it('cannot be forged by shifting a character between the id and the gid', () => {
    // The separator is `:`, which neither an id nor a gid can contain -- so the two fields cannot blur.
    expect(sheetFingerprint(SHEET_A, AUCTION_GID)).not.toBe(
      sheetFingerprint(`${SHEET_A}${AUCTION_GID.slice(0, 1)}`, AUCTION_GID.slice(1)),
    )
  })

  it('keeps one sheet session invisible to another through a real Storage', () => {
    /*
     * The bug end to end at the storage layer: same tab, same year, two workbooks. Before this, both
     * wrote and read `zwml:session:2026` and the second inherited the first's baseline and sale log.
     */
    const storage = fakeStorage()
    const a = sessionKey(SHEET_A, AUCTION_GID, 2026)
    const b = sessionKey(SHEET_B, AUCTION_GID, 2026)
    browserSession(storage, a).write(record({ baselineCounts: { Kevin: 9 } }))

    expect(browserSession(storage, b).read()).toBeNull()
    expect(browserSession(storage, a).read()?.baselineCounts).toEqual({ Kevin: 9 })
  })
})
