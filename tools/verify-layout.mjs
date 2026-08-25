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

  if (frozen) {
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

  if (m.docOverflow.x > 0) problems.push(`${m.docOverflow.x}px horizontal overflow`)
  if (m.docOverflow.y > 0) problems.push(`${m.docOverflow.y}px vertical overflow`)

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
      (frozen
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
