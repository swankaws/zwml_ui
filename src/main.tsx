/**
 * Entry point. Phase 4: the live board (docs/DESIGN.md section 12).
 *
 * Three paths, and only the first is the product:
 *
 *   1. an id resolves        -> poll the sheet, watchdog installed. The default.
 *   2. no id resolves        -> the setup card (9.1). Nothing to poll.
 *   3. `?fixture=2026`       -> the offline board, for `tools/verify-layout.mjs`.
 *
 * Path 3 is no longer the default -- that was the phase-3 arrangement -- but it stays,
 * because the layout gate has to run against the built bundle with no network and no
 * spreadsheet id, and because `?asSheet=1` is the only way to rehearse what the live
 * SETTINGS tab will do to the column fit test.
 *
 * What lives HERE rather than in a component, and why (8.1): the store, the watchdog, the
 * key bindings and the visibility listener. All four have to survive the React tree, since
 * the failure they exist for is that tree unmounting itself. Anything registered from an
 * effect would be torn down by the very event it is supposed to detect.
 */

import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { FrozenBoard } from './ui/FrozenBoard'
import { LiveBoard } from './ui/LiveBoard'
import { Notices } from './ui/Notices'
import { Setup } from './ui/Setup'
import { loadFixture } from './dev/fixtureState'
import { createBoardStore, type BoardStore } from './live/boardStore'
import { installWatchdog, sessionHistory } from './live/watchdog'
import { browserSession, safeSessionStorage as safeSession } from './live/session'
import { createCsvSource } from './data/sheetClient'
import { pickAuctionTab } from './data/tabs'
import { confirmSheetId, resolveSheetId } from './config/sheetLocation'
import {
  columnsPinnedByQuery,
  resolveSettings,
  settingsFromQuery,
} from './config/displaySettings'
import { league } from './config/league'
import './ui/theme.css'

const search = window.location.search
const params = new URLSearchParams(search.replace(/^\?/, ''))
const tab = pickAuctionTab(search)

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  if (params.get('fixture') !== null) renderFixture(root)
  else renderLive(root)
}

// --------------------------------------------------------------------------- live path

function renderLive(root: ReturnType<typeof createRoot>) {
  const location = resolveSheetId()

  if (location.id === null) {
    /*
     * The id goes into the fragment, not the query string, and then the page reloads.
     * The fragment is never sent to a server, so the id stays out of Pages' access logs
     * (9.1); the reload is because every one of the singletons below -- store, watchdog,
     * listeners -- is built once from a resolved id, and re-entering that from a React
     * callback is a second, subtly different startup path to get wrong. A reload uses
     * the path that is exercised every other time the board starts.
     */
    root.render(
      <Setup
        year={tab.year}
        onAccept={(id) => {
          window.location.hash = `sheet=${id}`
          window.location.reload()
        }}
      />,
    )
    return
  }

  const store = createBoardStore({
    source: createCsvSource({ spreadsheetId: location.id }),
    gid: tab.gid,
    year: tab.year,
    settingsGid: league.settingsTabGid,
    pollIntervalMs: league.pollIntervalMs,
    /*
     * Five polls of the auction tab per poll of the settings tab. The settings tab is
     * edited between polls at most, and 15s of lag on a `rail: off` is imperceptible --
     * whereas a `?rail=off` in the address bar is instant, for when it is not.
     */
    settingsPollIntervalMs: league.pollIntervalMs * 5,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle),
    // Only now is the id worth remembering: a fetch has proved it works (9.1).
    onFirstSuccess: () => confirmSheetId(location),
    tabWarning: tab.warning,
    /*
     * The pointer and the ticker survive a reload (7.5) -- including the watchdog's own reload,
     * which is what made this necessary: the recovery for a dead tree was silently restarting the
     * rotation at the top of the order. `sessionStorage`, so a baseline can never outlive the tab
     * that made it; see the header of `live/session.ts`.
     */
    session: browserSession(safeSession(), `zwml:session:${tab.year}`),
  })

  logWarnings(store)
  store.start()

  installWatchdog({
    store,
    reload: () => window.location.reload(),
    history: sessionHistory(safeSessionStorage()),
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle),
  })

  /*
   * `r` for refetch, on `window` so it works with a dead React tree -- which is exactly
   * when someone will reach for it. Not `0`: `useDisplayScale` already owns `0` for
   * clearing a scale nudge, and a key that quietly does two things is a key that does
   * the wrong one at 8pm.
   *
   * No modifier, and no input to steal it from: the only text field in the app is the
   * setup card, which is on the other path entirely.
   */
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return

    /*
     * `g` -- get the sheet now.
     *
     * It was `r`, which collided with the roster-view toggle: one key quietly did two things, and
     * that reads as a bug even when both are harmless. `R` is the roster view (7.9 says so) and
     * this is the letter left that means "fetch". Not `0`, which `useDisplayScale` owns for
     * clearing a scale nudge.
     *
     * On `window` rather than in a component, because the moment someone reaches for this is the
     * moment the React tree has died and nothing is updating (8.1).
     */
    if (event.key === 'g' || event.key === 'G') return store.refetch()

    /*
     * `N` / `Shift+N` -- correct who is on the clock (7.5, 7.9).
     *
     * The board derives this from the sale log and gets it right in the normal case, but
     * draft night is unrepeatable: a sale entered out of order, a nomination passed over in
     * the room, a price typed into the wrong block. When the wall and the room disagree the
     * room is right, so this has to be one keystroke and it has to *stick* -- the store
     * holds it as a running offset, not a one-shot, or the next sale would undo it and the
     * operator would be re-correcting all night.
     *
     * `event.key` is already case-shifted by Shift, which is why this reads the letter
     * rather than the modifier: on a US layout Shift+n IS 'N'.
     */
    if (event.key === 'n') return store.nudgeCursor(1)
    if (event.key === 'N') return store.nudgeCursor(-1)

    /*
     * `X` -- forget the session and re-baseline from the next poll (7.9).
     *
     * The recovery when the ticker or the pointer has gone wrong in a way nudging cannot
     * fix. Deliberately not `Shift+R`, which is one slipped modifier away from the roster
     * toggle, and deliberately not a URL parameter: a `?reset=1` left in the address bar
     * would re-clear on every watchdog reload, all night.
     */
    if (event.key === 'x' || event.key === 'X') return store.resetSession()
  })

  /*
   * Browsers throttle timers in hidden tabs, so a board left on a second monitor or
   * behind a slideshow comes back holding minutes-old figures. This makes the first
   * thing it does on return be a fetch, rather than waiting out a throttled timer.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.refetch()
  })

  // For `tools/` and for a devtools console on the night: the endurance harness reads
  // `health()` and nothing else, and nothing in the app reads this back.
  Object.assign(window as unknown as Record<string, unknown>, { zwml: { store, tab } })

  root.render(<LiveBoard store={store} search={search} cursor={readCursor()} />)
}

/**
 * `Notices` caps itself at two and says "+N more (see the console)". This is what
 * makes that true. Logged on change rather than on every poll -- at 3s intervals for four
 * hours, a warning printed per poll is 4,800 lines of the same sentence.
 */
function logWarnings(store: BoardStore) {
  let last = ''
  store.subscribe(() => {
    const snapshot = store.getSnapshot()
    const current = [
      ...(snapshot.problem ? [`${snapshot.problem.message} ${snapshot.problem.action}`] : []),
      ...snapshot.warnings,
    ].join('\n')
    if (current === last) return
    last = current
    if (current !== '') console.warn(`[zwml]\n${current}`)
  })
}

/** Private-browsing modes throw on access, not on use. */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------ fixture path

/**
 * The offline board. No store, no polling, no watchdog -- committed CSVs through the real
 * parser and the real model, which is what `tools/verify-layout.mjs` measures in Chrome.
 */
function renderFixture(root: ReturnType<typeof createRoot>) {
  const fixture = loadFixture(search)
  const roster = fixture.state.managers.map((manager) => manager.name)
  const query = settingsFromQuery(search, roster)
  const settings = resolveSettings(query.settings)

  /*
   * `?asSheet=1` replays the same query settings down the SHEET path instead of the query
   * path. Provenance changes behaviour -- only a URL overrules the column fit test -- so
   * without this there is no way to check what the live SETTINGS tab will actually do to
   * the layout, and "we will find out on the night" is what section 10 refuses to accept.
   */
  const asSheet = params.get('asSheet') !== null
  const columnsFrom = !asSheet && columnsPinnedByQuery(search) ? 'query' : 'sheet'

  const warnings = [...fixture.warnings, ...query.warnings]
  if (warnings.length > 0) console.warn(`[zwml]\n${warnings.join('\n')}`)

  const board = (
    <App
      year={fixture.year}
      state={fixture.state}
      order={fixture.order}
      cursor={readCursor()}
      sales={fixture.sales}
      /*
       * A pointer basis, so the history view's NOMINATED BY column renders real names in the layout
       * gate rather than a column of dashes whose width nobody has measured. Empty baseline counts
       * and the fixture's own stand-in sales are enough -- `nominatorBySeq` only needs an order and
       * a log. `?cursor=` still pins the on-clock highlight; see the note in `App`.
       */
      pointer={{ baselineCounts: {}, log: fixture.sales, offset: 0 }}
      /*
       * `?flash=N` marks the first N managers as just-changed, for the layout gate.
       *
       * The fixture is static, so nothing ever moves and the flash overlay would never be rendered at
       * any resolution -- unmeasured motion is exactly the mistake the notices strip made. It is
       * opacity-only on an absolutely-positioned pseudo-element, so it should be provably incapable of
       * shifting a pixel; this is what lets the harness say so rather than assume it.
       */
      revisions={Object.fromEntries(
        fixture.state.managers
          .slice(0, Math.max(0, Number.parseInt(params.get('flash') ?? '0', 10) || 0))
          .map((manager) => [manager.name, 1]),
      )}
      settings={settings}
      columnsFrom={columnsFrom}
      feedLabel="FIXTURE"
      feed="stale"
      notices={
        <Notices
          problem={null}
          warnings={warnings}
          unmatched={fixture.state.unmatched}
          duplicated={fixture.state.duplicated}
        />
      }
    />
  )

  /*
   * `?crash=1` is how 8.1 gets verified for real. The boundary's decisions are unit-tested
   * in `boundaryState.test.ts`, but its actual promise -- the room keeps the figures -- is
   * a claim about pixels, and the suite has no DOM. So the harness renders a component
   * that throws and then reads the wall.
   *
   * `resetKey` is a constant here on purpose: with nothing to thaw the board, the two
   * crashes land back to back and it settles frozen, which is the state worth measuring.
   */
  const boundary = (
    <ErrorBoundary
      resetKey={0}
      fallback={
        <FrozenBoard state={fixture.state} year={fixture.year} feedLabel="FIXTURE" />
      }
    >
      {params.get('crash') !== null ? <Crash /> : board}
    </ErrorBoundary>
  )

  root.render(boundary)
}

function Crash(): never {
  throw new Error('?crash=1: deliberate render error, verifying DESIGN.md 8.1')
}

// ------------------------------------------------------------------------------ shared

/**
 * `?cursor=N` -- who is on the clock, for layout work only.
 *
 * Absent means `null`, i.e. "nobody has derived this", which is where phase 4 genuinely
 * is: `saleCount % order.length` is wrong once anyone's roster fills (see the note at the
 * foot of `ui/nominations.ts`), and phase 6 owns the chronological replay that fixes it.
 * The parameter exists so the on-clock styling stays covered by the layout gate until
 * then. Out-of-range values are fine -- `nominationWindow` wraps.
 */
function readCursor(): number | null {
  const raw = params.get('cursor')
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}
