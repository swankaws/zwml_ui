/**
 * Last-resort recovery for the wall (docs/DESIGN.md section 8.1).
 *
 * The failure this exists for: an uncaught render error unmounts the React 19 tree and
 * the projector goes white, in a room where nobody is holding a keyboard. Recovery
 * therefore cannot live inside the tree that broke, and it cannot live in an effect,
 * because the unmount that blanks the screen would take the timer with it. It lives
 * here, is installed from the entry point, and reads the store's `health()` -- never a
 * React value.
 *
 * **What it will NOT do is reload a board that is merely offline.** That was the first
 * design and it is backwards: a reload needs the network to serve index.html and the
 * hashed assets, so reloading during an outage swaps a readable board captioned
 * `OFFLINE · 4m` for the browser's error page -- and unlike the board, the error page
 * cannot recover by itself when the network returns. A failing poll loop is a *working*
 * poll loop; it needs no help. The two things that genuinely cannot self-heal are a
 * dead render tree and a poll loop that has stopped attempting anything at all, and
 * those are the only two triggers below.
 */

import type { BoardStore } from './boardStore'

export type WatchdogReason =
  /** The tree threw and has not recovered. Nothing inside the page can fix this. */
  | 'render-error'
  /** No completed fetch attempt -- not even a failure -- for `stalledMs`. */
  | 'loop-stalled'

export type WatchdogVerdict =
  | { action: 'wait' }
  | { action: 'reload'; reason: WatchdogReason }
  /** A reload is warranted but must not happen. `detail` says why. */
  | { action: 'stand-down'; detail: 'budget-exhausted' | 'too-soon' | 'operator-action-needed' }
  /** The board has been healthy long enough that the reload budget is spent honestly. */
  | { action: 'clear-history' }

export interface WatchdogInput {
  now: number
  /** When the poll loop last *completed* an attempt, successfully or not. */
  lastAttemptAt: number
  lastSuccessAt: number | null
  /** When the error boundary caught, if it has not cleared. */
  renderErrorAt: number | null
  /**
   * The board is showing an actionable instruction (`unauthorized`, `setup`, ...).
   * A reload would wipe the one thing on screen telling someone how to fix it.
   */
  blockedOnOperator: boolean
  reloads: number
  lastReloadAt: number | null
}

export interface WatchdogLimits {
  /** How long a caught render error may persist before reloading. */
  renderErrorMs: number
  /** How long the loop may complete nothing at all before reloading. */
  stalledMs: number
  /** Reloads per session. */
  maxReloads: number
  /** Minimum gap between reloads, so a reload that fails cannot spin. */
  minGapMs: number
  /** Healthy time after a reload that earns the budget back. */
  healthyMs: number
}

export const DEFAULT_LIMITS: WatchdogLimits = {
  /*
   * 15s. The boundary's own retry gets first go, and it renders the last good frame
   * while it tries, so the wall is frozen rather than blank -- 15s of frozen figures
   * is survivable, and it is short enough that a genuinely stuck tree is back before
   * the next nomination ends.
   */
  renderErrorMs: 15_000,
  /*
   * 40 missed polls at 3s. Long enough that no amount of ordinary lateness -- a
   * backed-off retry, a throttled background tab, a slow request -- can reach it, so
   * crossing it means the loop really has stopped.
   */
  stalledMs: 120_000,
  maxReloads: 3,
  minGapMs: 90_000,
  healthyMs: 5 * 60_000,
}

/**
 * Pure decision, so every branch is a unit test rather than a thing we discover on
 * draft night. Order matters and is deliberate; see the comments.
 */
export function watchdogVerdict(input: WatchdogInput, limits = DEFAULT_LIMITS): WatchdogVerdict {
  const { now, renderErrorAt, lastAttemptAt, lastSuccessAt, blockedOnOperator } = input

  /*
   * A dead tree outranks everything, including `blockedOnOperator`: an instruction
   * nobody can see is not an instruction, and the tree that would draw it is the thing
   * that is broken.
   */
  if (renderErrorAt !== null && now - renderErrorAt >= limits.renderErrorMs) {
    return gate(input, limits, 'render-error')
  }

  // Someone has to go and change a Google setting. Reloading throws away the sentence
  // telling them which one, and the board comes back in exactly the same state.
  if (blockedOnOperator) return { action: 'stand-down', detail: 'operator-action-needed' }

  if (now - lastAttemptAt >= limits.stalledMs) return gate(input, limits, 'loop-stalled')

  /*
   * Earn the budget back. Without this a session that used its three reloads in the
   * first minute is unprotected for the remaining four hours; with it, a board that
   * has run healthily for five minutes is treated as a fresh start -- which is what it
   * is.
   */
  if (
    input.reloads > 0 &&
    input.lastReloadAt !== null &&
    now - input.lastReloadAt >= limits.healthyMs &&
    lastSuccessAt !== null &&
    now - lastSuccessAt < limits.stalledMs
  ) {
    return { action: 'clear-history' }
  }

  return { action: 'wait' }
}

function gate(
  input: WatchdogInput,
  limits: WatchdogLimits,
  reason: WatchdogReason,
): WatchdogVerdict {
  if (input.reloads >= limits.maxReloads) {
    // Three reloads have not fixed it, so a fourth will not either, and a projector
    // reloading forever is worse than a frozen one: at least a frozen board can be
    // read while someone works out what is wrong.
    return { action: 'stand-down', detail: 'budget-exhausted' }
  }
  if (input.lastReloadAt !== null && input.now - input.lastReloadAt < limits.minGapMs) {
    return { action: 'stand-down', detail: 'too-soon' }
  }
  return { action: 'reload', reason }
}

/** The bits of `sessionStorage` this needs. Reloads must survive the reload. */
export interface ReloadHistory {
  read(): { reloads: number; lastReloadAt: number | null }
  write(entry: { reloads: number; lastReloadAt: number | null }): void
}

const RELOADS_KEY = 'zwml:watchdog:reloads'
const AT_KEY = 'zwml:watchdog:lastReloadAt'

/**
 * `sessionStorage`, which is the right store precisely because it is per-tab and dies
 * with the tab: the budget should protect against a reload loop within one run of the
 * board, not follow the operator into next year's draft.
 */
export function sessionHistory(storage: Storage | null): ReloadHistory {
  if (!storage) {
    // Private mode or storage disabled. In-memory is enough: it still stops a loop
    // *within* a page load, and there is nothing else to be done.
    let held = { reloads: 0, lastReloadAt: null as number | null }
    return { read: () => held, write: (entry) => void (held = entry) }
  }

  return {
    read() {
      try {
        const reloads = Number.parseInt(storage.getItem(RELOADS_KEY) ?? '', 10)
        const at = Number.parseInt(storage.getItem(AT_KEY) ?? '', 10)
        return {
          reloads: Number.isFinite(reloads) && reloads > 0 ? reloads : 0,
          lastReloadAt: Number.isFinite(at) ? at : null,
        }
      } catch {
        return { reloads: 0, lastReloadAt: null }
      }
    },
    write(entry) {
      try {
        storage.setItem(RELOADS_KEY, String(entry.reloads))
        if (entry.lastReloadAt === null) storage.removeItem(AT_KEY)
        else storage.setItem(AT_KEY, String(entry.lastReloadAt))
      } catch {
        // Quota or private mode. The in-page checks still hold for this load.
      }
    },
  }
}

export interface WatchdogOptions {
  store: BoardStore
  reload: () => void
  history: ReloadHistory
  now: () => number
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (handle: number) => void
  /** How often to check. Cheap: it reads two numbers. */
  checkIntervalMs?: number
  limits?: WatchdogLimits
  /** Called on every verdict, so the endurance run can see the reasoning. */
  onVerdict?: (verdict: WatchdogVerdict) => void
}

export interface Watchdog {
  /** Runs one check immediately. Exposed for tests and the endurance harness. */
  check(): WatchdogVerdict
  stop(): void
}

export function installWatchdog(options: WatchdogOptions): Watchdog {
  const {
    store,
    reload,
    history,
    now,
    setTimer,
    clearTimer,
    checkIntervalMs = 5000,
    limits = DEFAULT_LIMITS,
    onVerdict,
  } = options

  /*
   * "The loop is alive" is measured by attempts completing, not by data arriving.
   * The store reports a running total; this is where it turns into a timestamp, and
   * it starts as "now" so a watchdog installed before the first poll does not
   * immediately judge the loop stalled.
   */
  let lastAttempts = store.health().attempts
  let lastAttemptAt = now()
  let timer: number | null = null

  function check(): WatchdogVerdict {
    const health = store.health()
    if (health.attempts !== lastAttempts) {
      lastAttempts = health.attempts
      lastAttemptAt = now()
    }

    const past = history.read()
    const verdict = watchdogVerdict(
      {
        now: now(),
        lastAttemptAt,
        lastSuccessAt: health.lastSuccessAt,
        renderErrorAt: health.renderErrorAt,
        blockedOnOperator: store.getSnapshot().problem !== null,
        reloads: past.reloads,
        lastReloadAt: past.lastReloadAt,
      },
      limits,
    )
    onVerdict?.(verdict)

    if (verdict.action === 'clear-history') {
      history.write({ reloads: 0, lastReloadAt: null })
    } else if (verdict.action === 'reload') {
      // Recorded BEFORE reloading, or the budget never increments -- the page is gone
      // before the next statement would run.
      history.write({ reloads: past.reloads + 1, lastReloadAt: now() })
      reload()
    }

    return verdict
  }

  function schedule() {
    timer = setTimer(() => {
      check()
      schedule()
    }, checkIntervalMs)
  }
  schedule()

  return {
    check,
    stop() {
      if (timer !== null) clearTimer(timer)
      timer = null
    },
  }
}
