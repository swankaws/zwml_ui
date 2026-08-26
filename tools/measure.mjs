/**
 * Layout verification harness (docs/DESIGN.md section 12).
 *
 * The board's whole job is to be readable across a room at a fixed resolution, so
 * "it looks fine on my laptop" is not evidence. This drives headless Chrome over
 * the DevTools Protocol at an exact viewport, measures the real DOM, and reports
 * anything that overflows or truncates.
 *
 * No dependencies: CDP over the WebSocket built into Node 22.
 *
 *   node tools/measure.mjs --url http://localhost:8731/index.html \
 *        --size 1920x1080 --shot /tmp/board.png
 */

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const url = arg('url', 'http://localhost:8731/index.html')
const [width, height] = arg('size', '1920x1080').split('x').map(Number)
const shot = arg('shot', null)
/*
 * Screenshot pixel density. Layout is unaffected -- CSS px stay CSS px -- so this is
 * purely for reading glyph rendering back off a small viewport, where a 390px-wide
 * capture is too coarse to tell a real hairline from a resampling artifact.
 */
const dpr = Number(arg('dpr', '1'))
/*
 * Extra settle time after the page reports itself loaded.
 *
 * The default covers fonts and the ResizeObserver's first measurement, which is all the
 * offline fixture needs. The LIVE board needs more and the difference is not cosmetic: its
 * first paint is the standby screen, which satisfies the load condition below, so a probe
 * taken at 400ms measures `Reading the sheet...` and reports a board with zero rows. Anyone
 * smoke-testing the deployed URL wants to wait out a real round trip to Google.
 */
const settle = Number(arg('settle', '400'))

/** Runs in the page. Returns everything worth asserting about the layout. */
const PROBE = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  /*
   * Null-safe, because not every screen has a board. The frozen fallback (8.1) and the
   * standby screen have no .rows at all, and an unguarded probe threw there -- which
   * reported as a harness crash rather than as the layout answer it was asked for.
   */
  const truncated = (el) => !!el && el.scrollWidth > el.clientWidth + 1
  const clipped = (el) => !!el && el.scrollHeight > el.clientHeight + 1

  const rows = [...document.querySelectorAll('.rows .row')]
  const cells = [...document.querySelectorAll('.cell')]

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    app: box(document.querySelector('.app')),
    /*
     * The error boundary's state (8.1). 'frozen' means the plain-text fallback is on
     * screen; the row count beside it is the promise being checked -- the room keeps the
     * figures, rather than getting a "something went wrong" card.
     */
    boundary: document.querySelector('.boundary')?.dataset.boundary ?? null,
    frozenRows: document.querySelectorAll('.frozen-table tbody tr').length,
    frozenBanner: (document.querySelector('.frozen-banner')?.textContent ?? '').trim(),
    notices: box(document.querySelector('.notices')),
    noticeCount: document.querySelectorAll('.notice, .notice-problem').length,
    /*
     * The strip must stay one line. It is nowrap, so it cannot wrap on its own -- but a
     * future rule that let it would silently take a manager's row, and nothing else here
     * would report it.
     *
     * Counted as distinct child top edges, not as height / line-height: the first version
     * of this divided the strip's clientHeight by its line-height and reported a perfectly
     * flat strip as "1.5 lines", because that ratio measures the children's padding and
     * borders rather than how many rows they sit in.
     */
    noticeRows: (() => {
      const el = document.querySelector('.notices')
      if (!el) return null
      const tops = new Set(
        [...el.children].map((c) => Math.round(c.getBoundingClientRect().top)),
      )
      return tops.size
    })(),
    /*
     * "+N more" is the one item that may not be clipped away: a board with fifteen
     * problems showing two and no count reads exactly like a board with two problems.
     */
    noticeMoreClipped: (() => {
      const strip = document.querySelector('.notices')
      const more = document.querySelector('.notice-more')
      if (!strip || !more) return null
      const a = strip.getBoundingClientRect()
      const b = more.getBoundingClientRect()
      return b.right > a.right + 1 || b.left < a.left - 1 || truncated(more)
    })(),
    /*
     * Notices used to be a fixed overlay, and this is the probe that killed that design:
     * at three of the matrix resolutions the strip painted over four managers' MAX BID
     * and position counts. In the flow it should now intersect nothing, and this stays to
     * keep it that way -- a notice that hides a manager costs the room the same manager
     * as a notice that pushes one off the screen.
     */
    noticesCover: (() => {
      const a = document.querySelector('.notices')?.getBoundingClientRect()
      if (!a) return null
      const hits = []
      for (const el of document.querySelectorAll('.rows .row .cell, .nominee, .sale-player, .sale-price')) {
        if ((el.textContent ?? '').trim() === '') continue
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) continue
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (x > 1 && y > 1) hits.push({ cls: el.className, text: el.textContent.trim() })
      }
      return hits
    })(),
    /*
     * The roster view (7.4). Twelve blocks, always: this view's whole claim is that the
     * room can see every squad at once, and a block pushed out of an overflow:hidden grid
     * would look exactly like a manager who does not exist.
     */
    rosterBlocks: document.querySelectorAll('.roster-block').length,
    /* Distinct left edges = columns actually rendered, per the roster grid in theme.css. */
    rosterColumns: (() => {
      const blocks = [...document.querySelectorAll('.roster-block')]
      if (blocks.length === 0) return null
      return new Set(blocks.map((b) => Math.round(b.getBoundingClientRect().left))).size
    })(),
    /* Slot rows in the fullest block, to catch a block whose 15 slots do not fit. */
    rosterMaxSlots: (() => {
      const blocks = [...document.querySelectorAll('.roster-block')]
      if (blocks.length === 0) return null
      return Math.max(...blocks.map((b) => b.querySelectorAll('.roster-slot').length))
    })(),
    /*
     * Anything the roster view is hiding. Three ways it can go wrong and they are all
     * silent: a name ellipsised past the abbreviation ladder, a block's slots taller than
     * the block, or a block painted outside the grid entirely.
     */
    rosterClipped: (() => {
      const grid = document.querySelector('.roster')
      if (!grid) return null
      const bounds = grid.getBoundingClientRect()
      const hits = []
      for (const el of document.querySelectorAll('.roster-player')) {
        if (truncated(el)) hits.push({ kind: 'name', text: el.textContent.trim() })
      }
      for (const el of document.querySelectorAll('.roster-slots')) {
        /*
         * An element whose overflow is visible cannot hide anything -- its content simply
         * paints outside the box, and on mobile the document scrolls to reach it. Checking the
         * computed value matters: sub-pixel line-box rounding over fifteen rows made
         * scrollHeight exceed clientHeight by 2px on the phone, which read as twelve clipped
         * blocks when nothing was cropped at all.
         */
        if (getComputedStyle(el).overflowY === 'visible') continue
        if (clipped(el)) hits.push({ kind: 'slots', text: '' })
      }
      for (const el of document.querySelectorAll('.roster-block')) {
        const r = el.getBoundingClientRect()
        if (r.bottom > bounds.bottom + 1 || r.right > bounds.right + 1) {
          hits.push({ kind: 'block', text: el.textContent.trim().slice(0, 20) })
        }
      }
      return hits
    })(),
    /*
     * How many px the fullest block's slots want beyond what they have. Negative is slack.
     * The boolean above answers "does it clip"; this answers "by how much", which is the
     * only question that lets a type size be chosen rather than guessed at.
     */
    rosterOverflowPx: (() => {
      const els = [...document.querySelectorAll('.roster-slots')]
      if (els.length === 0) return null
      return Math.max(...els.map((el) => el.scrollHeight - el.clientHeight))
    })(),
    /*
     * Names the abbreviation ladder shortened, and names it reduced to bare INITIALS.
     *
     * The ladder is a graceful degradation, which makes it an invisible one: it absorbs any
     * width shortfall completely, so nothing ellipsises, no overflow probe fires, and the
     * gate reports a clean layout while the wall shows "J D" 180 times. That is exactly what
     * happened -- a name budget wrong by 2x passed every case in this file.
     *
     * Ground truth is free: each cell carries the unabbreviated name in its title attribute.
     */
    rosterNames: (() => {
      const cells = [...document.querySelectorAll('.roster-player[title]')]
      if (cells.length === 0) return null
      let abbreviated = 0
      let initials = 0
      for (const cell of cells) {
        const shown = (cell.textContent ?? '').trim()
        const full = (cell.getAttribute('title') ?? '').trim()
        if (shown !== full) abbreviated += 1
        /*
         * No lowercase left means nothing survives but initials: "J D", "JC-M". Only counts
         * when the ladder actually shortened it -- the 2025 tab contains a player entered as
         * "JSN", which is all-caps, three characters and completely unabbreviated.
         */
        if (shown !== full && shown !== '' && shown === shown.toUpperCase()) initials += 1
      }
      return { total: cells.length, abbreviated, initials }
    })(),
    rosterTypePx: (() => {
      const el = document.querySelector('.roster-player')
      return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null
    })(),
    /*
     * The keyboard reference (7.9). Measured because it is the one overlay in the app, and an
     * unmeasured overlay is precisely how the notices strip shipped covering four managers.
     * What matters here is only that the card fits the screen -- covering the board is its job.
     */
    help: box(document.querySelector('.help-card')),
    helpRows: document.querySelectorAll('.help-row').length,
    helpClipped: (() => {
      const card = document.querySelector('.help-card')
      if (!card) return null
      const r = card.getBoundingClientRect()
      return (
        clipped(card) ||
        truncated(card) ||
        r.top < -1 ||
        r.left < -1 ||
        r.bottom > window.innerHeight + 1 ||
        r.right > window.innerWidth + 1
      )
    })(),
    /*
     * Touch controls (Q8, 7.9). Two things must be true and neither is visible to any other probe:
     * they are PRESENT on a phone, where there is no keyboard and the roster view would otherwise
     * be unreachable, and ABSENT everywhere else, where they would be clutter on a wall. The
     * measured height is checked against the 44px minimum target -- a control the room cannot
     * reliably hit is the same as no control.
     */
    /*
     * The "?" beside the title. Present on a display with a keyboard and absent on a phone, which
     * has its own in the touch controls -- and it must never be the thing that squeezes the title,
     * which is why h1Truncated below matters more here than anywhere.
     */
    helpOpen: (() => {
      const el = document.querySelector('.title-controls')
      if (!el) return { rendered: false, visible: false }
      const r = el.getBoundingClientRect()
      return { rendered: true, visible: r.width > 0 && r.height > 0 }
    })(),
    touchButtons: (() => {
      const buttons = [...document.querySelectorAll('.touch-button')]
      const shown = buttons.filter((b) => b.getBoundingClientRect().height > 0)
      return {
        rendered: buttons.length,
        visible: shown.length,
        minSide: shown.length
          ? Math.min(...shown.map((b) => {
              const r = b.getBoundingClientRect()
              return Math.min(Math.round(r.width), Math.round(r.height))
            }))
          : null,
        labels: shown.map((b) => (b.textContent ?? '').trim()),
      }
    })(),
    /*
     * The sale history (7.3). It is the one view that may scroll, so "does it overflow" is not the
     * question here -- the questions are whether every sale is present, whether the table can
     * actually be scrolled to reach them, and whether any row is wider than the screen.
     */
    historyRows: document.querySelectorAll('.history-row:not(.history-labels)').length,
    /*
     * Can the rest of the list be REACHED -- by the table scrolling on a desktop, or by the whole
     * page scrolling on a phone, where the shell is content-height and the document scrolls instead.
     * Asking only about the table reported the phone as broken when it was working correctly.
     */
    historyScrolls: (() => {
      const el = document.querySelector('.history-table')
      if (!el) return null
      const inner = el.scrollHeight > el.clientHeight
      const page =
        document.documentElement.scrollHeight > window.innerHeight ||
        document.body.scrollHeight > window.innerHeight
      return inner || page
    })(),
    historyClipped: (() => {
      const table = document.querySelector('.history-table')
      if (!table) return null
      const bounds = table.getBoundingClientRect()
      for (const row of document.querySelectorAll('.history-row')) {
        const r = row.getBoundingClientRect()
        if (r.right > bounds.right + 1 || r.left < bounds.left - 1) return true
      }
      for (const name of document.querySelectorAll('.history-player')) {
        if (truncated(name)) return true
      }
      return false
    })(),
    /*
     * The finale. It takes the whole content row, so what matters is that the card FITS -- a headline
     * wrapping mid-word or an award pushed off the bottom is the one way this reads as a fault rather
     * than a joke. Awards are derived, so the count varies by year; the gate asserts a floor, not a
     * number.
     */
    completeAwards: document.querySelectorAll('.complete-award').length,
    completeClipped: (() => {
      const card = document.querySelector('.complete-card')
      if (!card) return null
      const r = card.getBoundingClientRect()
      return (
        clipped(card) ||
        r.top < -1 ||
        r.bottom > window.innerHeight + 1 ||
        r.left < -1 ||
        r.right > window.innerWidth + 1
      )
    })(),
    /* The headline must never wrap onto more lines than it was written with. */
    completeHeadlineLines: (() => {
      const el = document.querySelector('.complete-headline')
      if (!el) return null
      const style = getComputedStyle(el)
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize)
      return Math.round(el.getBoundingClientRect().height / lh)
    })(),
    header: box(document.querySelector('.header')),
    stage: box(document.querySelector('.stage')),
    tableArea: box(document.querySelector('.table-area')),
    rail: box(document.querySelector('.rail')),
    /*
     * The once-only value flash (7.7). Two things must hold: the overlay is actually rendered when a
     * manager has moved, and it cannot shift anything -- it is opacity-only on an absolutely
     * positioned pseudo-element, and the row geometry below is what proves it.
     */
    flashRows: document.querySelectorAll('.rows .row[data-flash]').length,
    flashSales: document.querySelectorAll('.sale[data-flash]').length,
    flashNominee: document.querySelectorAll('.nominee[data-flash]').length,
    rowCount: rows.length,
    firstRow: box(rows[0]),
    lastRow: box(rows[rows.length - 1]),
    /* The bottom row must end inside the viewport, or the projector shows 11 of 12. */
    lastRowBottom: rows.length ? Math.round(rows[rows.length - 1].getBoundingClientRect().bottom) : null,
    rowsClipped: clipped(document.querySelector('.rows')),
    /*
     * How many px the rows want beyond what they have. Negative is slack.
     *
     * The boolean above answers "does it clip", which is all the gate needs, but it
     * cannot answer "how close to clipping is it" -- and that is the question behind
     * every documented scale ceiling in 7.1. Measuring against the viewport does not
     * work: .rows is overflow:hidden with minmax(0, 1fr) tracks, so it always fills
     * its box exactly and the overflow is entirely internal.
     */
    rowsOverflowPx: (() => {
      const el = document.querySelector('.rows')
      return el ? el.scrollHeight - el.clientHeight : null
    })(),
    boardWiderThanArea: (() => {
      const area = document.querySelector('.table-area')
      const row = rows[0]
      if (!area || !row) return null
      return Math.round(row.getBoundingClientRect().right - area.getBoundingClientRect().right)
    })(),
    /* Which column keys are on screen, in DOM order. */
    columns: [...document.querySelectorAll('.head .cell')].map((c) => c.textContent.trim()),
    /* Any cell whose text is ellipsised. This is what caught LEFT showing "$2...". */
    truncatedCells: cells
      .filter(truncated)
      .map((c) => ({ cls: c.className, text: c.textContent.trim(), w: Math.round(c.clientWidth), need: c.scrollWidth })),
    /*
     * Anything painted past the edge of the rail. Checking only .cell missed the
     * stacked 4:3 layout cropping "Christian McCaffery" mid-word, because the rail's
     * own overflow:hidden made it invisible to every other probe here.
     */
    railClipped: (() => {
      const rail = document.querySelector('.rail')
      if (!rail) return []
      const bounds = rail.getBoundingClientRect()
      return [...rail.querySelectorAll('.nominee, .sale-player, .sale-price, .empty')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.right > bounds.right + 1 || r.bottom > bounds.bottom + 1 || truncated(el)
        })
        .map((el) => ({ cls: el.className, text: el.textContent.trim() }))
    })(),
    /*
     * Header items that overflow are silently lost -- flex-nowrap does not warn.
     *
     * The h1 needs its own check: it carries text-overflow: ellipsis, so it
     * absorbs an overflow into "ZWML 202..." without ever making .header itself
     * overflow. Every other probe here reported that layout as clean.
     * (No backticks in this comment -- PROBE is a template literal.)
     */
    headerTruncated: truncated(document.querySelector('.header')) ||
      truncated(document.querySelector('.header h1')) ||
      [...document.querySelectorAll('.totals > *')].some((s) => s.getBoundingClientRect().right > window.innerWidth),
    h1Truncated: (() => {
      const h1 = document.querySelector('.header h1')
      if (!h1) return null
      return truncated(h1) ? { text: h1.textContent.trim(), w: Math.round(h1.clientWidth), need: h1.scrollWidth } : false
    })(),
    headerText: (document.querySelector('.header')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
    /* Rail overlapping the table is the 4:3 failure mode. */
    railOverlapsTable: (() => {
      const a = document.querySelector('.table-area')?.getBoundingClientRect()
      const b = document.querySelector('.rail')?.getBoundingClientRect()
      if (!a || !b) return null
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return overlapX > 1 && overlapY > 1 ? { x: Math.round(overlapX), y: Math.round(overlapY) } : false
    })(),
    /*
     * Overflow of whichever element is actually scrolling.
     *
     * This used to ask documentElement alone, and on mobile that is the wrong element: the phone
     * rules put overflow-y:auto on BODY, so body becomes the scroll container and
     * documentElement.scrollHeight stays pinned at the viewport. Measured, the phone history view
     * had 4797px of content in an 844px window and this probe reported ZERO overflow -- so the gate
     * was blind to mobile page scrolling in both directions, including the horizontal kind the
     * maintainer explicitly ruled out. Taking the max of the two covers either scroller.
     */
    docOverflow: {
      x: Math.round(
        Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          document.body.scrollWidth - window.innerWidth,
        ),
      ),
      y: Math.round(
        Math.max(
          document.documentElement.scrollHeight - window.innerHeight,
          document.body.scrollHeight - window.innerHeight,
        ),
      ),
    },
    /* Physical legibility (7.1): glyph px for the numbers that matter most. */
    typePx: Object.fromEntries(
      ['.cell-maxBid', '.cell-manager', '.cell-left', '.head', '.nominee', '.totals']
        .map((sel) => [sel, (() => {
          const el = document.querySelector(sel)
          return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 : null
        })()]),
    ),
  }
})()`

const profile = await mkdtemp(join(tmpdir(), 'zwml-chrome-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)

/** Chrome prints the DevTools ws endpoint to stderr once it is listening. */
const wsUrl = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools endpoint')), 20000)
  chrome.stderr.on('data', (chunk) => {
    buffer += chunk
    const match = buffer.match(/ws:\/\/[^\s]+/)
    if (match) {
      clearTimeout(timer)
      resolve(match[0])
    }
  })
  chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}): ${buffer}`)))
})

const socket = new WebSocket(wsUrl)
let nextId = 0
const pending = new Map()
const events = []

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
  } else {
    events.push(message)
  }
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function send(method, params = {}, sessionId) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)

await call('Page.enable')
await call('Runtime.enable')
await call('Log.enable')
// Emulation, not --window-size: the viewport must be exactly the projector's.
await call('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: dpr,
  mobile: false,
})

const consoleMessages = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
    const entry = message.params.entry
    const text = entry?.text ?? (message.params.args ?? []).map((a) => a.value ?? a.description).join(' ')
    // The URL matters: a bare "404 (File not found)" is indistinguishable between
    // Chrome's automatic favicon request and a genuinely missing asset.
    consoleMessages.push(entry?.url ? `${text} [${entry.url}]` : text)
  }
})

await call('Page.navigate', { url })
// Wait for load, then a beat for fonts and the ResizeObserver's first measurement.
await new Promise((resolve) => {
  const started = Date.now()
  const check = setInterval(async () => {
    const { result } = await call('Runtime.evaluate', {
      /*
       * A board, a frozen fallback, or a standby screen -- any of the three counts as
       * loaded. Waiting only for `.rows .row` made the `?crash=1` case sit out the full
       * 15s timeout and then measure a board that was never going to appear.
       */
      expression:
        'document.readyState === "complete" && ' +
        '!!document.querySelector(".rows .row, .frozen-table tbody tr, .frozen-empty, .standby")',
      returnByValue: true,
    })
    if (result.value === true || Date.now() - started > 15000) {
      clearInterval(check)
      resolve()
    }
  }, 100)
})
await new Promise((r) => setTimeout(r, settle))

const { result, exceptionDetails } = await call('Runtime.evaluate', {
  expression: PROBE,
  returnByValue: true,
  awaitPromise: false,
})
if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails))

if (shot) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(shot, Buffer.from(data, 'base64'))
}

console.log(JSON.stringify({ size: `${width}x${height}`, url, console: consoleMessages, ...result.value }, null, 2))

socket.close()
chrome.kill()
