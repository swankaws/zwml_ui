import { describe, expect, it } from 'vitest'
import { league, totalAuctionSlots } from '../config/league'
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

  /*
   * Recognition spans seasons; membership does not. The app can render a past tab,
   * and 2025's name cells correctly say `Nick`, who left the league before 2026.
   * Without this, viewing 2025 reported `Unrecognized manager name "Nick"` on every
   * poll -- a warning about data that is not wrong, just old. False alarms are what
   * make a warning channel worthless on the night it matters.
   */
  it('recognizes a past manager, so a past tab parses without false alarms', () => {
    expect(readManagerName('Nick')).toBe('Nick')
    expect(readManagerName('  nick ')).toBe('Nick')
  })

  it('still rejects a name on neither list, so this is not a blanket amnesty', () => {
    expect(readManagerName('Rob')).toBeNull()
    expect(readManagerName('Kirs')).toBeNull() // a plausible typo for Kris
  })

  it('keeps a past manager out of the current roster and its totals', () => {
    // Recognized is not the same as playing: `Nick` must not occupy one of the
    // twelve slots that drive display order, the order denominator, or SLOTS n/180.
    expect(league.managers as readonly string[]).not.toContain('Nick')
    expect(totalAuctionSlots).toBe(180)
  })

  it('returns null for a blank cell', () => {
    expect(readManagerName('')).toBeNull()
  })
})
