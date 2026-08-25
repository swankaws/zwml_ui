/**
 * Fetching one tab of the workbook (docs/DESIGN.md sections 4, 5.0, 8).
 *
 * Deliberately small and deliberately dumb: it gets text over HTTPS and classifies
 * what went wrong. It does not poll, parse, retain state, or know what a manager is.
 * Everything with a timer or a memory lives in `live/boardStore.ts`, which is what
 * lets this file be tested with a three-line fake `fetch`.
 *
 * `SheetSource` is the seam section 4 promises: the gviz variant (5.0), an Apps
 * Script proxy, or a local fixture server all satisfy it, so swapping endpoints
 * never reaches the store or the UI.
 */

import { csvUrl } from '../config/sheetLocation'

/** Why a fetch failed, in the terms the *room* needs rather than HTTP's. */
export type FetchFailureKind =
  /** Offline, DNS, CORS, or the request was cut off. Retry; it usually comes back. */
  | 'network'
  /** No answer inside the budget. Distinguished from `network` because a hung
   *  request looks identical to a working one until you give up on it. */
  | 'timeout'
  /** 401/403 -- the sheet is not link-shared. No amount of retrying fixes this;
   *  the operator has to change a Google setting (section 8). */
  | 'unauthorized'
  /** 400/404 -- the spreadsheet id or the gid is wrong. Also unfixable by retry. */
  | 'notFound'
  /** 5xx. Google's problem, and temporary. */
  | 'server'

export class SheetFetchError extends Error {
  readonly kind: FetchFailureKind
  readonly status: number | null

  constructor(kind: FetchFailureKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'SheetFetchError'
    this.kind = kind
    this.status = status
  }

  /**
   * True when retrying could plausibly succeed without a human doing something.
   *
   * The distinction drives the UI, not just the backoff: a `network` blip keeps the
   * last good board up with an amber dot, while an `unauthorized` needs a full-screen
   * instruction, because nothing is going to improve while everyone waits.
   */
  get transient(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server'
  }
}

export interface TabText {
  /** The CSV body, exactly as served. */
  text: string
  /** When the response completed, from the injected clock. */
  at: number
}

export interface SheetSource {
  /** Fetches one tab by gid. Throws `SheetFetchError` and nothing else. */
  fetchTab(gid: string, signal?: AbortSignal): Promise<TabText>
}

export interface CsvSourceOptions {
  spreadsheetId: string
  /** Injected for tests. Defaults to the global. */
  fetchImpl?: typeof fetch
  now?: () => number
  /** Per-request budget. Beyond this the request is abandoned, not left hanging. */
  timeoutMs?: number
}

/**
 * The primary source: `/export?format=csv&gid=`, chosen over gviz in section 5.0
 * because it returns the literal grid with empty rows intact.
 *
 * `redirect: 'follow'` is required, not incidental (D1): the export endpoint answers
 * 307 to a `googleusercontent.com` host, and the default `follow` is only safe to
 * rely on if it is stated -- an earlier draft set `redirect: 'error'` for "safety"
 * and got nothing but failures.
 *
 * `cache: 'no-store'` because neither endpoint sends an `ETag` or `Last-Modified`
 * and `If-None-Match` was verified to return a full 200 body (section 4). There is
 * no conditional request to make, so the only thing an HTTP cache can do here is
 * serve a stale board.
 */
export function createCsvSource({
  spreadsheetId,
  fetchImpl,
  now = () => Date.now(),
  timeoutMs = 10_000,
}: CsvSourceOptions): SheetSource {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  return {
    async fetchTab(gid, signal) {
      // csvUrl validates both interpolated values and throws on anything shaped
      // wrong (section 9.1). That throw is a programming error, not a fetch
      // failure, so it is deliberately not wrapped.
      const url = csvUrl(spreadsheetId, gid)

      let response: Response
      try {
        response = await doFetch(url, {
          cache: 'no-store',
          redirect: 'follow',
          signal: withTimeout(signal, timeoutMs),
        })
      } catch (cause) {
        if (isAbort(cause)) {
          // An external abort is the store shutting us down and must not be
          // reported as a failure; a timeout abort is a real one.
          if (signal?.aborted) throw new SheetFetchError('network', 'request aborted')
          throw new SheetFetchError('timeout', `no response within ${timeoutMs}ms`)
        }
        throw new SheetFetchError('network', describe(cause))
      }

      if (!response.ok) throw statusError(response.status)

      let text: string
      try {
        text = await response.text()
      } catch (cause) {
        // The body can fail separately from the headers -- a dropped connection
        // mid-download lands here, and it is just as transient.
        throw new SheetFetchError('network', describe(cause))
      }

      return { text, at: now() }
    },
  }
}

function statusError(status: number): SheetFetchError {
  if (status === 401 || status === 403) {
    return new SheetFetchError(
      'unauthorized',
      'the sheet is not shared with "anyone with the link"',
      status,
    )
  }
  if (status === 400 || status === 404) {
    return new SheetFetchError('notFound', 'no such spreadsheet or tab', status)
  }
  return new SheetFetchError('server', `Google returned ${status}`, status)
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isAbort(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')
}

/**
 * Combines the caller's abort with a deadline.
 *
 * A request with no timeout is the quiet version of the failure section 8.1 is
 * about: `fetch` will wait essentially forever, so the poll loop stops polling, the
 * status dot stays green on data that is minutes old, and nothing on the wall says
 * so. The timeout is what converts a hang into a visible stale state.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs)
  if (!signal) return deadline
  // Available in every browser that ships `AbortSignal.timeout`, and in Node 20+.
  return AbortSignal.any([signal, deadline])
}

/**
 * Retry delay after `failures` consecutive failures: 3s, 6s, 12s, then capped.
 *
 * Backoff exists to be polite to Google, not to protect us: at ~5 KB a poll the
 * traffic is irrelevant, but a board hammering a 403 every 3 seconds for four hours
 * is the kind of thing that gets a link-shared sheet rate-limited. The cap stays low
 * (15s) because the alternative -- exponential all the way up -- means a board that
 * recovers from a 90-second outage minutes late, and nobody in the room knows why.
 */
export function nextDelay(failures: number, baseMs: number, capMs = 15_000): number {
  if (failures <= 0) return baseMs
  return Math.min(capMs, baseMs * 2 ** failures)
}

export type FeedState = 'live' | 'stale' | 'dead'

/**
 * Feed health from the age of the newest successful poll (section 7.8).
 *
 * Thresholds are in *poll intervals*, not seconds, so changing `pollIntervalMs`
 * cannot accidentally make a healthy board report stale. Three intervals is the
 * smallest window that does not flicker amber on one dropped request.
 */
export function feedStateFor(ageMs: number, intervalMs: number): FeedState {
  if (ageMs <= intervalMs * 3) return 'live'
  if (ageMs <= intervalMs * 20) return 'stale'
  return 'dead'
}

/**
 * `2s`, `47s`, `4m`, `1h12m`. Never a bare number: the whole point of section 7.8 is
 * that the room can tell at a glance how old what it is reading is.
 */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}
