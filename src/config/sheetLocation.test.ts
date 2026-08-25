import { describe, expect, it } from 'vitest'
import {
  confirmSheetId,
  csvUrl,
  decodeBuildDefault,
  extractSheetId,
  pickSheetId,
} from './sheetLocation'

// A syntactically valid but fictional id, so this file never contains the real
// one (docs/DESIGN.md section 9.1).
const FAKE = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x'

describe('extractSheetId', () => {
  it('accepts a bare id', () => {
    expect(extractSheetId(FAKE)).toBe(FAKE)
  })

  it('pulls the id out of a full sheet URL', () => {
    expect(
      extractSheetId(`https://docs.google.com/spreadsheets/d/${FAKE}/edit?usp=sharing#gid=0`),
    ).toBe(FAKE)
  })

  it('pulls the id out of an export URL', () => {
    expect(
      extractSheetId(`https://docs.google.com/spreadsheets/d/${FAKE}/export?format=csv&gid=12`),
    ).toBe(FAKE)
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(extractSheetId(`  ${FAKE}\n`)).toBe(FAKE)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['too short', 'abc123'],
    ['path traversal', '../../etc/passwd'],
    ['a slash', 'abcdefghijklmnopqrst/uvwxyz'],
    ['a query separator', 'abcdefghijklmnopqrst?evil=1'],
    ['a scheme', 'https://evil.example.com/abcdefghijklmnopqrst'],
    ['a dot', 'abcdefghijklmnopqrst.evil'],
  ])('rejects %s', (_label, input) => {
    expect(extractSheetId(input)).toBeNull()
  })
})

describe('csvUrl', () => {
  it('builds the verified export URL', () => {
    expect(csvUrl(FAKE, '1565415907')).toBe(
      `https://docs.google.com/spreadsheets/d/${FAKE}/export?format=csv&gid=1565415907`,
    )
  })

  // The id and gid are the only interpolated values in any URL this app fetches.
  it.each(['../../evil', 'a/b', '', 'short'])('refuses a malformed id: %s', (id) => {
    expect(() => csvUrl(id, '1')).toThrow()
  })

  it.each(['../1', '1;2', '', 'abc'])('refuses a malformed gid: %s', (gid) => {
    expect(() => csvUrl(FAKE, gid)).toThrow()
  })
})

describe('pickSheetId precedence', () => {
  const other = '2ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-y'

  it('prefers the fragment over everything', () => {
    expect(
      pickSheetId({ fragment: FAKE, query: other, stored: other, buildDefault: other }),
    ).toEqual({ id: FAKE, source: 'fragment' })
  })

  it('prefers the query string over the build default', () => {
    expect(pickSheetId({ query: FAKE, stored: other, buildDefault: other })).toEqual({
      id: FAKE,
      source: 'query',
    })
  })

  // The CI secret is the blessed config; storage is a leftover from whoever last
  // used this browser. A rehearsal id must not silently outlive a fixed secret.
  it('prefers the build default over storage', () => {
    expect(pickSheetId({ stored: other, buildDefault: FAKE })).toEqual({
      id: FAKE,
      source: 'build',
    })
  })

  it('falls back to storage only when there is no build default', () => {
    expect(pickSheetId({ stored: FAKE })).toEqual({ id: FAKE, source: 'storage' })
  })

  it('reports none when every source is absent', () => {
    expect(pickSheetId({})).toEqual({ id: null, source: 'none' })
  })

  it('skips a malformed higher-priority source instead of failing', () => {
    expect(pickSheetId({ fragment: 'nope', stored: FAKE })).toEqual({
      id: FAKE,
      source: 'storage',
    })
  })
})

describe('confirmSheetId', () => {
  // Persisting only after a successful fetch is what keeps a well-formed typo
  // from sticking forever and suppressing the setup card.
  it('does not persist a build-time id', () => {
    const calls: string[] = []
    withFakeStorage(calls, () => confirmSheetId({ id: FAKE, source: 'build' }))
    expect(calls).toEqual([])
  })

  it('persists an id that came from the URL', () => {
    const calls: string[] = []
    withFakeStorage(calls, () => confirmSheetId({ id: FAKE, source: 'fragment' }))
    expect(calls).toEqual([`set:${FAKE}`])
  })

  it('does nothing when no id resolved', () => {
    const calls: string[] = []
    withFakeStorage(calls, () => confirmSheetId({ id: null, source: 'none' }))
    expect(calls).toEqual([])
  })
})

/** Minimal `window` stand-in so persistence is testable without jsdom. */
function withFakeStorage(calls: string[], fn: () => void): void {
  const store: Record<string, string> = {}
  const fake = {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        calls.push(`set:${v}`)
        store[k] = v
      },
      removeItem: (k: string) => {
        calls.push('remove')
        delete store[k]
      },
    },
    location: { href: 'https://example.test/', hash: '', search: '' },
    history: { replaceState: () => {} },
  }
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const prev = g.window
  g.window = fake
  try {
    fn()
  } finally {
    if (had) g.window = prev
    else delete g.window
  }
}

describe('decodeBuildDefault', () => {
  it('decodes a base64 id', () => {
    expect(decodeBuildDefault(btoa(FAKE))).toBe(FAKE)
  })

  it('decodes a base64 full URL', () => {
    expect(decodeBuildDefault(btoa(`https://docs.google.com/spreadsheets/d/${FAKE}/edit`))).toBe(
      FAKE,
    )
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', '!!!not base64!!!'],
    ['base64 of junk', btoa('hello')],
  ])('returns null for %s', (_label, input) => {
    expect(decodeBuildDefault(input)).toBeNull()
  })
})
