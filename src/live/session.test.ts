import { describe, expect, it } from 'vitest'
import {
  SESSION_MAX_AGE_MS,
  browserSession,
  isRestorable,
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
    cursorOffset: 0,
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
    ['a saleLog that is not an array', '{"savedAt":1,"year":2026,"cursorOffset":0,"baselineCounts":{},"slots":{},"saleLog":{}}'],
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
    store.write(record({ cursorOffset: 3 }))
    expect(store.read()?.cursorOffset).toBe(3)
    store.clear()
    expect(store.read()).toBeNull()
  })
})
