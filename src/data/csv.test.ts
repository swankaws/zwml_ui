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
    it(`${file} yields 63 rows despite an embedded newline`, () => {
      const text = readFileSync(`docs/data-samples/${file}`, 'utf8')
      const rows = parseCsv(text)

      // Proof the fixture really does contain the hazard, so this test cannot
      // quietly stop testing anything if the sheet is re-exported.
      expect(rows.some((r) => r.some((c) => c.includes('\n')))).toBe(true)

      // A naive split would produce a different count. The real grid is 63.
      expect(rows).toHaveLength(63)
      expect(text.split('\n').length).not.toBe(63)
    })
  }
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
