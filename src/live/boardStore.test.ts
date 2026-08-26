/**
 * The poll loop, tested with no network, no fake timers and no DOM.
 *
 * Every clock and timer the store uses is injected, so `harness` below is a complete
 * substitute for the browser: `advance(ms)` moves the clock and fires whatever became
 * due, and `source` answers whatever the test queued. That is what makes the
 * interesting cases -- 90-second outages, a wrong tab mid-draft, a forced refetch
 * landing on top of an in-flight request -- ordinary unit tests rather than things we
 * find out about on the night.
 */

import { describe, expect, it } from 'vitest'
import raw2026 from '../../docs/data-samples/2026-auction.csv?raw'
import { createBoardStore, initialSnapshot, type BoardStore } from './boardStore'
import { SheetFetchError, type SheetSource, type TabText } from '../data/sheetClient'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid } from '../data/gridParser'
import { snapshotSlots } from '../model/diff'
import type { SessionRecord } from './session'

/** Minimal CSV writer, so a test can doctor a fixture and feed it back through the real parser. */
function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n')
}

const GID = '1565415907'
const SETTINGS_GID = '361377598'
const INTERVAL = 3000

/** A settings tab as the maintainer actually keeps it (see DESIGN.md 9.2). */
const SETTINGS_CSV = 'ZWML Settings,\nrail,off\nscale,1.05\n'

type Answer = { text: string } | { error: unknown } | 'hold'

interface Harness {
  store: BoardStore
  /** Moves the injected clock and fires due timers, then drains microtasks. */
  advance(ms: number): Promise<void>
  /** Lets queued promises settle without moving the clock. */
  settle(): Promise<void>
  answer(gid: string, answer: Answer): void
  /** Resolves the oldest held request. */
  release(answer: { text: string } | { error: unknown }): void
  calls: string[]
  notifications: number
  pendingTimers(): number
  now(): number
}

function harness(overrides: Partial<Parameters<typeof createBoardStore>[0]> = {}): Harness {
  let clock = 1_000_000
  let nextHandle = 1
  const timers = new Map<number, { fn: () => void; due: number }>()
  const answers = new Map<string, Answer>()
  const held: { resolve: (value: TabText) => void; reject: (cause: unknown) => void }[] = []
  const calls: string[] = []

  const source: SheetSource = {
    fetchTab(gid, signal) {
      calls.push(gid)
      const answer = answers.get(gid) ?? { error: new SheetFetchError('notFound', 'no such tab') }

      if (answer === 'hold') {
        return new Promise<TabText>((resolve, reject) => {
          held.push({ resolve, reject })
          // The real client turns an external abort into exactly this.
          signal?.addEventListener('abort', () =>
            reject(new SheetFetchError('network', 'request aborted')),
          )
        })
      }
      if ('error' in answer) return Promise.reject(answer.error)
      return Promise.resolve({ text: answer.text, at: clock })
    },
  }

  const store = createBoardStore({
    source,
    gid: GID,
    year: 2026,
    settingsGid: null,
    pollIntervalMs: INTERVAL,
    settingsPollIntervalMs: 15_000,
    now: () => clock,
    setTimer: (fn, ms) => {
      const handle = nextHandle++
      timers.set(handle, { fn, due: clock + ms })
      return handle
    },
    clearTimer: (handle) => void timers.delete(handle),
    ...overrides,
  })

  const self: Harness = {
    store,
    calls,
    notifications: 0,
    now: () => clock,
    pendingTimers: () => timers.size,
    answer: (gid, answer) => void answers.set(gid, answer),
    release: (answer) => {
      const next = held.shift()
      if (!next) throw new Error('no held request to release')
      if ('error' in answer) next.reject(answer.error)
      else next.resolve({ text: answer.text, at: clock })
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
    async advance(ms) {
      const target = clock + ms
      // One at a time and in due order: a poll reschedules itself, and firing a
      // snapshot of the map would run timers that only exist because of this advance.
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0]
        if (!due) break
        const [handle, timer] = due
        timers.delete(handle)
        clock = timer.due
        timer.fn()
        await self.settle()
      }
      clock = target
      await self.settle()
    },
  }

  store.subscribe(() => {
    self.notifications += 1
  })
  return self
}

/** A started store with the real 2026 board already on screen. */
async function live(overrides?: Partial<Parameters<typeof createBoardStore>[0]>): Promise<Harness> {
  const h = harness(overrides)
  h.answer(GID, { text: raw2026 })
  h.answer(SETTINGS_GID, { text: SETTINGS_CSV })
  h.store.start()
  await h.settle()
  return h
}

describe('before the first response', () => {
  it('reports CONNECTING rather than a blank board', () => {
    const h = harness()
    expect(h.store.getSnapshot()).toEqual(initialSnapshot(2026))
    expect(h.store.getSnapshot().state).toBeNull()
  })

  it('does not poll until started', async () => {
    const h = harness()
    await h.advance(60_000)
    expect(h.calls).toEqual([])
  })
})

describe('the first successful poll', () => {
  it('puts the real board up', async () => {
    const h = await live()
    const snapshot = h.store.getSnapshot()

    expect(snapshot.state?.managers).toHaveLength(12)
    expect(snapshot.feed).toBe('live')
    expect(snapshot.feedLabel).toBe('LIVE')
    expect(snapshot.problem).toBeNull()
    expect(snapshot.lastSuccessAt).toBe(h.now())
  })

  it('resolves the nomination order from the tab', async () => {
    const h = await live()
    expect(h.store.getSnapshot().order).toHaveLength(12)
  })

  // The hook for 9.1: an id is only worth remembering once it has proved it works.
  it('reports the first success exactly once', async () => {
    let confirmed = 0
    const h = await live({ onFirstSuccess: () => void (confirmed += 1) })
    await h.advance(INTERVAL * 5)

    expect(confirmed).toBe(1)
    expect(h.store.health().polls).toBeGreaterThan(1)
  })

  it('carries a tab-selection warning through to the board', async () => {
    const h = await live({ tabWarning: '?year=2019 is not a configured tab' })
    expect(h.store.getSnapshot().warnings[0]).toContain('2019')
  })
})

describe('change detection', () => {
  it('keeps the same snapshot object when the body is unchanged', async () => {
    const h = await live()
    const first = h.store.getSnapshot()
    const before = h.notifications

    await h.advance(INTERVAL * 3)

    // Reference identity, not deep equality: `useSyncExternalStore` re-renders on a
    // new reference, so a fresh-but-equal object every 3s is a re-render every 3s.
    expect(h.store.getSnapshot()).toBe(first)
    expect(h.notifications).toBe(before)
    expect(h.store.health().changes).toBe(1)
  })

  // A sale landing mid-draft: one price cell changes, and every figure derived from
  // it has to move with it.
  it('re-derives and notifies when the sheet is edited', async () => {
    const h = await live()
    const before = h.store.getSnapshot()
    const spentBefore = before.state?.leagueSpent ?? 0

    expect(raw2026).toContain('Drake Maye,$1')
    h.answer(GID, { text: raw2026.replace('Drake Maye,$1', 'Drake Maye,$4') })
    await h.advance(INTERVAL)

    const after = h.store.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.state?.leagueSpent).toBe(spentBefore + 3)
    expect(h.store.health().changes).toBe(2)
    expect(h.notifications).toBeGreaterThan(0)
  })

  it('counts every poll but only real edits as changes', async () => {
    const h = await live()
    await h.advance(INTERVAL * 4)

    const health = h.store.health()
    expect(health.polls).toBe(5)
    expect(health.changes).toBe(1)
  })
})

describe('a transient failure', () => {
  it('keeps the last good board and lets the age tell the story', async () => {
    const h = await live()
    const good = h.store.getSnapshot().state

    h.answer(GID, { error: new SheetFetchError('network', 'Failed to fetch') })
    await h.advance(INTERVAL)

    const snapshot = h.store.getSnapshot()
    expect(snapshot.state).toBe(good)
    // No full-screen anything: nothing here is actionable, and the numbers on the
    // wall are still the truth as of a few seconds ago.
    expect(snapshot.problem).toBeNull()
  })

  it('goes amber, then red, as the data ages', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('server', 'Google returned 503') })

    await h.advance(INTERVAL * 4)
    expect(h.store.getSnapshot().feed).toBe('stale')
    expect(h.store.getSnapshot().feedLabel).toMatch(/^STALE · \d+s$/)

    await h.advance(INTERVAL * 30)
    expect(h.store.getSnapshot().feed).toBe('dead')
    expect(h.store.getSnapshot().feedLabel).toMatch(/^OFFLINE · /)
  })

  it('backs off, then recovers at the base interval', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('network', 'offline') })

    // 3s -> the failing poll; then 6s, 12s, 15s (capped).
    await h.advance(INTERVAL)
    const afterFirst = h.calls.length

    await h.advance(5999)
    expect(h.calls).toHaveLength(afterFirst)
    await h.advance(1)
    expect(h.calls).toHaveLength(afterFirst + 1)

    h.answer(GID, { text: raw2026 })
    await h.advance(12_000)
    expect(h.store.health().consecutiveFailures).toBe(0)

    const recovered = h.calls.length
    await h.advance(INTERVAL)
    expect(h.calls).toHaveLength(recovered + 1)
    expect(h.store.getSnapshot().feedLabel).toBe('LIVE')
  })

  it('never lets a failure stop the loop', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('network', 'offline') })

    await h.advance(10 * 60_000)
    expect(h.pendingTimers()).toBeGreaterThan(0)

    h.answer(GID, { text: raw2026 })
    await h.advance(15_000)
    expect(h.store.getSnapshot().feedLabel).toBe('LIVE')
  })
})

describe('a failure nobody can fix by waiting', () => {
  it('names the sharing setting for a 403, and how to change it', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('unauthorized', 'not shared', 403) })
    await h.advance(INTERVAL)

    const problem = h.store.getSnapshot().problem
    expect(problem?.kind).toBe('unauthorized')
    expect(problem?.action).toContain('Anyone with the link')
  })

  it('keeps the last good board up underneath the problem', async () => {
    const h = await live()
    const good = h.store.getSnapshot().state

    h.answer(GID, { error: new SheetFetchError('notFound', 'no such tab', 404) })
    await h.advance(INTERVAL)

    expect(h.store.getSnapshot().state).toBe(good)
    expect(h.store.getSnapshot().problem?.kind).toBe('notFound')
  })

  it('clears the problem once the fetch works again', async () => {
    const h = harness()
    h.answer(GID, { error: new SheetFetchError('unauthorized', 'not shared', 403) })
    h.store.start()
    await h.settle()
    expect(h.store.getSnapshot().problem?.kind).toBe('unauthorized')

    h.answer(GID, { text: raw2026 })
    await h.advance(INTERVAL * 3)

    expect(h.store.getSnapshot().problem).toBeNull()
    expect(h.store.getSnapshot().state).not.toBeNull()
  })

  it('says NO DATA rather than CONNECTING when the first poll fails outright', async () => {
    const h = harness()
    h.answer(GID, { error: new SheetFetchError('notFound', 'no such tab', 404) })
    h.store.start()
    await h.settle()

    expect(h.store.getSnapshot().feedLabel).toBe('NO DATA')
    expect(h.store.getSnapshot().state).toBeNull()
  })
})

describe('the wrong tab', () => {
  // Section 5.2's worst case: this body parses, so it would render -- as a plausible
  // grid of entirely wrong numbers. Refusing it is the whole point.
  const NOT_THE_AUCTION = 'Player,Team,Bye\nJosh Allen,BUF,7\nSaquon Barkley,PHI,9\n'

  it('refuses to replace a good board with it', async () => {
    const h = await live()
    const good = h.store.getSnapshot().state

    h.answer(GID, { text: NOT_THE_AUCTION })
    await h.advance(INTERVAL)

    expect(h.store.getSnapshot().state).toBe(good)
    expect(h.store.getSnapshot().problem?.kind).toBe('wrongTab')
    expect(h.store.getSnapshot().problem?.action).toContain(GID)
  })

  it('leaves the good frame’s own warnings alone', async () => {
    const h = await live()
    const warnings = h.store.getSnapshot().warnings

    h.answer(GID, { text: NOT_THE_AUCTION })
    await h.advance(INTERVAL)

    // The numbers on screen came from the good body, so the warning list under them
    // must describe that body -- not the one that was rejected.
    expect(h.store.getSnapshot().warnings).toEqual(warnings)
  })

  it('recovers when the right tab comes back', async () => {
    const h = await live()
    h.answer(GID, { text: NOT_THE_AUCTION })
    await h.advance(INTERVAL)

    h.answer(GID, { text: raw2026 })
    await h.advance(INTERVAL)

    expect(h.store.getSnapshot().problem).toBeNull()
  })
})

describe('a throw from our own parser', () => {
  /** Explodes on parse, but only after the fetch has succeeded. */
  function exploding(): SheetSource {
    return {
      fetchTab: () => Promise.resolve({ text: ' '.repeat(3), at: 1 }),
    }
  }

  it('does not report LIVE over an empty board', async () => {
    const h = harness({
      source: {
        fetchTab: () => {
          throw new Error('boom')
        },
      },
    })
    h.store.start()
    await h.settle()

    const snapshot = h.store.getSnapshot()
    expect(snapshot.state).toBeNull()
    expect(snapshot.problem?.kind).toBe('internal')
    expect(snapshot.problem?.message).toContain('boom')
  })

  it('keeps polling afterwards', async () => {
    const h = harness({ source: exploding() })
    h.store.start()
    await h.settle()
    const before = h.calls.length + 1

    await h.advance(INTERVAL * 3)
    expect(h.store.health().polls).toBeGreaterThanOrEqual(before)
  })
})

describe('the settings tab', () => {
  it('is a separate, slower loop', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    expect(h.store.getSnapshot().sheetSettings).toEqual({ rail: false, scale: 1.05 })

    const auctionPolls = h.calls.filter((gid) => gid === GID).length
    const settingsPolls = h.calls.filter((gid) => gid === SETTINGS_GID).length
    await h.advance(15_000)

    expect(h.calls.filter((gid) => gid === GID).length).toBeGreaterThan(auctionPolls + 3)
    expect(h.calls.filter((gid) => gid === SETTINGS_GID).length).toBe(settingsPolls + 1)
  })

  it('is skipped entirely when no gid is configured', async () => {
    const h = await live({ settingsGid: null })
    await h.advance(60_000)
    expect(h.calls).not.toContain(SETTINGS_GID)
  })

  /*
   * The board is not optional and the settings tab is. A deleted or renamed settings
   * tab may cost the operator their `scale`; it may not cost the room the auction.
   */
  it('cannot take the board down', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    h.answer(SETTINGS_GID, { error: new SheetFetchError('notFound', 'no such tab', 404) })

    await h.advance(60_000)

    expect(h.store.getSnapshot().state).not.toBeNull()
    expect(h.store.getSnapshot().problem).toBeNull()
    expect(h.store.getSnapshot().warnings.join(' ')).toContain('SETTINGS')
  })

  // A warning channel that repeats itself for four hours is a warning channel
  // nobody reads on the one night it matters (9.2).
  it('reports an unreadable tab once, not once per poll', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    h.answer(SETTINGS_GID, { error: new SheetFetchError('notFound', 'gone', 404) })

    await h.advance(5 * 60_000)

    const complaints = h.store.getSnapshot().warnings.filter((w) => w.includes('SETTINGS'))
    expect(complaints).toHaveLength(1)
  })

  it('picks up an edit on the next poll', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    h.answer(SETTINGS_GID, { text: 'ZWML Settings,\nrail,on\n' })

    await h.advance(15_000)
    expect(h.store.getSnapshot().sheetSettings).toEqual({ rail: true })
  })

  it('ignores a wrong tab whose anchor is missing', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    h.answer(SETTINGS_GID, { text: 'Player,Team\nJosh Allen,BUF\n' })

    await h.advance(15_000)
    expect(h.store.getSnapshot().sheetSettings).toEqual({})
    expect(h.store.getSnapshot().warnings.join(' ')).toContain('anchor')
  })
})

describe('refetch', () => {
  it('polls at once instead of waiting out the interval', async () => {
    const h = await live()
    const before = h.calls.length

    h.store.refetch()
    await h.settle()

    expect(h.calls).toHaveLength(before + 1)
  })

  /*
   * The bug this test exists for. A refetch aborts whatever is in flight; without a
   * generation guard the abandoned request still counted its own abort as a failure
   * and still scheduled a timer in its `finally` -- leaving two loops polling at
   * once, each resetting the other's backoff, at double the request rate, forever.
   */
  it('does not leave the aborted request running a second loop', async () => {
    const h = harness()
    h.answer(GID, 'hold')
    h.store.start()
    await h.settle()

    h.answer(GID, { text: raw2026 })
    h.store.refetch()
    await h.settle()

    expect(h.store.health().consecutiveFailures).toBe(0)
    expect(h.store.health().polls).toBe(1)

    // One loop, one timer, one request per interval.
    const timersBefore = h.pendingTimers()
    const callsBefore = h.calls.length
    await h.advance(INTERVAL)
    expect(h.calls).toHaveLength(callsBefore + 1)
    expect(h.pendingTimers()).toBe(timersBefore)
  })

  it('clears the backoff, so a forced retry is not silently delayed', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('network', 'offline') })
    await h.advance(INTERVAL * 3)
    expect(h.store.health().consecutiveFailures).toBeGreaterThan(0)

    h.answer(GID, { text: raw2026 })
    h.store.refetch()
    await h.settle()

    expect(h.store.health().consecutiveFailures).toBe(0)
    const before = h.calls.length
    await h.advance(INTERVAL)
    expect(h.calls).toHaveLength(before + 1)
  })

  it('does nothing on a stopped store', async () => {
    const h = await live()
    h.store.stop()
    const before = h.calls.length

    h.store.refetch()
    await h.settle()
    expect(h.calls).toHaveLength(before)
  })
})

describe('stop', () => {
  it('cancels every timer and every request', async () => {
    const h = await live({ settingsGid: SETTINGS_GID })
    h.store.stop()
    const before = h.calls.length

    await h.advance(10 * 60_000)

    expect(h.calls).toHaveLength(before)
    expect(h.pendingTimers()).toBe(0)
  })

  it('does not publish anything after being stopped', async () => {
    const h = harness()
    h.answer(GID, 'hold')
    h.store.start()
    await h.settle()

    h.store.stop()
    h.release({ text: raw2026 })
    await h.settle()

    expect(h.store.getSnapshot().state).toBeNull()
  })
})

describe('the age ticker', () => {
  // The reason `LIVE` carries no seconds: a digit changing every second in the header
  // is the motion 7.7 bans, and it would also re-render the whole board to show it.
  it('does not re-render a healthy board once a second', async () => {
    const h = await live()
    const before = h.notifications
    const snapshot = h.store.getSnapshot()

    await h.advance(2500)

    expect(h.notifications).toBe(before)
    expect(h.store.getSnapshot()).toBe(snapshot)
  })

  it('ticks the age up while the feed is stale', async () => {
    const h = await live()
    h.answer(GID, { error: new SheetFetchError('network', 'offline') })

    await h.advance(20_000)
    const first = h.store.getSnapshot().feedLabel
    await h.advance(5000)

    expect(h.store.getSnapshot().feedLabel).not.toBe(first)
    expect(h.store.getSnapshot().feedLabel).toContain('STALE')
  })
})

describe('health', () => {
  it('records a render error once, no matter how many times it repeats', async () => {
    const h = await live()
    h.store.noteRenderError()
    const at = h.store.health().renderErrorAt
    expect(at).toBe(h.now())

    await h.advance(30_000)
    h.store.noteRenderError()

    // Each retry that throws again must not reset the clock the watchdog is reading.
    expect(h.store.health().renderErrorAt).toBe(at)
  })

  it('clears a render error when the tree recovers', async () => {
    const h = await live()
    h.store.noteRenderError()
    h.store.clearRenderError()

    expect(h.store.health().renderErrorAt).toBeNull()
  })

  it('keeps counting while the feed is down, so the watchdog can see it', async () => {
    const h = await live()
    const lastGood = h.store.health().lastSuccessAt
    h.answer(GID, { error: new SheetFetchError('server', '503') })

    await h.advance(5 * 60_000)

    const health = h.store.health()
    expect(health.lastSuccessAt).toBe(lastGood)
    expect(health.consecutiveFailures).toBeGreaterThan(3)
  })
})

/*
 * Surviving a mid-draft reload (DESIGN.md 7.5).
 *
 * The two cases 7.5 names explicitly, plus the ones its rules imply. The whole point is that
 * exactly one direction of error is acceptable: the board may FORGET a sale (visible, and one
 * keystroke to fix) but it must never INVENT one, because a phantom sale also moves the
 * nomination pointer and the room has no way to tell.
 */
describe('surviving a reload', () => {
  const FRESH = 1_000_000

  function seed(over: Partial<SessionRecord> = {}): SessionRecord {
    return {
      savedAt: FRESH,
      year: 2026,
      baselineCounts: {},
      slots: {},
      saleLog: [],
      cursorOffset: 0,
      ...over,
    }
  }

  /** An in-memory `SessionStore` that also records what the store wrote. */
  function fakeSession(initial: SessionRecord | null) {
    let held = initial
    const writes: SessionRecord[] = []
    return {
      writes,
      cleared: () => held === null,
      current: () => held,
      store: {
        read: () => held,
        write: (record: SessionRecord) => {
          writes.push(record)
          held = record
        },
        clear: () => void (held = null),
      },
    }
  }

  /** The slots the real parser produces for the committed 2026 tab: nine keepers. */
  const slots2026 = snapshotSlots(parseAuctionGrid(parseCsv(raw2026)).blocks)

  it('discards a session older than the window and re-baselines, emitting no sales', async () => {
    // 7.5's first named test: a two-day-old baseline against a sheet that has gained keepers.
    const session = fakeSession(seed({ savedAt: FRESH - 2 * 24 * 3600_000, slots: {} }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })

    h.store.start()
    await h.settle()

    expect(h.store.getSnapshot().sales).toEqual([])
    expect(h.store.getSnapshot().pointer.log).toEqual([])
    // Discarded, not merely ignored: nothing stale is left to be restored next time.
    expect(session.writes[0]?.savedAt).toBe(h.now())
  })

  it('ignores a session from another year', async () => {
    const session = fakeSession(seed({ year: 2025, slots: {} }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })

    h.store.start()
    await h.settle()

    expect(h.store.getSnapshot().sales).toEqual([])
  })

  it('absorbs picks entered while the tab was away instead of replaying them as sales', async () => {
    /*
     * A fresh session that remembers an EMPTY sheet, against a tab that now holds nine picks.
     * Those nine are unaccounted for, so they join the baseline silently -- no ticker entries, no
     * pointer advance -- and the room is told, because a pointer that is quietly one behind is
     * worse than one that says so.
     */
    const session = fakeSession(seed({ slots: {} }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })

    h.store.start()
    await h.settle()

    const snapshot = h.store.getSnapshot()
    expect(snapshot.sales).toEqual([])
    expect(snapshot.pointer.log).toEqual([])
    // The picks became part of the baseline, so fullness is still counted correctly.
    expect(Object.values(snapshot.pointer.baselineCounts).reduce((a, b) => a + b, 0)).toBe(9)
    expect(snapshot.warnings.some((w) => w.includes('absorbed'))).toBe(true)
  })

  it('restores the ticker and the operator correction from a fresh session', async () => {
    const log = [
      { slot: '1:5', seq: 1, player: 'Bijan Robinson', price: 61, manager: 'Kevin', position: 'RB' as const },
      { slot: '7:5', seq: 2, player: 'Puka Nacua', price: 44, manager: 'Corky', position: 'WR' as const },
    ]
    const session = fakeSession(seed({ slots: slots2026, saleLog: log, cursorOffset: 2 }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })

    h.store.start()
    await h.settle()

    const snapshot = h.store.getSnapshot()
    // Newest first on the wall, oldest first in the log the pointer replays.
    expect(snapshot.sales.map((s) => s.seq)).toEqual([2, 1])
    expect(snapshot.pointer.offset).toBe(2)
    // The sheet matched what we remembered, so nothing was absorbed and nobody is told anything.
    expect(snapshot.warnings.some((w) => w.includes('absorbed'))).toBe(false)
  })

  it('keeps counting sales normally after a clean restore', async () => {
    // 7.5's second named test: with a fresh session the log continues rather than restarting.
    const session = fakeSession(seed({ slots: slots2026, saleLog: [] }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })
    h.store.start()
    await h.settle()
    expect(h.store.getSnapshot().sales).toEqual([])

    // A player is sold after the reload settled.
    const grid = parseCsv(raw2026).map((row) => [...row])
    const row = grid[8]!
    while (row.length <= 3) row.push('')
    row[2] = 'Brock Bowers'
    row[3] = '$9'
    h.answer(GID, { text: toCsv(grid) })
    await h.advance(INTERVAL)

    expect(h.store.getSnapshot().sales.map((s) => s.player)).toEqual(['Brock Bowers'])
  })

  it('refreshes savedAt on every successful poll, not only on change', async () => {
    // An open tab must never age into staleness while it sits idle during a break in the auction.
    const session = fakeSession(null)
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })

    h.store.start()
    await h.settle()
    const first = session.current()?.savedAt

    await h.advance(INTERVAL) // same body: no change, but still a successful poll
    expect(session.current()?.savedAt).toBeGreaterThan(first!)
  })

  it('persists an operator nudge, so a reload does not silently undo it', async () => {
    const session = fakeSession(null)
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })
    h.store.start()
    await h.settle()

    h.store.nudgeCursor(1)
    expect(session.current()?.cursorOffset).toBe(1)
  })

  it('clears the stored session on X, so the reset actually sticks', async () => {
    const session = fakeSession(seed({ slots: slots2026, cursorOffset: 4 }))
    const h = harness({ session: session.store })
    h.answer(GID, { text: raw2026 })
    h.store.start()
    await h.settle()

    h.store.resetSession()
    await h.settle()

    expect(h.store.getSnapshot().pointer.offset).toBe(0)
    expect(h.store.getSnapshot().sales).toEqual([])
  })
})
