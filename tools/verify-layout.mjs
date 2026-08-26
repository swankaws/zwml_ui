/**
 * Layout regression check across every resolution and data state that matters
 * (docs/DESIGN.md section 12).
 *
 * This is a real test, just not one Vitest can run: the suite runs in node with no DOM
 * at all, and adding jsdom would not help either -- it has no layout engine. So "do
 * twelve rows fit" and "does $200 fit in the LEFT column" are unanswerable in the unit
 * suite. Both were broken in the first phase-3 draft and neither showed up as a failing
 * test -- only on screen.
 *
 *   npm run build && npm run serve:dist &   # then
 *   npm run verify:layout
 *
 * Exits non-zero on any clipping, truncation, overflow, or overlap.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.ZWML_URL ?? 'http://localhost:8731/index.html'

/*
 * 1080p is the projector (Q7 revised). 1024x768 is the 4:3 fallback, kept in the
 * matrix from day one so it is exercised rather than discovered broken on the night.
 * 390x844 is a phone (Q8), which is what the column-priority system is really for.
 *
 * Every case names `fixture=` explicitly now. Phase 4 made the live sheet the default
 * path, so a query string without it asks the board to poll -- which in this harness
 * means no spreadsheet id, the setup card, and no rows to measure. The fixture path is
 * still what this gate needs: real CSVs, real widths, no network.
 */
const CASES = [
  { size: '1920x1080', query: '?fixture=2026&demoOrder=1', label: '1080p mid-draft' },
  { size: '1920x1080', query: '?fixture=2025&demoOrder=1', label: '1080p draft complete' },
  { size: '1920x1080', query: '?fixture=2026', label: '1080p order unset' },
  { size: '1024x768', query: '?fixture=2026&demoOrder=1', label: '4:3 mid-draft' },
  { size: '1024x768', query: '?fixture=2025&demoOrder=1', label: '4:3 draft complete' },
  { size: '1280x1024', query: '?fixture=2026&demoOrder=1', label: '5:4 mid-draft' },
  { size: '390x844', query: '?fixture=2026&demoOrder=1', label: 'phone portrait' },
  { size: '1440x900', query: '?fixture=2026&demoOrder=1', label: 'laptop' },
  /*
   * On the clock. `?cursor=` exists solely to keep this styling covered: phase 4 cannot
   * derive whose turn it is (see the note at the foot of ui/nominations.ts), so the live
   * board passes `null` and nobody is highlighted. Without this case the largest, boldest
   * string in the rail would go unmeasured until phase 6.
   */
  { size: '1920x1080', query: '?fixture=2026&demoOrder=1&cursor=3', label: '1080p on the clock' },
  { size: '1024x768', query: '?fixture=2026&demoOrder=1&cursor=3', label: '4:3 on the clock' },
  /*
   * The escape hatches from displaySettings.ts. These are in the matrix because
   * they only earn their keep if they work on the night, unrehearsed, on the first
   * try -- and the projector is not available until the day before the draft, so
   * there is no second chance to find out they clip.
   *
   * `scale=1.15` in particular is a *claim*: it is the documented ceiling in 7.1,
   * measured, and 1.20 clips. Gating it means a later change to the header height
   * or row chrome cannot quietly invalidate the number the doc tells the operator
   * to trust.
   */
  {
    size: '1920x1080',
    query: '?fixture=2026&scale=1.15&demoOrder=1',
    label: '1080p at the scale ceiling',
  },
  {
    size: '1920x1080',
    query: '?fixture=2026&rail=off&columns=manager,left,needs,maxbid&demoOrder=1',
    label: '1080p rail off, forced cols',
  },
  {
    size: '1024x768',
    query: '?fixture=2026&scale=1.1&rail=off&demoOrder=1',
    label: '4:3 scaled, rail off',
  },
  /*
   * The most demanding configuration the live SETTINGS tab has actually held: `scale: 1.15`
   * with `columns: manager, left, needs, maxbid` and the rail on, replayed down the sheet
   * path with `?asSheet=1`.
   *
   * It is no longer what the tab says -- the maintainer set `scale: 1.0` and removed the
   * `columns` row on 2026-08-25 -- and the cases stay anyway, because the tab is editable
   * during the draft and this is the corner of the configuration space with the least room
   * left. They were broken when first measured (clean at 1080p, clipping at all three
   * fallbacks), which is precisely the argument for gating configuration rather than only
   * code.
   *
   * `asSheet` is not incidental. A sheet-forced column set is fit-tested and a
   * URL-forced one is not (App's `columnsFrom`), so testing this through the query
   * string would exercise the wrong path and pass while the sheet still truncated.
   */
  {
    size: '1920x1080',
    query: '?fixture=2026&asSheet=1&scale=1.15&rail=on&columns=manager,left,needs,maxbid&demoOrder=1',
    label: 'LIVE TAB on the projector',
  },
  {
    size: '1024x768',
    query: '?fixture=2026&asSheet=1&scale=1.15&rail=on&columns=manager,left,needs,maxbid&demoOrder=1',
    label: 'LIVE TAB at 4:3',
  },
  {
    size: '1280x1024',
    query: '?fixture=2026&asSheet=1&scale=1.15&rail=on&columns=manager,left,needs,maxbid&demoOrder=1',
    label: 'LIVE TAB at 5:4',
  },
  {
    size: '390x844',
    query: '?fixture=2026&asSheet=1&scale=1.15&rail=on&columns=manager,left,needs,maxbid&demoOrder=1',
    label: 'LIVE TAB on a phone',
  },
  /*
   * The ceiling of the `scale` clamp, on the screen with the least room to give. The
   * phone ignores the multiplier outright (theme.css, `@media (max-width: 700px)`),
   * and this is what pins that: the fix is a cap rather than arithmetic tuned to
   * 1.15, so it has to hold for anything the sheet can broadcast.
   */
  {
    size: '390x844',
    query: '?fixture=2026&asSheet=1&scale=2&rail=on&demoOrder=1',
    label: 'phone, scale clamped',
  },
  /*
   * Notices on the wall (5.5, 6, phase 4). Four fumbled settings produce four warnings,
   * which is two more than the strip shows -- so this covers the cap and the "+N more"
   * item as well as the placement.
   *
   * The placement is the point, and these cases have already earned their keep: the strip
   * started life as a fixed overlay in the bottom-right corner, and `noticesCover` caught
   * it painting over four managers' MAX BID and position counts at all three of these
   * resolutions. It is now the shell's last row, so what needs gating is the opposite
   * failure -- a strip in the flow can push the twelfth manager off the screen instead.
   * `rowCount`, `rowsClipped` and `lastRowBottom` below are what say it does not.
   *
   * Unmatched and duplicated manager names take the same path and cannot be provoked from
   * a URL -- they need a doctored CSV -- so what is gated here is the strip, not every
   * message that can fill it.
   */
  {
    size: '1920x1080',
    query: '?fixture=2026&demoOrder=1&scale=abc&order=Nobody&columns=bogus&perslot=maybe',
    label: '1080p with notices',
  },
  {
    size: '1024x768',
    query: '?fixture=2026&demoOrder=1&scale=abc&order=Nobody&columns=bogus&perslot=maybe',
    label: '4:3 with notices',
  },
  {
    size: '1920x1080',
    query: '?fixture=2026&rail=off&demoOrder=1&scale=abc&order=Nobody&columns=bogus',
    label: '1080p notices, rail off',
  },
  /*
   * The scale ceiling WITH a warning strip showing -- the worst case in the file, and the
   * one that was missing. Every ingredient is real: a sheet-set scale near the ceiling,
   * the fallback projector, and one fumbled settings cell, which is all it takes for the
   * footer to appear and take ~35px off the rows. Nothing combined them, so the row budget
   * had only ever been measured with the footer collapsed.
   *
   * The two scales differ because the answer differs, and both numbers are measured:
   *
   *   1080p     1.15 clean -> fits.   1.15 + a warning -> the rows overflow by 1px.
   *             1.10 + a warning -> fits. So 1.10 is the ceiling to reach for on a sheet
   *             that might also be broadcasting a mistake.
   *   1024x768  1.15 + a warning -> fits. Width is the scarce axis at 4:3, not height.
   *
   * `order=Nobody` is the provocation: an order naming a manager who is not on the roster
   * is one warning, which is all it takes to occupy the footer.
   */
  {
    size: '1024x768',
    query:
      '?fixture=2026&asSheet=1&scale=1.15&rail=on&columns=manager,left,needs,maxbid&demoOrder=1&order=Nobody',
    label: '4:3 notices at the ceiling',
  },
  {
    size: '1920x1080',
    query:
      '?fixture=2026&asSheet=1&scale=1.10&rail=on&columns=manager,left,needs,maxbid&demoOrder=1&order=Nobody',
    label: '1080p notices at the ceiling',
  },
  /*
   * Section 8.1, checked rather than asserted. `?crash=1` renders a component that throws,
   * which is the only honest way to find out what the projector actually shows when the
   * React tree dies -- the unit suite has no DOM, so `boundaryState.test.ts` can prove the
   * transitions and nothing more. What has to be true here is that twelve managers and
   * their figures are still on the wall.
   */
  {
    size: '1920x1080',
    query: '?fixture=2026&crash=1',
    label: '1080p render crash',
    expect: 'frozen',
    allowConsole: /render error|deliberate render error|above error|Error Boundary|uncaught/i,
  },
  {
    size: '1024x768',
    query: '?fixture=2026&crash=1',
    label: '4:3 render crash',
    expect: 'frozen',
    allowConsole: /render error|deliberate render error|above error|Error Boundary|uncaught/i,
  },
  /*
   * The value flash (7.7), which is the only motion in the app.
   *
   * `?flash=N` marks N managers as just-changed. The row assertions below are the point: the overlay
   * is absolutely positioned and animates opacity only, so it must be incapable of moving a row or
   * pushing the twelfth off the screen -- and the harness has one recorded case of a mid-flight
   * transform shifting an element 44px and masking the overflow the gate existed to catch.
   */
  {
    size: '1920x1080',
    query: '?fixture=2026&demoOrder=1&cursor=0&flash=3',
    label: '1080p mid-flash',
    flash: 3,
  },
  {
    size: '1024x768',
    query: '?fixture=2026&demoOrder=1&cursor=0&flash=3',
    label: '4:3 mid-flash',
    flash: 3,
  },
  {
    size: '1920x1080',
    query: '?fixture=2026&demoOrder=1&cursor=0&flash=6&scale=1.15',
    label: 'flash at the ceiling',
    flash: 6,
  },
  /*
   * Bonus money (2026) on every manager at once, asserting the board is UNCHANGED by it.
   *
   * The maintainer's call was that the draft board does not show the award at all -- it is granted
   * once, it does not move during the auction, and it is already inside LEFT and MAX BID, which are
   * the numbers people act on. So these cases exist to prove a negative: awarding $125 to all twelve
   * must not shift a column, truncate a name, or cost a row. An earlier draft DID render a badge
   * beside each name, and MANAGER carries `text-overflow: ellipsis`, so an oversized one would have
   * truncated a NAME silently -- 7.1's recorded trap. The badge is gone; the guard stays.
   */
  { size: '1920x1080', query: '?fixture=2026&demoOrder=1&bonus=125', label: '1080p with bonuses' },
  { size: '1024x768', query: '?fixture=2026&demoOrder=1&bonus=125', label: '4:3 with bonuses' },
  { size: '1280x1024', query: '?fixture=2026&demoOrder=1&bonus=125', label: '5:4 with bonuses' },
  { size: '390x844', query: '?fixture=2026&demoOrder=1&bonus=125', label: 'phone with bonuses' },
  {
    size: '1920x1080',
    query: '?fixture=2026&demoOrder=1&bonus=125&scale=1.15',
    label: 'bonuses at the ceiling',
  },
  {
    size: '1920x1080',
    query: '?fixture=2025&view=roster&bonus=125',
    label: 'roster with bonuses',
    rosterCols: 6,
  },
  /*
   * The sale history (7.3), which is the one screen allowed to scroll on a projector. `?fixture=2025`
   * gives it 180 sales -- a completed draft -- which is the only content in the repo that fills it.
   * `?sort=oldest` measures the flipped order, which has no keyboard route.
   */
  { size: '1920x1080', query: '?fixture=2025&view=history&sales=180', label: 'history on the projector', history: 180 },
  { size: '1024x768', query: '?fixture=2025&view=history&sales=180', label: 'history at 4:3', history: 180 },
  { size: '390x844', query: '?fixture=2025&view=history&sales=180', label: 'history on a phone', history: 180, allowVerticalScroll: true },
  {
    size: '1920x1080',
    query: '?fixture=2025&view=history&sales=180&sort=oldest',
    label: 'history oldest first',
    history: 180,
  },
  /* Empty, which is what it looks like for the first minutes of every draft. */
  { size: '1920x1080', query: '?fixture=2026&view=history&sales=0', label: 'history empty', history: 0 },
  /*
   * The keyboard reference (7.9), at the two extremes of the matrix and at the scale ceiling.
   * It is an overlay, so it cannot push the board around -- what it CAN do is outgrow the screen,
   * which is what `helpClipped` checks. `?view=help` pins it open.
   */
  { size: '1920x1080', query: '?fixture=2026&view=help', label: 'help on the projector', help: 10 },
  { size: '1024x768', query: '?fixture=2026&view=help', label: 'help at 4:3', help: 10 },
  { size: '390x844', query: '?fixture=2026&view=help', label: 'help on a phone', help: 10 },
  {
    size: '1920x1080',
    query: '?fixture=2026&view=help&scale=1.15',
    label: 'help at the ceiling',
    help: 10,
  },
  /*
   * The roster view (7.4). `?fixture=2025` on purpose: that draft is COMPLETE, so every
   * one of the twelve blocks holds all fifteen players. It is the only content in the
   * repo that exercises this view at full load, and a view that fits nine picks and
   * clips at fifteen would pass any 2026 case.
   *
   * `rosterCols` pins the arrangement declared in `theme.css`, which is the only place that
   * decides it -- six across at 16:9, four below 3:2, one per row on a phone. The reasoning is
   * in that file's roster header; this is what stops a later change to it going unnoticed,
   * since a wrong column count shows up on screen only as names abbreviated a bit early.
   */
  {
    size: '1920x1080',
    query: '?fixture=2025&view=roster',
    label: 'roster on the projector',
    rosterCols: 6,
  },
  {
    size: '1024x768',
    query: '?fixture=2025&view=roster',
    label: 'roster at 4:3',
    rosterCols: 4,
  },
  {
    size: '1280x1024',
    query: '?fixture=2025&view=roster',
    label: 'roster at 5:4',
    rosterCols: 4,
  },
  {
    size: '1440x900',
    query: '?fixture=2025&view=roster',
    label: 'roster on a laptop',
    rosterCols: 6,
  },
  /*
   * The phone, whose roster view is KNOWN PARTIAL and gated as such rather than excluded.
   *
   * Twelve full squads cannot be shown legibly on a 390px screen -- two columns needs six
   * bands, which is ~7px type -- so this crops each block instead, and the assertion below
   * says exactly that: twelve blocks in two columns, and nothing OVERLAPPING. `allowSlotClip`
   * is what makes the limitation explicit; deleting the case would have made it invisible,
   * and asserting zero clipping would have made the suite lie. See the phone block in
   * theme.css and 7.4.
   */
  {
    size: '390x844',
    query: '?fixture=2025&view=roster',
    label: 'roster on a phone',
    rosterCols: 1,
    /*
     * Vertical scrolling is acceptable on a phone and horizontal is not, so this is the one
     * case that may exceed the viewport downward -- and the `docOverflow.x` assertion below
     * still applies to it, unchanged. Nothing may be CLIPPED here either: a phone that scrolls
     * must show all fifteen slots, not the top six.
     */
    allowVerticalScroll: true,
  },
  /*
   * The roster view at the scale ceiling, with a warning strip taking its 35px. The board
   * view's ceiling was measured this way (7.1) and this view has to survive the same
   * operator reaching for the same key.
   */
  {
    size: '1920x1080',
    query: '?fixture=2025&view=roster&scale=1.15&order=Nobody',
    label: 'roster at the ceiling',
    rosterCols: 6,
  },
  /* Mid-draft: mostly empty slots, which is what the room sees for the first hour. */
  {
    size: '1920x1080',
    query: '?fixture=2026&view=roster',
    label: 'roster mid-draft',
    rosterCols: 6,
  },
]

function measure(size, query) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(HERE, 'measure.mjs'), '--size', size, '--url', `${BASE}${query}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`measure.mjs exited ${code}: ${err}`))
      try {
        resolve(JSON.parse(out))
      } catch (cause) {
        reject(new Error(`unparseable output: ${out.slice(0, 400)}`, { cause }))
      }
    })
  })
}

const failures = []

for (const testCase of CASES) {
  const m = await measure(testCase.size, testCase.query)
  const problems = []
  const frozen = testCase.expect === 'frozen'
  const roster = testCase.rosterCols !== undefined

  if (testCase.history !== undefined) {
    /*
     * Every sale present and nothing truncated. This view SCROLLS on purpose, so vertical overflow
     * inside the table is expected -- what must not happen is a row wider than the screen, or a
     * player name clipped when there is a whole screen of width to spend.
     */
    if (m.historyRows !== testCase.history) {
      problems.push(`history lists ${m.historyRows} sales, expected ${testCase.history}`)
    }
    if (m.historyClipped) problems.push('a history row is wider than the view')
    if (testCase.history > 0 && !m.historyScrolls) {
      problems.push('the history table cannot scroll, so later sales are unreachable')
    }
  } else if (testCase.help !== undefined) {
    // The card must be complete and on screen. The board behind it is not this case's business.
    if (m.helpRows !== testCase.help) {
      problems.push(`help lists ${m.helpRows} shortcuts, expected ${testCase.help}`)
    }
    if (m.helpClipped) problems.push('the help card does not fit the screen')
  } else if (roster) {
    /*
     * The board's row and column checks do not apply -- there is no table here. What
     * replaces them is this view's own promise: twelve squads, all fifteen slots each,
     * nothing hidden.
     */
    if (m.rosterBlocks !== 12) problems.push(`roster shows ${m.rosterBlocks} blocks, expected 12`)
    if (m.rosterColumns !== testCase.rosterCols) {
      problems.push(`roster laid out ${m.rosterColumns} columns, expected ${testCase.rosterCols}`)
    }
    if (m.rosterMaxSlots !== 15) {
      problems.push(`fullest roster block shows ${m.rosterMaxSlots} slots, expected 15`)
    }
    /*
     * Bare initials mean the layout failed to be readable, and nothing else here can see it.
     * Allowed only on the phone, which is documented as partial.
     */
    if (m.rosterNames && m.rosterNames.initials > 0) {
      problems.push(
        `${m.rosterNames.initials} of ${m.rosterNames.total} names reduced to bare initials`,
      )
    }
    for (const hit of m.rosterClipped ?? []) {
      // A cropped block is tolerated only where it is documented; a block painted OUTSIDE
      // the grid never is, because that is the overlap failure and it looks like garbage.
      problems.push(`roster ${hit.kind} clipped: "${hit.text}"`)
    }
  } else if (frozen) {
    /*
     * The board is *supposed* to be gone here, so none of the column and row checks
     * below apply. What replaces them is the promise 8.1 actually makes: the figures
     * survive. A "something went wrong" card would pass every other assertion in this
     * file and fail the room.
     */
    if (m.boundary !== 'frozen') problems.push(`boundary is "${m.boundary}", expected "frozen"`)
    if (m.frozenRows !== 12) problems.push(`frozen board shows ${m.frozenRows} managers, expected 12`)
    if (!/LAST GOOD READING/.test(m.frozenBanner)) {
      problems.push(`frozen banner does not say the figures are stale: "${m.frozenBanner}"`)
    }
  } else {
    // Twelve managers, always. Losing one to a clip is the worst failure here: the
    // board looks fine and is simply missing a person.
    if (m.rowCount !== 12) problems.push(`rowCount ${m.rowCount}, expected 12`)
    if (m.rowsClipped) problems.push('rows overflow the board')
    if (m.lastRowBottom > m.viewport.h) {
      problems.push(`last row ends at ${m.lastRowBottom}, past the ${m.viewport.h}px viewport`)
    }
    if (m.h1Truncated) {
      problems.push(
        `title truncated: "${m.h1Truncated.text}" in ${m.h1Truncated.w}px, needs ${m.h1Truncated.need}px`,
      )
    } else if (m.headerTruncated) {
      problems.push(`header truncated: ${m.headerText}`)
    }
    if (m.railOverlapsTable) {
      problems.push(`rail overlaps the table by ${JSON.stringify(m.railOverlapsTable)}`)
    }
    for (const cell of m.truncatedCells) {
      problems.push(`truncated cell ${cell.cls}: "${cell.text}" in ${cell.w}px, needs ${cell.need}px`)
    }
    for (const el of m.railClipped) problems.push(`clipped in rail: "${el.text}"`)
    // MANAGER and MAX BID are priority 1 and may never be dropped.
    if (!m.columns.includes('MANAGER')) problems.push('MANAGER column missing')
    if (!m.columns.includes('MAX BID')) problems.push('MAX BID column missing')
    if (m.boundary !== 'ok') problems.push(`boundary is "${m.boundary}", expected "ok"`)
  }

  /*
   * The touch controls, asserted on EVERY case rather than in one of their own. Their contract is
   * as much about absence as presence: visible on a phone because there is no keyboard, invisible
   * on a projector because a wall does not get buttons.
   */
  const phone = m.viewport.w <= 700
  /*
   * The keyboard reference has to be reachable without knowing a key exists. On a display with a
   * keyboard that is the `?` beside the title; on a phone it is a touch control, and the title
   * mark would be noise. Both halves are asserted, because "shows up in the wrong place" is the
   * failure that reaches the wall.
   */
  if (m.helpOpen && !frozen) {
    // Not on the frozen fallback: the React tree is dead there, so there is no header to carry it
    // and no handler to answer it. `FrozenBoard` is plain text on purpose (8.1).
    if (!phone && !m.helpOpen.visible) problems.push('the `?` beside the title is not visible')
    if (phone && m.helpOpen.visible) problems.push('the `?` beside the title shows on a phone')
  }
  if (m.touchButtons) {
    if (phone && m.touchButtons.visible < 2) {
      problems.push(`phone shows ${m.touchButtons.visible} touch controls, expected 2`)
    }
    if (!phone && m.touchButtons.visible > 0) {
      problems.push(`${m.touchButtons.visible} touch controls visible on a non-phone display`)
    }
    if (phone && m.touchButtons.minSide !== null && m.touchButtons.minSide < 44) {
      problems.push(`touch target is ${m.touchButtons.minSide}px, under the 44px minimum`)
    }
  }

  if (testCase.flash !== undefined) {
    if (m.flashRows !== testCase.flash) {
      problems.push(`${m.flashRows} rows flashing, expected ${testCase.flash}`)
    }
    /*
     * The rail washes too, and its overlays are inset OUTSIDE their element (`inset: -0.12em -0.3em`)
     * so they read at rail width -- which is the one version of this that could plausibly overflow.
     * `railClipped` and the row assertions above are what say it does not.
     */
    if (m.flashSales === 0) problems.push('no LAST SOLD entry is washing')
    if (m.flashNominee === 0) problems.push('the on-clock nominee is not washing')
  }

  if (m.docOverflow.x > 0) problems.push(`${m.docOverflow.x}px horizontal overflow`)
  if (m.docOverflow.y > 0 && !testCase.allowVerticalScroll) {
    problems.push(`${m.docOverflow.y}px vertical overflow`)
  }

  /*
   * A notice may not cover anything a viewer came to read. The strip is in the flow now,
   * so this should always be empty -- it is here because the version that was *not* in the
   * flow passed every other assertion in this file while hiding four managers' figures.
   */
  for (const el of m.noticesCover ?? []) {
    problems.push(`notices cover ${el.cls}: "${el.text}"`)
  }
  // One line, always. A second line is another manager's row, quietly spent.
  if (m.noticeRows !== null && m.noticeRows > 1) {
    problems.push(`notices wrap onto ${m.noticeRows} lines, expected 1`)
  }
  // Showing two of fifteen problems without the count reads as two problems.
  if (m.noticeMoreClipped) problems.push('the "+N more" count is clipped out of the strip')
  if (/notices/.test(testCase.label) && m.noticeCount === 0) {
    problems.push('expected notices on screen, found none')
  }

  for (const message of m.console.filter((c) => /error|failed to load/i.test(c))) {
    // The 404 for /favicon.ico is expected in the static harness.
    if (/favicon/i.test(message)) continue
    // A case that deliberately crashes the tree logs the crash. That is the feature.
    if (testCase.allowConsole?.test(message)) continue
    problems.push(`console: ${message}`)
  }

  const status = problems.length === 0 ? 'ok  ' : 'FAIL'
  console.log(
    `${status} ${testCase.size.padEnd(10)} ${testCase.label.padEnd(24)} ` +
      (testCase.help !== undefined
        ? `helpRows=${m.helpRows} card=${m.help?.w}x${m.help?.h}`
        : roster
        ? `blocks=${m.rosterBlocks} cols=${m.rosterColumns} slots=${m.rosterMaxSlots}` +
          ` type=${m.rosterTypePx}px slack=${-m.rosterOverflowPx}px` +
          ` abbrev=${m.rosterNames?.abbreviated}/${m.rosterNames?.total}`
        : frozen
        ? `boundary=${m.boundary} rows=${m.frozenRows}`
        : `cols=${m.columns.length} rowH=${m.firstRow?.h} maxBid=${m.typePx['.cell-maxBid']}px` +
          // Slack, not just pass/fail: the negative number is how much room a future
          // change to the header or the footer has left to spend before 12 rows stop fitting.
          ` slack=${-m.rowsOverflowPx}px` +
          (m.noticeCount > 0 ? ` notices=${m.noticeCount}@${m.notices?.h}px` : '')),
  )
  for (const problem of problems) console.log(`       - ${problem}`)
  if (problems.length > 0) failures.push({ ...testCase, problems })
}

console.log(
  failures.length === 0
    ? `\nAll ${CASES.length} layout cases pass.`
    : `\n${failures.length} of ${CASES.length} layout cases failed.`,
)
process.exit(failures.length === 0 ? 0 : 1)
