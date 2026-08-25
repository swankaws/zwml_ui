import { describe, expect, it } from 'vitest'
import {
  SheetFetchError,
  createCsvSource,
  feedStateFor,
  formatAge,
  nextDelay,
} from './sheetClient'

// Syntactically valid, fictional. The real id is never in this repo (section 9.1).
const FAKE = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x'
const GID = '1565415907'

/** A `fetch` stand-in. Records what it was asked for; answers whatever is queued. */
function fakeFetch(answer: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return Promise.resolve(answer(String(input), init ?? {}))
  }
  return { impl: impl as unknown as typeof fetch, calls }
}

function ok(body: string): Response {
  return new Response(body, { status: 200 })
}

describe('createCsvSource', () => {
  it('returns the body with the completion time from the injected clock', async () => {
    const { impl } = fakeFetch(() => ok('A,B\n1,2\n'))
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl, now: () => 4242 })

    expect(await source.fetchTab(GID)).toEqual({ text: 'A,B\n1,2\n', at: 4242 })
  })

  it('fetches the export URL for the requested gid', async () => {
    const { impl, calls } = fakeFetch(() => ok(''))
    await createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl }).fetchTab('7')

    expect(calls[0]?.url).toBe(
      `https://docs.google.com/spreadsheets/d/${FAKE}/export?format=csv&gid=7`,
    )
  })

  /*
   * Both of these are load-bearing rather than stylistic, and both were wrong in an
   * earlier draft. `redirect: 'error'` fails every request, because the export
   * endpoint 307s to googleusercontent.com; an HTTP cache can only ever serve a stale
   * board, since neither endpoint offers a conditional request (section 4).
   */
  it('follows redirects and bypasses the HTTP cache', async () => {
    const { impl, calls } = fakeFetch(() => ok(''))
    await createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl }).fetchTab(GID)

    expect(calls[0]?.init.redirect).toBe('follow')
    expect(calls[0]?.init.cache).toBe('no-store')
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [400, 'notFound'],
    [404, 'notFound'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { impl } = fakeFetch(() => new Response('', { status }))
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl })

    await expect(source.fetchTab(GID)).rejects.toMatchObject({ kind, status })
  })

  it('reports a thrown fetch as a network failure', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl })

    await expect(source.fetchTab(GID)).rejects.toMatchObject({
      kind: 'network',
      message: 'Failed to fetch',
    })
  })

  // A hang is the quiet version of section 8.1's failure: no error, no new data,
  // and a green status dot over figures that are minutes old.
  it('gives up on a hung request as a timeout', async () => {
    const { impl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(abortError('TimeoutError')))
        }),
    )
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl, timeoutMs: 5 })

    await expect(source.fetchTab(GID)).rejects.toMatchObject({ kind: 'timeout' })
  })

  /*
   * The store aborts in flight whenever it is stopped or force-refetched. That is an
   * intentional cancellation, and reporting it as a timeout would light the header
   * amber for something the operator just asked for.
   */
  it('distinguishes a caller abort from a timeout', async () => {
    const { impl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(abortError('AbortError')))
        }),
    )
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl, timeoutMs: 60_000 })

    const controller = new AbortController()
    const pending = source.fetchTab(GID, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ kind: 'network', message: 'request aborted' })
  })

  // A connection dropped mid-download resolves headers and then fails on the body.
  it('treats a failed body read as a network failure', async () => {
    const { impl } = fakeFetch(() => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error('connection reset')),
    }) as unknown as Response)
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl })

    await expect(source.fetchTab(GID)).rejects.toMatchObject({
      kind: 'network',
      message: 'connection reset',
    })
  })

  // A malformed id is a programming error, not a fetch failure: it must not be
  // swallowed into the retry loop, where it would look like a flaky network.
  it('throws a plain Error, not a SheetFetchError, for a malformed gid', async () => {
    const { impl, calls } = fakeFetch(() => ok(''))
    const source = createCsvSource({ spreadsheetId: FAKE, fetchImpl: impl })

    await expect(source.fetchTab('../evil')).rejects.not.toBeInstanceOf(SheetFetchError)
    expect(calls).toHaveLength(0)
  })
})

describe('SheetFetchError.transient', () => {
  it.each([
    ['network', true],
    ['timeout', true],
    ['server', true],
    ['unauthorized', false],
    ['notFound', false],
  ] as const)('%s -> %s', (kind, transient) => {
    expect(new SheetFetchError(kind, 'x').transient).toBe(transient)
  })
})

describe('nextDelay', () => {
  it('polls at the base interval while healthy', () => {
    expect(nextDelay(0, 3000)).toBe(3000)
  })

  it('doubles per consecutive failure', () => {
    expect([1, 2, 3].map((n) => nextDelay(n, 3000))).toEqual([6000, 12_000, 15_000])
  })

  // The cap matters more than the curve: a board that recovers from a 90-second
  // outage minutes late looks broken to a room that can see the sheet is fine.
  it('caps, and stays capped however long the outage runs', () => {
    expect(nextDelay(50, 3000)).toBe(15_000)
  })

  it('honours a custom cap, for the slower settings loop', () => {
    expect(nextDelay(10, 15_000, 60_000)).toBe(60_000)
  })
})

describe('feedStateFor', () => {
  // Thresholds are in intervals, not seconds, so tuning the poll rate cannot make a
  // healthy board report stale.
  it.each([
    [0, 'live'],
    [3000, 'live'],
    [9000, 'live'],
    [9001, 'stale'],
    [60_000, 'stale'],
    [60_001, 'dead'],
  ] as const)('%ims old -> %s at a 3s interval', (age, expected) => {
    expect(feedStateFor(age, 3000)).toBe(expected)
  })

  it('scales with the interval', () => {
    expect(feedStateFor(20_000, 10_000)).toBe('live')
  })
})

describe('formatAge', () => {
  it.each([
    [0, '0s'],
    [-500, '0s'],
    [2400, '2s'],
    [47_000, '47s'],
    [59_999, '59s'],
    [60_000, '1m'],
    [264_000, '4m'],
    [4_320_000, '1h12m'],
  ])('%ims -> %s', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected)
  })
})

/** `fetch` rejects with a DOMException; only `name` matters to the classifier. */
function abortError(name: 'AbortError' | 'TimeoutError'): Error {
  const error = new Error(name)
  error.name = name
  return error
}
