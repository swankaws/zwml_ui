import { describe, expect, it } from 'vitest'
import {
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

  it('prefers the query string over storage', () => {
    expect(pickSheetId({ query: FAKE, stored: other, buildDefault: other })).toEqual({
      id: FAKE,
      source: 'query',
    })
  })

  it('prefers storage over the build default', () => {
    expect(pickSheetId({ stored: FAKE, buildDefault: other })).toEqual({
      id: FAKE,
      source: 'storage',
    })
  })

  it('falls back to the build default', () => {
    expect(pickSheetId({ buildDefault: FAKE })).toEqual({ id: FAKE, source: 'build' })
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
