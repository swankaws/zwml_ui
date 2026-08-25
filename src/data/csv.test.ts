import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { cell, parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps empty fields and empty rows', () => {
    expect(parseCsv('a,,b\n,,\nc,d,e')).toEqual([
      ['a', '', 'b'],
      ['', '', ''],
      ['c', 'd', 'e'],
    ])
  })

  it('does not invent a trailing row from a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
  })

  it('handles quoted commas', () => {
    expect(parseCsv('"Smith, John",QB')).toEqual([['Smith, John', 'QB']])
  })

  it('handles escaped quotes', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('keeps a quoted newline inside one field instead of starting a row', () => {
    // The regression that matters: the live sheet has a cell like this, and a
    // line-splitting parser shifts every row after it.
    const rows = parseCsv('a,"line1\nline2",c\nd,e,f')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(['a', 'line1\nline2', 'c'])
    expect(rows[1]).toEqual(['d', 'e', 'f'])
  })
})

describe('parseCsv against the live fixtures', () => {
  for (const file of ['2026-auction.csv', '2025-auction.csv']) {
    it(`${file} yields the true 63-row grid`, () => {
      expect(parseCsv(readFileSync(`docs/data-samples/${file}`, 'utf8'))).toHaveLength(63)
    })
  }

  /*
   * The embedded-newline hazard now lives on 2025 only, and that is deliberate.
   *
   * It used to be asserted for both fixtures. The 2026 capture's sole quoted newline
   * was in A16, and when the maintainer cleared that cell the re-export lost it --
   * so the assertion below would have started passing vacuously on 2026 while
   * appearing to still test something. The original version guarded against exactly
   * that ("so this test cannot quietly stop testing anything if the sheet is
   * re-exported") and the guard fired on the re-capture, which is why this moved
   * rather than being deleted.
   *
   * 2025 is the better permanent home: it is a closed season, so it will never be
   * re-exported and cannot lose the hazard the way 2026 just did.
   */
  it('2025-auction.csv still carries a quoted newline, so the 63 above is a real result', () => {
    const text = readFileSync('docs/data-samples/2025-auction.csv', 'utf8')
    const rows = parseCsv(text)
    expect(rows.some((r) => r.some((c) => c.includes('\n')))).toBe(true)
    // A naive split would produce a different count. The real grid is 63.
    expect(text.split('\n').length).not.toBe(63)
  })
})

describe('cell', () => {
  const rows = [['a', ' padded '], ['b']]

  it('trims', () => {
    expect(cell(rows, 0, 1)).toBe('padded')
  })

  it('returns empty string for out-of-range coordinates', () => {
    expect(cell(rows, 9, 9)).toBe('')
    expect(cell(rows, 1, 5)).toBe('')
  })
})
