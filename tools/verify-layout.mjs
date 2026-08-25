/**
 * Layout regression check across every resolution and data state that matters
 * (docs/DESIGN.md section 12).
 *
 * This is a real test, just not one Vitest can run: jsdom has no layout engine, so
 * "do twelve rows fit" and "does $200 fit in the LEFT column" are unanswerable in
 * the unit suite. Both were broken in the first phase-3 draft and neither showed up
 * as a failing test -- only on screen.
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
 */
const CASES = [
  { size: '1920x1080', query: '?demoOrder=1', label: '1080p mid-draft' },
  { size: '1920x1080', query: '?fixture=2025&demoOrder=1', label: '1080p draft complete' },
  { size: '1920x1080', query: '', label: '1080p order unset' },
  { size: '1024x768', query: '?demoOrder=1', label: '4:3 mid-draft' },
  { size: '1024x768', query: '?fixture=2025&demoOrder=1', label: '4:3 draft complete' },
  { size: '1280x1024', query: '?demoOrder=1', label: '5:4 mid-draft' },
  { size: '390x844', query: '?demoOrder=1', label: 'phone portrait' },
  { size: '1440x900', query: '?demoOrder=1', label: 'laptop' },
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
  { size: '1920x1080', query: '?scale=1.15&demoOrder=1', label: '1080p at the scale ceiling' },
  {
    size: '1920x1080',
    query: '?rail=off&columns=manager,left,needs,maxbid&demoOrder=1',
    label: '1080p rail off, forced cols',
  },
  { size: '1024x768', query: '?scale=1.1&rail=off&demoOrder=1', label: '4:3 scaled, rail off' },
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

  // Twelve managers, always. Losing one to a clip is the worst failure here: the
  // board looks fine and is simply missing a person.
  if (m.rowCount !== 12) problems.push(`rowCount ${m.rowCount}, expected 12`)
  if (m.rowsClipped) problems.push('rows overflow the board')
  if (m.lastRowBottom > m.viewport.h) {
    problems.push(`last row ends at ${m.lastRowBottom}, past the ${m.viewport.h}px viewport`)
  }
  if (m.docOverflow.x > 0) problems.push(`${m.docOverflow.x}px horizontal overflow`)
  if (m.docOverflow.y > 0) problems.push(`${m.docOverflow.y}px vertical overflow`)
  if (m.h1Truncated) {
    problems.push(
      `title truncated: "${m.h1Truncated.text}" in ${m.h1Truncated.w}px, needs ${m.h1Truncated.need}px`,
    )
  } else if (m.headerTruncated) {
    problems.push(`header truncated: ${m.headerText}`)
  }
  if (m.railOverlapsTable) problems.push(`rail overlaps the table by ${JSON.stringify(m.railOverlapsTable)}`)
  for (const cell of m.truncatedCells) {
    problems.push(`truncated cell ${cell.cls}: "${cell.text}" in ${cell.w}px, needs ${cell.need}px`)
  }
  for (const el of m.railClipped) problems.push(`clipped in rail: "${el.text}"`)
  // MANAGER and MAX BID are priority 1 and may never be dropped.
  if (!m.columns.includes('MANAGER')) problems.push('MANAGER column missing')
  if (!m.columns.includes('MAX BID')) problems.push('MAX BID column missing')
  for (const message of m.console.filter((c) => /error|failed to load/i.test(c))) {
    // The 404 for /favicon.ico is expected in the static harness.
    if (!/favicon/i.test(message)) problems.push(`console: ${message}`)
  }

  const status = problems.length === 0 ? 'ok  ' : 'FAIL'
  console.log(
    `${status} ${testCase.size.padEnd(10)} ${testCase.label.padEnd(22)} ` +
      `cols=${m.columns.length} rowH=${m.firstRow?.h} maxBid=${m.typePx['.cell-maxBid']}px`,
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
