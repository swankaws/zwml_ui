import { describe, expect, it } from 'vitest'
import { readInt, readManagerName, readPosition, readPrice } from './normalize'

describe('readPrice', () => {
  it.each([
    ['$10', 10],
    ['10', 10],
    ['10.00', 10],
    ['$1,200', 1200],
    ['  $4  ', 4],
    ['$0', 0],
    ['-', 0],
    ['–', 0],
  ])('parses %s', (raw, value) => {
    expect(readPrice(raw)).toEqual({ kind: 'ok', value })
  })

  it('reads accounting-style negatives', () => {
    expect(readPrice('($6)')).toEqual({ kind: 'ok', value: -6 })
  })

  it('reads a unicode minus', () => {
    expect(readPrice('−6')).toEqual({ kind: 'ok', value: -6 })
  })

  /*
   * The distinction the whole slot test rests on (DESIGN.md 5.3). Blank is a row
   * mid-entry and must stay invisible; a present-but-bad value is a real error.
   */
  it.each(['', '   '])('reports blank for %s', (raw) => {
    expect(readPrice(raw)).toEqual({ kind: 'blank' })
  })

  it.each(['TBD', '?', 'free', '12abc', '$$'])('reports unparseable for %s', (raw) => {
    expect(readPrice(raw)).toEqual({ kind: 'unparseable', raw: raw.trim() })
  })

  it('does not salvage a leading number from junk', () => {
    // Silently reading "12abc" as $12 would put a wrong number on the wall with
    // no warning at all. Better to flag it.
    expect(readPrice('12abc').kind).toBe('unparseable')
  })
})

describe('readInt', () => {
  it('reads a count', () => {
    expect(readInt('11')).toBe(11)
  })

  it('rejects a fraction', () => {
    expect(readInt('1.5')).toBeNull()
  })

  it.each(['', 'n/a'])('returns null for %s', (raw) => {
    expect(readInt(raw)).toBeNull()
  })
})

describe('readPosition', () => {
  it.each([
    ['QB', 'QB'],
    ['rb', 'RB'],
    [' WR ', 'WR'],
    ['TE', 'TE'],
    ['K', 'K'],
    ['PK', 'K'],
    ['D/ST', 'DEF'],
    ['DST', 'DEF'],
    ['Defense', 'DEF'],
  ])('normalizes %s', (raw, expected) => {
    expect(readPosition(raw)).toBe(expected)
  })

  it('returns null for a blank cell, which is normal on an unused bench row', () => {
    expect(readPosition('')).toBeNull()
  })

  it('returns null rather than guessing at an unknown label', () => {
    expect(readPosition('FLEX')).toBeNull()
  })
})

describe('readManagerName', () => {
  it('resolves an exact name', () => {
    expect(readManagerName('Kevin')).toBe('Kevin')
  })

  it('ignores case and whitespace', () => {
    expect(readManagerName('  corky ')).toBe('Corky')
  })

  it('applies the Jeffrey alias', () => {
    expect(readManagerName('Jeffrey')).toBe('Jeff')
  })

  it('applies an alias case-insensitively', () => {
    expect(readManagerName('jeffrey')).toBe('Jeff')
  })

  // Rob drafted on Jason's behalf in a past year and still appears in A1.
  it('returns null for a name the league does not know', () => {
    expect(readManagerName('Rob')).toBeNull()
  })

  it('returns null for a blank cell', () => {
    expect(readManagerName('')).toBeNull()
  })
})
