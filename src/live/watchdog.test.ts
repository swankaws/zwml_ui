import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS,
  installWatchdog,
  sessionHistory,
  watchdogVerdict,
  type ReloadHistory,
  type WatchdogInput,
} from './watchdog'
import type { BoardHealth, BoardSnapshot, BoardStore } from './boardStore'
import { initialSnapshot } from './boardStore'

const NOW = 10_000_000

function input(overrides: Partial<WatchdogInput> = {}): WatchdogInput {
  return {
    now: NOW,
    lastAttemptAt: NOW - 3000,
    lastSuccessAt: NOW - 3000,
    renderErrorAt: null,
    blockedOnOperator: false,
    reloads: 0,
    lastReloadAt: null,
    ...overrides,
  }
}

describe('watchdogVerdict', () => {
  it('waits while the board is healthy', () => {
    expect(watchdogVerdict(input())).toEqual({ action: 'wait' })
  })

  it('reloads a tree that has stayed broken', () => {
    const verdict = watchdogVerdict(input({ renderErrorAt: NOW - 16_000 }))
    expect(verdict).toEqual({ action: 'reload', reason: 'render-error' })
  })

  it('gives the boundary its own retry first', () => {
    expect(watchdogVerdict(input({ renderErrorAt: NOW - 5000 }))).toEqual({ action: 'wait' })
  })

  it('reloads a loop that has stopped attempting anything', () => {
    const verdict = watchdogVerdict(input({ lastAttemptAt: NOW - 121_000 }))
    expect(verdict).toEqual({ action: 'reload', reason: 'loop-stalled' })
  })

  /*
   * The rule that matters most, and the one an earlier design got backwards. A reload
   * needs the network to serve index.html and the hashed assets, so reloading during
   * an outage trades a readable board captioned `OFFLINE · 4m` for the browser's error
   * page -- which, unlike the board, cannot come back on its own. Attempts are still
   * completing here, so the loop is alive and needs no help.
   */
  it('does NOT reload a board that is merely offline', () => {
    const offline = input({
      lastSuccessAt: NOW - 10 * 60_000,
      lastAttemptAt: NOW - 3000,
    })
    expect(watchdogVerdict(offline)).toEqual({ action: 'wait' })
  })

  it('stands down when the fix is a Google setting, not a reload', () => {
    const verdict = watchdogVerdict(input({ blockedOnOperator: true, lastAttemptAt: NOW - 200_000 }))
    expect(verdict).toEqual({ action: 'stand-down', detail: 'operator-action-needed' })
  })

  // An instruction nobody can see is not an instruction, and the tree that would draw
  // it is the broken thing.
  it('still reloads a dead tree even when a problem is showing', () => {
    const verdict = watchdogVerdict(input({ blockedOnOperator: true, renderErrorAt: NOW - 20_000 }))
    expect(verdict).toEqual({ action: 'reload', reason: 'render-error' })
  })

  it('refuses to reload twice in quick succession', () => {
    const verdict = watchdogVerdict(
      input({ renderErrorAt: NOW - 20_000, reloads: 1, lastReloadAt: NOW - 10_000 }),
    )
    expect(verdict).toEqual({ action: 'stand-down', detail: 'too-soon' })
  })

  it('spends its budget and then stops', () => {
    const verdict = watchdogVerdict(
      input({ renderErrorAt: NOW - 20_000, reloads: 3, lastReloadAt: NOW - 10 * 60_000 }),
    )
    expect(verdict).toEqual({ action: 'stand-down', detail: 'budget-exhausted' })
  })

  it('earns the budget back after a healthy stretch', () => {
    const verdict = watchdogVerdict(input({ reloads: 2, lastReloadAt: NOW - 6 * 60_000 }))
    expect(verdict).toEqual({ action: 'clear-history' })
  })

  it('does not earn it back while the board is still unhealthy', () => {
    const verdict = watchdogVerdict(
      input({
        reloads: 2,
        lastReloadAt: NOW - 6 * 60_000,
        lastSuccessAt: NOW - 10 * 60_000,
      }),
    )
    expect(verdict).toEqual({ action: 'wait' })
  })

  it('never counts a board that has never connected as healthy', () => {
    const verdict = watchdogVerdict(
      input({ lastSuccessAt: null, reloads: 1, lastReloadAt: NOW - 6 * 60_000 }),
    )
    expect(verdict).toEqual({ action: 'wait' })
  })

  it('fires exactly at the threshold, not a tick later', () => {
    expect(watchdogVerdict(input({ renderErrorAt: NOW - DEFAULT_LIMITS.renderErrorMs }))).toEqual({
      action: 'reload',
      reason: 'render-error',
    })
    expect(
      watchdogVerdict(input({ renderErrorAt: NOW - DEFAULT_LIMITS.renderErrorMs + 1 })),
    ).toEqual({ action: 'wait' })
  })
})

describe('installWatchdog', () => {
  it('reloads once the tree has been broken past the limit', async () => {
    const h = fixture()
    h.health.renderErrorAt = h.clock

    await h.advance(10_000)
    expect(h.reloads).toBe(0)

    await h.advance(10_000)
    expect(h.reloads).toBe(1)
  })

  it('records the reload before reloading, or the budget never increments', () => {
    const h = fixture()
    h.health.renderErrorAt = h.clock - 60_000

    h.watchdog.check()

    expect(h.stored.reloads).toBe(1)
    expect(h.stored.lastReloadAt).toBe(h.clock)
    // Ordering, not just presence: the page is gone before any statement after
    // `reload()` would run.
    expect(h.order).toEqual(['write', 'reload'])
  })

  /*
   * Liveness is "attempts are completing", not "data is arriving". A failing loop moves
   * this counter; only a dead one leaves it still.
   */
  it('treats a moving attempt counter as proof of life', async () => {
    const h = fixture()
    for (let i = 0; i < 60; i += 1) {
      h.health.attempts += 1
      await h.advance(3000)
    }

    expect(h.reloads).toBe(0)
  })

  it('reloads when the attempt counter freezes', async () => {
    const h = fixture()
    await h.advance(125_000)
    expect(h.reloads).toBe(1)
  })

  it('does not judge the loop stalled before it has polled once', async () => {
    const h = fixture()
    h.health.lastSuccessAt = null

    await h.advance(60_000)
    expect(h.reloads).toBe(0)
  })

  it('clears the history after a healthy stretch', async () => {
    const h = fixture({ reloads: 2, lastReloadAt: NOW - 6 * 60_000 })
    h.health.attempts += 1

    await h.advance(5000)

    expect(h.stored).toEqual({ reloads: 0, lastReloadAt: null })
  })

  it('stops checking when stopped', async () => {
    const h = fixture()
    h.watchdog.stop()
    h.health.renderErrorAt = h.clock - 60_000

    await h.advance(10 * 60_000)
    expect(h.reloads).toBe(0)
  })

  it('stands down rather than reloading forever', async () => {
    const h = fixture()
    h.health.renderErrorAt = NOW - 60_000

    // Each reload here is a page that would have come back broken.
    const verdicts: string[] = []
    for (let i = 0; i < 12; i += 1) {
      verdicts.push(h.watchdog.check().action)
      h.clock += 2 * 60_000
    }

    expect(h.reloads).toBe(DEFAULT_LIMITS.maxReloads)
    expect(verdicts.at(-1)).toBe('stand-down')
  })
})

describe('sessionHistory', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage()
    const history = sessionHistory(storage)

    history.write({ reloads: 2, lastReloadAt: 1234 })
    expect(history.read()).toEqual({ reloads: 2, lastReloadAt: 1234 })
  })

  it('reads a fresh session as no reloads', () => {
    expect(sessionHistory(fakeStorage()).read()).toEqual({ reloads: 0, lastReloadAt: null })
  })

  it('treats corrupt values as a fresh session', () => {
    const storage = fakeStorage()
    storage.setItem('zwml:watchdog:reloads', 'not a number')
    storage.setItem('zwml:watchdog:lastReloadAt', '')

    expect(sessionHistory(storage).read()).toEqual({ reloads: 0, lastReloadAt: null })
  })

  // Private browsing. The budget still holds within this page load, which is the part
  // that stops a reload loop.
  it('falls back to memory when there is no storage', () => {
    const history = sessionHistory(null)
    history.write({ reloads: 1, lastReloadAt: 5 })

    expect(history.read()).toEqual({ reloads: 1, lastReloadAt: 5 })
  })

  it('survives a storage that throws on write', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    } as unknown as Storage

    expect(() => sessionHistory(throwing).write({ reloads: 1, lastReloadAt: 1 })).not.toThrow()
  })
})

// ------------------------------------------------------------------------ harness

/** A store stand-in: the watchdog only ever reads `health()` and `getSnapshot()`. */
function fixture(past: { reloads: number; lastReloadAt: number | null } = { reloads: 0, lastReloadAt: null }) {
  const self = {
    clock: NOW,
    reloads: 0,
    order: [] as string[],
    stored: { ...past },
    health: {
      startedAt: NOW,
      lastSuccessAt: NOW,
      renderErrorAt: null,
      consecutiveFailures: 0,
      polls: 1,
      changes: 1,
      attempts: 1,
    } as BoardHealth,
    snapshot: initialSnapshot(2026) as BoardSnapshot,
    watchdog: null as unknown as ReturnType<typeof installWatchdog>,
    async advance(_ms: number) {
      /* replaced below */
    },
  }

  const timers = new Map<number, { fn: () => void; due: number }>()
  let nextHandle = 1

  const history: ReloadHistory = {
    read: () => self.stored,
    write: (entry) => {
      self.order.push('write')
      self.stored = { ...entry }
    },
  }

  const store: BoardStore = {
    subscribe: () => () => {},
    getSnapshot: () => self.snapshot,
    start: () => {},
    stop: () => {},
    refetch: () => {},
    noteRenderError: () => {},
    clearRenderError: () => {},
    health: () => self.health,
  }

  self.watchdog = installWatchdog({
    store,
    history,
    reload: () => {
      self.order.push('reload')
      self.reloads += 1
    },
    now: () => self.clock,
    setTimer: (fn, ms) => {
      const handle = nextHandle++
      timers.set(handle, { fn, due: self.clock + ms })
      return handle
    },
    clearTimer: (handle) => void timers.delete(handle),
  })

  self.advance = async (ms: number) => {
    const target = self.clock + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0]
      if (!due) break
      timers.delete(due[0])
      self.clock = due[1].due
      due[1].fn()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    self.clock = target
  }

  return self
}

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}
