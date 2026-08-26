/**
 * The live board: polling, change detection, backoff, and the snapshot the UI reads
 * (docs/DESIGN.md sections 4, 8, 8.1).
 *
 * **This deliberately lives outside React.** Section 8.1's blank-projector failure has
 * two halves, and the second one is architectural: if the poll loop runs in an effect,
 * then the unmount that blanks the screen also cancels the timer that was supposed to
 * notice. The recovery mechanism and the thing it recovers share a fate. So the loop
 * owns its own timers here, the UI subscribes to it, and an unmounted tree stops
 * *rendering* without stopping *polling* -- which is what lets the watchdog reload a
 * board whose React tree has died.
 *
 * Everything is injected: the source, the clock, the timers. There is no `fetch`, no
 * `Date.now()` and no `setTimeout` reached for directly, so the whole loop -- including
 * backoff, staleness and recovery -- is unit-testable with no network and no fake
 * timers.
 */

import { parseCsv } from '../data/csv'
import { parseAuctionGrid } from '../data/gridParser'
import { deriveLeague, type LeagueState } from '../model/derive'
import { resolveNominationOrder } from '../model/order'
import { parseSettingsGrid, type DisplaySettings } from '../config/displaySettings'
import {
  SheetFetchError,
  feedStateFor,
  formatAge,
  nextDelay,
  type FeedState,
  type SheetSource,
} from '../data/sheetClient'
import {
  applyDiff,
  diffSlots,
  nextSequence,
  snapshotSlots,
  type SaleEvent,
  type SlotMap,
} from '../model/diff'
import { countsFromSlots, type PointerBasis } from '../model/pointer'
import { RESYNC_NOTICE_MS, isRestorable, type SessionStore } from './session'
import type { ManagerBlock } from '../data/gridParser'

/**
 * An operator-actionable problem. Distinct from a warning: a warning means "the board
 * is up and something is a bit wrong", a problem means "nobody can fix this by
 * waiting". Every one of them carries the fix, because the person who can apply it is
 * across the room and not reading a console.
 */
export interface BoardProblem {
  kind: 'unauthorized' | 'notFound' | 'wrongTab' | 'internal'
  message: string
  action: string
}

export interface BoardSnapshot {
  year: number
  /** `null` until the first successful parse -- the UI shows a waiting state. */
  state: LeagueState | null
  order: readonly string[]
  /**
   * Sales this session, **newest first** -- the order `LAST SOLD` reads in.
   *
   * Empty at page load and filling as the draft proceeds, which is not a limitation but
   * the specified behavior (7.3): keepers are already in the sheet when the board opens,
   * so they are the baseline and correctly never appear here.
   */
  sales: readonly SaleEvent[]
  /**
   * What the nomination pointer is derived FROM, rather than the pointer itself.
   *
   * The order is settled later than this is -- `settings.order` and `?order=` both
   * override what the store parsed (7.5's four sources) -- and the pointer is an index
   * into whichever list is rendered. See `model/pointer.ts`.
   */
  pointer: PointerBasis
  /** The SETTINGS-tab layer only. The caller merges the query layer above it. */
  sheetSettings: Partial<DisplaySettings>
  feed: FeedState
  feedLabel: string
  /** Parse, order and settings warnings, already formatted for display. */
  warnings: string[]
  problem: BoardProblem | null
  lastSuccessAt: number | null
}

export interface BoardStoreOptions {
  source: SheetSource
  gid: string
  year: number
  /** `null` skips the settings poll entirely. */
  settingsGid?: string | null
  pollIntervalMs: number
  settingsPollIntervalMs: number
  now: () => number
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (handle: number) => void
  /** Called after the first successful fetch, to persist a working sheet id (9.1). */
  onFirstSuccess?: () => void
  /** A one-off warning from tab selection (`?year=` naming an unconfigured year). */
  tabWarning?: string | null
  /**
   * Where the pointer and the sale log survive a reload (7.5). Omit to keep them in memory only.
   *
   * Injected rather than reached for, like the clock and the timers, so the whole restore /
   * reconcile / absorb path is unit-testable with no browser.
   */
  session?: SessionStore | null
}

export interface BoardStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): BoardSnapshot
  start(): void
  stop(): void
  /** The `r` key and `visibilitychange`: poll now rather than waiting out the timer. */
  refetch(): void
  /** `N` / `Shift+N`: correct who is on the clock, persistently (7.5). */
  nudgeCursor(delta: number): void
  /** `X`: drop the sale log and the correction, then re-baseline from the next poll. */
  resetSession(): void
  noteRenderError(): void
  clearRenderError(): void
  /** Read by the watchdog and the endurance harness, neither of which has a snapshot. */
  health(): BoardHealth
}

export interface BoardHealth {
  startedAt: number
  lastSuccessAt: number | null
  /** When the error boundary last caught a render error, if it has not cleared. */
  renderErrorAt: number | null
  consecutiveFailures: number
  /** Successful auction-tab fetches. */
  polls: number
  /** Fetches whose body differed from the previous one, i.e. real edits seen. */
  changes: number
  /**
   * Completed auction-tab attempts, successes and failures alike.
   *
   * This is the watchdog's liveness signal, and it counts failures on purpose: a loop
   * that is failing is still a loop that is *running*, and it will recover on its own.
   * Only a counter that stops moving means the loop itself has died.
   */
  attempts: number
}

/**
 * Shared so a snapshot rebuilt for an age tick keeps a stable `sales` reference.
 *
 * This is load-bearing, not tidiness. `LiveBoard` passes the snapshot itself as the error
 * boundary's `resetKey`, so a freshly allocated array on every publish would churn that
 * key once a second -- burning all three of `boundaryState`'s recoveries in three seconds
 * and, worse, repeatedly clearing the store's render-error clock, which disables the one
 * watchdog condition that reloads a board whose React tree has died (8.1).
 */
const NO_SALES: readonly SaleEvent[] = []
const NO_COUNTS: Readonly<Record<string, number>> = {}

/**
 * Shown before the first fetch returns, so the wall is never blank and never lying.
 *
 * There is deliberately no companion "no sheet configured" snapshot. That state cannot
 * be expressed as a snapshot honestly: fixing it means typing a link, so it needs an
 * input and a button, which is `ui/Setup.tsx`. With no id there is nothing to poll, so
 * the entry point never builds a store at all.
 */
export function initialSnapshot(year: number): BoardSnapshot {
  return {
    year,
    state: null,
    order: [],
    sales: NO_SALES,
    pointer: { baselineCounts: NO_COUNTS, log: NO_SALES, offset: 0 },
    sheetSettings: {},
    feed: 'stale',
    feedLabel: 'CONNECTING',
    warnings: [],
    problem: null,
    lastSuccessAt: null,
  }
}

export function createBoardStore(options: BoardStoreOptions): BoardStore {
  const {
    source,
    gid,
    year,
    settingsGid = null,
    pollIntervalMs,
    settingsPollIntervalMs,
    now,
    setTimer,
    clearTimer,
    onFirstSuccess,
    tabWarning = null,
    session = null,
  } = options

  const listeners = new Set<() => void>()
  let snapshot = initialSnapshot(year)

  let running = false
  let startedAt = now()
  let lastSuccessAt: number | null = null
  let renderErrorAt: number | null = null
  let failures = 0
  let polls = 0
  let changes = 0
  let attempts = 0
  let problem: BoardProblem | null = null

  /*
   * The previous body, kept verbatim rather than hashed.
   *
   * Section 4 says "hash the response body", and at ~5 KB that is the wrong trade:
   * `===` on two 5 KB strings is a length check followed by a memcmp, so hashing adds
   * work AND a collision class -- and a collision here means the board silently stops
   * updating, which is the exact failure this check exists to prevent. Exact
   * comparison cannot be wrong, and at this size it cannot be slow either.
   */
  let lastAuctionText: string | null = null
  let lastSettingsText: string | null = null

  /**
   * Derived state, so an unchanged body costs one string comparison and nothing else.
   * Replaced wholesale, never mutated: that is what makes reference equality in
   * `equivalent` mean exactly "the board changed".
   */
  let derived: { state: LeagueState; order: readonly string[]; warnings: string[] } | null = null
  let settings: Partial<DisplaySettings> = {}
  let settingsWarnings: string[] = []
  /**
   * The roster the SETTINGS tab was last parsed against, or `null` if never.
   *
   * The tab's `order` is validated against whoever is actually playing (9.2), which comes from
   * the auction tab -- so a settings poll that lands FIRST has no roster to check against and
   * falls back to the committed list. That rejection then stuck for the whole session, because
   * settings are only re-parsed when the tab's text CHANGES, and this is not hypothetical: on
   * 2026-08-26 a stale committed roster made the deployed board reject the sheet's entire
   * nomination order with `"Brian" is not a known manager`, and it stayed rejected. Remembering
   * which roster was used lets the next successful parse re-run it against the real one.
   */
  let settingsRoster: readonly string[] | null = null

  /*
   * The sale log and what it is measured against (7.3, 7.5).
   *
   * Two distinct snapshots, and conflating them is a bug worth naming: `baseline` is the
   * sheet as it stood when this session opened and exists only to answer "how many picks
   * did each manager already have", which is where the rotation starts. `lastSlots` is the
   * previous poll, and it is what each diff actually compares against, so sales accumulate
   * one poll at a time. Diffing against the baseline forever would re-emit every sale of
   * the night on every poll.
   */
  let baselineCounts: Readonly<Record<string, number>> = NO_COUNTS
  let lastSlots: SlotMap | null = null
  let saleLog: readonly SaleEvent[] = NO_SALES
  /** `saleLog` reversed, memoized. Rebuilt only when the log changes -- see `NO_SALES`. */
  let salesView: readonly SaleEvent[] = NO_SALES
  /** The operator's running correction (7.5). Survives every later sale, by design. */
  let cursorOffset = 0
  /** Replaced wholesale whenever any of its three parts changes, so `===` is meaningful. */
  let pointerBasis: PointerBasis = { baselineCounts: NO_COUNTS, log: NO_SALES, offset: 0 }
  /**
   * A restored session has not yet been checked against the sheet, and until it has, the next
   * parse must not be diffed normally -- see `reconcile`.
   */
  let pendingReconcile = false
  /** When a restore last absorbed unaccounted picks, so the notice can expire (7.5). */
  let resyncedAt: number | null = null
  let resyncedCount = 0
  /** Latest parse/derive throw. One slot, not a list: see `noteInternalError`. */
  let internalWarning: string | null = null

  let auctionTimer: number | null = null
  let settingsTimer: number | null = null
  let ageTimer: number | null = null
  let inFlight: AbortController | null = null
  let settingsFailures = 0

  /*
   * Which poll is the current one. A forced refetch (the `r` key,
   * `visibilitychange`) aborts whatever is in flight and starts a new request, and
   * without this the abandoned one would still increment `failures` from its own
   * abort and schedule a second timer -- two loops polling at once, each undoing the
   * other's backoff.
   */
  let generation = 0

  /*
   * Restore before the first poll, so the very first parse is a reconciliation rather than a
   * baseline. Doing this at construction rather than in `start()` means a caller that reads a
   * snapshot before starting already sees the restored ticker.
   */
  restore()

  function restore() {
    const saved = session?.read() ?? null
    if (saved === null || !isRestorable(saved, year, now())) {
      // Stale, another year's, or malformed. 7.5: discard the baseline and the log, and
      // re-baseline from the current poll. Nothing to warn about -- this is the normal path on
      // every fresh open.
      if (saved !== null) session?.clear()
      return
    }

    baselineCounts = saved.baselineCounts
    lastSlots = saved.slots
    saleLog = saved.saleLog
    salesView = [...saved.saleLog].reverse()
    cursorOffset = saved.cursorOffset
    pendingReconcile = true
    setPointerBasis()
  }

  function notify() {
    for (const listener of listeners) listener()
  }

  /**
   * Rebuilds the snapshot and notifies only when something a viewer could see has
   * changed. `useSyncExternalStore` requires a stable reference between changes: an
   * always-fresh object is an infinite render loop, not merely a slow one.
   */
  function publish() {
    const next = buildSnapshot()
    if (equivalent(snapshot, next)) return
    snapshot = next
    notify()
  }

  function buildSnapshot(): BoardSnapshot {
    const age = lastSuccessAt === null ? null : now() - lastSuccessAt
    const feed: FeedState = age === null ? 'stale' : feedStateFor(age, pollIntervalMs)

    return {
      year,
      state: derived?.state ?? null,
      order: derived?.order ?? [],
      sales: salesView,
      pointer: pointerBasis,
      sheetSettings: settings,
      feed,
      feedLabel: label(feed, age),
      warnings: [
        ...(tabWarning ? [tabWarning] : []),
        ...(resyncNotice() ? [resyncNotice()!] : []),
        ...(derived?.warnings ?? []),
        ...(internalWarning ? [internalWarning] : []),
        ...settingsWarnings,
      ],
      problem,
      lastSuccessAt,
    }
  }

  /**
   * `LIVE` with no age, then `STALE · 47s` once the age is the point.
   *
   * Section 7.8 specifies `live · 2s`, and dropping the age while live is deliberate:
   * a digit changing every second in the header is exactly the "motion that pulls the
   * eye during bidding" that 7.7 bans, and while the feed is live the age tells the
   * room nothing the green dot does not already. The moment it stops being live the
   * age becomes the most important thing on the strip, so it appears and it ticks.
   */
  function label(feed: FeedState, age: number | null): string {
    if (age === null) return problem ? 'NO DATA' : 'CONNECTING'
    if (feed === 'live') return 'LIVE'
    return `${feed === 'stale' ? 'STALE' : 'OFFLINE'} · ${formatAge(age)}`
  }

  // ------------------------------------------------------------------ auction loop

  async function pollAuction(): Promise<void> {
    if (!running) return
    const mine = ++generation
    const controller = new AbortController()
    inFlight = controller

    try {
      const { text, at } = await source.fetchTab(gid, controller.signal)
      if (!running || mine !== generation) return

      attempts += 1
      failures = 0
      polls += 1
      lastSuccessAt = at
      if (polls === 1) onFirstSuccess?.()

      if (text !== lastAuctionText) {
        lastAuctionText = text
        changes += 1
        /*
         * Parsing is caught separately from fetching, and not just for tidiness: a
         * throw in the parser is not a network event, and letting it drive the retry
         * backoff would slow the poll loop to 15s intervals over a bug in our own
         * code -- on a feed that is answering perfectly.
         */
        try {
          applyAuctionText(text)
        } catch (cause) {
          noteInternalError(cause)
        }
      }
      /*
       * Written on every successful poll and AFTER the parse, not before it (7.5).
       *
       * On every poll, because `savedAt` is what the restore window is measured against and an
       * open tab must never age into staleness while it sits idle during a break in the auction.
       * After the parse, because before it there is nothing to save on the very first poll --
       * `lastSlots` is still null -- which left a poll-interval-wide hole where a reload lost the
       * baseline it had just established.
       */
      saveSession()
      publish()
    } catch (cause) {
      if (!running || mine !== generation) return
      attempts += 1
      failures += 1
      handleFetchError(cause)
    } finally {
      if (mine === generation) {
        inFlight = null
        if (running) scheduleAuction()
      }
    }
  }

  /**
   * Parse and derive. A tab that fails its template check does NOT replace the board:
   * section 5.2's wrong-tab case renders a plausible-looking grid of wrong numbers, so
   * the last good frame stays up and the problem is named instead of applied.
   */
  function applyAuctionText(text: string) {
    const tab = parseAuctionGrid(parseCsv(text))
    const parseWarnings = tab.warnings.map((w) => `${w.ref}: ${w.message}`)

    if (!tab.renderable) {
      /*
       * `derived` is deliberately left exactly as it was. The last good frame keeps its
       * own warnings; attaching this body's warnings to it would caption the numbers on
       * screen with complaints about a body that never reached the screen. The problem
       * carries the story instead.
       */
      problem = {
        kind: 'wrongTab',
        message: tab.warnings.find((w) => w.severity === 'fatal')?.message ?? 'Unreadable tab.',
        action: `Check that gid ${gid} is still the ${year} auction tab.`,
      }
      return
    }

    const state = deriveLeague(tab.blocks)
    const roster = state.managers.map((m) => m.name)
    const order = resolveNominationOrder(roster, tab.orderHint)

    derived = { state, order: order.order, warnings: [...parseWarnings, ...order.warnings] }
    problem = null
    internalWarning = null

    /*
     * Deliberately AFTER `derived` is assigned. A throw in here is caught by the caller's
     * parse guard, and `noteInternalError` returns early when a board is already on the
     * wall -- so a bug in the diff engine costs the room a warning line and this poll's
     * ticker entry, not the money figures, which came from the parse that already
     * succeeded. Ordering these the other way around would let a diff bug take the whole
     * screen.
     */
    trackSales(tab.blocks)
    reparseSettingsIfRosterChanged(roster)
  }

  /**
   * Re-run the remembered SETTINGS text when the roster it was validated against has changed.
   *
   * Covers the first-poll race above, and also a genuine mid-draft roster edit -- both end with
   * the tab's own `order` being judged against the twelve people actually on the board.
   */
  function reparseSettingsIfRosterChanged(roster: readonly string[]) {
    if (lastSettingsText === null) return
    if (settingsRoster !== null && sameStrings(settingsRoster, roster)) return
    try {
      const result = parseSettingsGrid(parseCsv(lastSettingsText), roster)
      settings = result.settings
      settingsWarnings = result.warnings
      settingsRoster = roster
    } catch {
      // A settings tab we cannot parse must never cost the room the auction (9.2).
    }
  }

  /**
   * Fold this poll into the sale log (7.3).
   *
   * Only ever reached for a *changed* and *renderable* body: an unchanged response never
   * gets here (the caller compares text first), and a failed template check returns above,
   * which is what stops a wrong-tab read from retracting the entire night as deletions.
   */
  function trackSales(blocks: readonly ManagerBlock[]) {
    const slots = snapshotSlots(blocks)

    if (lastSlots === null) {
      /*
       * First successful parse of the session: everything in the sheet is the baseline.
       * That is exactly what makes keepers not sales (7.3) -- they were entered in the days
       * before the draft, so they are already here on the first poll and never appear as
       * events. Gated on `lastSlots`, NOT on the poll counter: the first *poll* can succeed
       * while failing its template check, and baselining a wrong-tab read would make every
       * real pick look like a sale the moment the right tab came back.
       */
      lastSlots = slots
      baselineCounts = countsFromSlots(slots)
      setPointerBasis()
      return
    }

    const diff = diffSlots(lastSlots, slots, nextSequence(saleLog))
    lastSlots = slots

    /*
     * The first parse after a restore ABSORBS rather than replays (7.5 rule 2).
     *
     * Anything the sheet holds that the restored log cannot account for is treated as part of the
     * baseline: no `SaleEvent`, no ticker entry, no pointer advance. That is deliberately the
     * cautious direction -- keepers entered while the tab was shut would otherwise open the night
     * as a run of fake sales with the pointer that many managers along, which is the exact
     * failure 7.5 is written about.
     *
     * The cost is the opposite error, and it is much cheaper: a real sale that landed during the
     * reload is absorbed too, leaving the pointer one behind. That is visible (the `resynced`
     * notice below) and one keystroke to fix (`N`), whereas a phantom sale is neither.
     *
     * Corrections and retractions are still applied. They cannot invent a sale, and adopting them
     * keeps the log matching a sheet that was edited while we were away.
     */
    if (pendingReconcile) {
      pendingReconcile = false
      if (diff.sales.length > 0) {
        const counts: Record<string, number> = { ...baselineCounts }
        for (const sale of diff.sales) counts[sale.manager] = (counts[sale.manager] ?? 0) + 1
        baselineCounts = counts
        resyncedCount = diff.sales.length
        resyncedAt = now()
      }
      saleLog = applyDiff(saleLog, { sales: [], corrections: diff.corrections, retracted: diff.retracted })
      salesView = [...saleLog].reverse()
      setPointerBasis()
      return
    }

    const nextLog = applyDiff(saleLog, diff)
    if (nextLog === saleLog) return

    saleLog = nextLog
    // Reversed once here rather than in the render path, so the reference stays stable
    // across the age tick's re-publishes.
    salesView = [...nextLog].reverse()
    setPointerBasis()
  }

  function setPointerBasis() {
    pointerBasis = { baselineCounts, log: saleLog, offset: cursorOffset }
  }

  function saveSession() {
    if (session === null || lastSlots === null) return
    session.write({
      savedAt: now(),
      year,
      baselineCounts: { ...baselineCounts },
      slots: lastSlots,
      saleLog: [...saleLog],
      cursorOffset,
    })
  }

  /** `resynced · N absorbed`, for ~30s after a restore had to absorb (7.5). */
  function resyncNotice(): string | null {
    if (resyncedAt === null) return null
    if (now() - resyncedAt > RESYNC_NOTICE_MS) return null
    return `resynced: ${resyncedCount} pick${resyncedCount === 1 ? '' : 's'} absorbed into the baseline, not shown as sales. Press N if the nominator is wrong.`
  }

  /**
   * A throw from `parseCsv`, `parseAuctionGrid` or `deriveLeague` -- our bug, not
   * Google's.
   *
   * One slot rather than a list, because this is written from a poll loop: appending
   * would grow the array on every failing edit for four hours. And it only escalates
   * to a full-screen problem when there is no board to keep: with figures already on
   * the wall a warning line is the proportionate response (section 8), but with an
   * empty screen the header would otherwise read `LIVE` over nothing at all -- fetches
   * ARE succeeding -- which is the most misleading state this store can produce.
   */
  function noteInternalError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    internalWarning = `internal: ${message}`
    if (derived) return

    problem = {
      kind: 'internal',
      message: `Could not read the ${year} auction tab: ${message}`,
      action: 'Reload. If it persists, the tab layout has changed -- see DESIGN.md 5.1.',
    }
  }

  function handleFetchError(cause: unknown) {
    // `fetchTab` throws `SheetFetchError` and nothing else, so anything else is a
    // programming error -- a malformed gid reaching `csvUrl`, for instance.
    if (!(cause instanceof SheetFetchError)) {
      noteInternalError(cause)
      publish()
      return
    }

    if (cause.transient) {
      // Amber then red, driven purely by the age of the data on screen -- no separate
      // error state that could disagree with what the room is reading.
      publish()
      return
    }

    problem =
      cause.kind === 'unauthorized'
        ? {
            kind: 'unauthorized',
            message: 'Google refused the request: the workbook is not link-shared.',
            action: 'In Sheets: Share → General access → Anyone with the link → Viewer.',
          }
        : {
            kind: 'notFound',
            message: `No tab with gid ${gid} in this workbook.`,
            action: 'Check the spreadsheet link, then reload with #sheet=<link>.',
          }
    publish()
  }

  /**
   * The `r` key, `visibilitychange`, and `X`'s re-baseline: poll now.
   *
   * Resets the backoff as well as the timer. A forced refetch is a human saying "try now",
   * and making them wait out a 15-second penalty they cannot see, on the one machine nobody
   * is standing at, is indefensible.
   */
  function refetchNow() {
    if (!running) return
    failures = 0
    if (auctionTimer !== null) clearTimer(auctionTimer)
    auctionTimer = null
    generation += 1
    inFlight?.abort()
    inFlight = null
    void pollAuction()
  }

  function scheduleAuction() {
    if (auctionTimer !== null) clearTimer(auctionTimer)
    auctionTimer = setTimer(() => void pollAuction(), nextDelay(failures, pollIntervalMs))
  }

  // ----------------------------------------------------------------- settings loop

  /**
   * A second, slower loop, separate from the auction loop in every respect -- its own
   * timer, its own failure count, its own warnings. The SETTINGS tab is optional and
   * the board is not: a missing, renamed or malformed settings tab may cost the
   * operator their `scale`, but it may not cost the room the auction.
   *
   * Slower because it is edited between polls at most: 15 s of lag on a `rail: off` is
   * imperceptible, and the URL layer (9.2) exists for when a change must land at once.
   */
  async function pollSettings(): Promise<void> {
    if (!running || settingsGid === null) return

    try {
      const { text } = await source.fetchTab(settingsGid)
      if (!running) return
      settingsFailures = 0

      if (text !== lastSettingsText) {
        lastSettingsText = text
        /*
         * The roster comes from the auction tab, so `order` in the settings tab accepts
         * whoever is actually playing (9.2). Before the first auction poll lands there
         * is no roster yet and this falls back to the committed list -- which is why the
         * settings text is remembered and re-parsed on the next change rather than
         * treated as final.
         */
        const roster = derived?.state.managers.map((m) => m.name)
        const result = parseSettingsGrid(parseCsv(text), roster)
        settings = result.settings
        settingsWarnings = result.warnings
        // Remember WHICH roster judged it, so a later parse can correct a premature verdict.
        settingsRoster = roster ?? null
        publish()
      }
    } catch (cause) {
      if (!running) return
      settingsFailures += 1
      /*
       * Reported once, not once per poll. A deleted settings tab would otherwise add a
       * warning line every 15 s for four hours, and section 9.2's argument for the
       * blank-tab rule is precisely that a warning channel nobody trusts is worthless.
       */
      if (settingsFailures === 1 && cause instanceof SheetFetchError && !cause.transient) {
        settingsWarnings = [
          `SETTINGS tab (gid ${settingsGid}) unreadable: ${cause.message}. Using defaults.`,
        ]
        publish()
      }
    } finally {
      if (running) {
        if (settingsTimer !== null) clearTimer(settingsTimer)
        settingsTimer = setTimer(
          () => void pollSettings(),
          nextDelay(settingsFailures, settingsPollIntervalMs, 60_000),
        )
      }
    }
  }

  // -------------------------------------------------------------------- age ticker

  /**
   * Re-publishes once a second so a climbing age is visible on the wall.
   *
   * It runs unconditionally and costs nothing when the feed is healthy: while live the
   * label is the constant `LIVE`, so `publish` finds nothing changed and does not
   * notify. The board still re-renders exactly as often as the data moves.
   */
  function scheduleAgeTick() {
    if (ageTimer !== null) clearTimer(ageTimer)
    ageTimer = setTimer(() => {
      if (!running) return
      publish()
      scheduleAgeTick()
    }, 1000)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot() {
      return snapshot
    },

    start() {
      if (running) return
      running = true
      startedAt = now()
      void pollAuction()
      void pollSettings()
      scheduleAgeTick()
    },

    stop() {
      running = false
      generation += 1
      inFlight?.abort()
      inFlight = null
      for (const timer of [auctionTimer, settingsTimer, ageTimer]) {
        if (timer !== null) clearTimer(timer)
      }
      auctionTimer = settingsTimer = ageTimer = null
    },

    refetch: refetchNow,

    /**
     * `N` / `Shift+N` (7.5, 7.9). Moves the pointer without touching the sale log.
     *
     * "If the derived nominator ever disagrees with the room, the room is right." The log
     * stays the record of what sold; this is a running correction on top of it, so it holds
     * for the rest of the night instead of being undone by the next sale.
     */
    nudgeCursor(delta: number) {
      if (!Number.isFinite(delta) || delta === 0) return
      cursorOffset += Math.trunc(delta)
      setPointerBasis()
      saveSession()
      publish()
    },

    /**
     * `X` (7.9): re-baseline from the next poll and drop the correction.
     *
     * The recovery for a pointer or ticker that has gone wrong in a way no number of
     * nudges will fix. It does NOT clear the money -- that comes from the current parse and
     * was never in doubt.
     */
    resetSession() {
      lastSlots = null
      baselineCounts = NO_COUNTS
      saleLog = NO_SALES
      salesView = NO_SALES
      cursorOffset = 0
      pendingReconcile = false
      resyncedAt = null
      resyncedCount = 0
      session?.clear()
      setPointerBasis()
      publish()
      // Baselining needs a parse, and an unchanged body will not produce one -- the text
      // comparison skips it. Force the next response through the parser.
      lastAuctionText = null
      refetchNow()
    },

    noteRenderError() {
      // First occurrence only: the watchdog measures how long the tree has been broken,
      // and each re-render that throws again must not reset that clock.
      if (renderErrorAt === null) renderErrorAt = now()
    },

    clearRenderError() {
      renderErrorAt = null
    },

    health() {
      return {
        startedAt,
        lastSuccessAt,
        renderErrorAt,
        consecutiveFailures: failures,
        polls,
        changes,
        attempts,
      }
    },
  }
}

/**
 * Cheap equality over the fields a viewer can see.
 *
 * `state`, `order` and `sheetSettings` are compared by reference on purpose: each is
 * replaced wholesale when a body changes and never mutated in place, so reference
 * equality answers exactly "did this poll change anything".
 */
function equivalent(a: BoardSnapshot, b: BoardSnapshot): boolean {
  return (
    a.state === b.state &&
    a.order === b.order &&
    /*
     * By reference, like the three around it: both are replaced wholesale when they change
     * and never mutated. Comparing them by value would be slower AND wrong in the direction
     * that matters -- a pointer nudge changes only `offset`, and missing it means the
     * operator presses `N` and the wall does not move.
     */
    a.sales === b.sales &&
    a.pointer === b.pointer &&
    a.sheetSettings === b.sheetSettings &&
    a.feed === b.feed &&
    a.feedLabel === b.feedLabel &&
    equivalentProblem(a.problem, b.problem) &&
    sameStrings(a.warnings, b.warnings)
  )
}

function equivalentProblem(a: BoardProblem | null, b: BoardProblem | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.kind === b.kind && a.message === b.message
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
