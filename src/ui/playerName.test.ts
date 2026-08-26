import { describe, expect, it } from 'vitest'
import { fitPlayerName, splitName } from './playerName'
import raw2026 from '../../docs/data-samples/2026-auction.csv?raw'
import raw2025 from '../../docs/data-samples/2025-auction.csv?raw'
import { parseCsv } from '../data/csv'
import { parseAuctionGrid } from '../data/gridParser'

describe('splitName', () => {
  it('splits an ordinary name', () => {
    expect(splitName('Saquon Barkley')).toEqual({
      first: 'Saquon',
      middles: [],
      last: 'Barkley',
      suffix: null,
    })
  })

  it('recognizes a suffix the sheet wrote without a period', () => {
    expect(splitName('Brian Thomas Jr')).toEqual({
      first: 'Brian',
      middles: [],
      last: 'Thomas',
      suffix: 'Jr',
    })
  })

  it.each(['Jr', 'Jr.', 'Sr', 'II', 'III', 'IV'])('recognizes the %s suffix', (suffix) => {
    expect(splitName(`Odell Beckham ${suffix}`).suffix).toBe(suffix)
  })

  it('keeps a joke middle token separate rather than folding it into the surname', () => {
    // The league really does type these, and `F'ing` must not become part of `McCarthy`.
    expect(splitName("JJ F'ing McCarthy")).toEqual({
      first: 'JJ',
      middles: ["F'ing"],
      last: 'McCarthy',
      suffix: null,
    })
  })

  it('treats a lone name as a surname, since there is no first name to spend', () => {
    expect(splitName('Ashton')).toEqual({ first: '', middles: [], last: 'Ashton', suffix: null })
  })

  it('does not read a one-token name as a bare suffix', () => {
    // `V` alone is that player's whole name, not a numeral attached to nothing.
    expect(splitName('V')).toEqual({ first: '', middles: [], last: 'V', suffix: null })
  })

  it('survives an empty cell', () => {
    expect(splitName('   ')).toEqual({ first: '', middles: [], last: '', suffix: null })
  })
})

describe('fitPlayerName', () => {
  it('returns the name untouched when it fits', () => {
    expect(fitPlayerName('Saquon Barkley', 20)).toBe('Saquon Barkley')
    expect(fitPlayerName('Saquon Barkley', 14)).toBe('Saquon Barkley')
  })

  it('shortens the first name to an initial', () => {
    expect(fitPlayerName('Saquon Barkley', 13)).toBe('S. Barkley')
    expect(fitPlayerName('Saquon Barkley', 10)).toBe('S. Barkley')
  })

  /*
   * Middle tokens go BEFORE the first name does, because they are worth less per character.
   * `J. F'ing McCarthy` would keep a joke and throw away the name people use.
   */
  it('drops a middle token before touching the first name', () => {
    expect(fitPlayerName("JJ F'ing McCarthy", 16)).toBe('JJ McCarthy')
    expect(fitPlayerName("Bo F'ing Nix", 11)).toBe('Bo Nix')
  })

  it('keeps a suffix while it fits, then drops it', () => {
    expect(fitPlayerName('Brian Thomas Jr', 14)).toBe('B. Thomas Jr')
    expect(fitPlayerName('Brian Thomas Jr', 11)).toBe('B. Thomas')
  })

  it('eats into the surname from the end once the first name is already an initial', () => {
    // Uses the whole budget: `J. ` is three, leaving eleven letters and the ellipsis.
    expect(fitPlayerName('Jacory Croskey-Merritt', 15)).toBe('J. Croskey-Mer…')
    // `C. McCaffery` is exactly 12, so 12 needs no cut at all -- 11 is where it starts.
    expect(fitPlayerName('Christian McCaffery', 12)).toBe('C. McCaffery')
    expect(fitPlayerName('Christian McCaffery', 11)).toBe('C. McCaffe…')
  })

  it('keeps the beginning of the surname, which is what a reader recognizes', () => {
    const fitted = fitPlayerName('Rhamondre Stevenson', 10)
    expect(fitted.startsWith('R. Stev')).toBe(true)
    expect(fitted.endsWith('…')).toBe(true)
  })

  /*
   * The floor. Reached only when the budget cannot hold an initial plus a recognizable
   * stem -- three letters and an ellipsis is already noise, so initials are honest instead.
   * The hyphen survives because it says "double-barrelled" rather than "typo".
   */
  it('falls back to initials, keeping the hyphen', () => {
    expect(fitPlayerName('Jacory Croskey-Merritt', 5)).toBe('J C-M')
    expect(fitPlayerName('Jacory Croskey-Merritt', 4)).toBe('JC-M')
  })

  it('handles a hyphenated FIRST name and a period inside the surname', () => {
    expect(fitPlayerName('Amon-Ra St.Brown', 16)).toBe('Amon-Ra St.Brown')
    expect(fitPlayerName('Amon-Ra St.Brown', 12)).toBe('A. St.Brown')
  })

  it('takes the initial from an apostrophe first name correctly', () => {
    expect(fitPlayerName("Ja'Marr Chase", 10)).toBe('J. Chase')
    expect(fitPlayerName("De'Von Achane", 10)).toBe('D. Achane')
  })

  it('never returns more characters than it was given', () => {
    const names = ['Jacory Croskey-Merritt', 'Brian Thomas Jr', "JJ F'ing McCarthy", 'Amon-Ra St.Brown']
    for (const name of names) {
      for (let max = 1; max <= 24; max += 1) {
        expect(fitPlayerName(name, max).length).toBeLessThanOrEqual(max)
      }
    }
  })

  it('returns nothing for a nonsensical budget rather than throwing', () => {
    expect(fitPlayerName('Saquon Barkley', 0)).toBe('')
    expect(fitPlayerName('Saquon Barkley', -3)).toBe('')
  })

  it('collapses the whitespace a spreadsheet cell smuggles in', () => {
    expect(fitPlayerName('  Saquon   Barkley ', 20)).toBe('Saquon Barkley')
  })
})

/*
 * The property that actually matters on the wall, checked against every name the league
 * has really typed rather than against invented examples: whatever budget the layout
 * settles on, no name overflows it and none renders as an empty cell.
 */
describe('every real name in both tabs', () => {
  const names = [raw2026, raw2025]
    .flatMap((csv) => parseAuctionGrid(parseCsv(csv)).blocks)
    .flatMap((block) => block.picks.map((pick) => pick.player))
    .filter((player) => player.trim() !== '')

  it('finds a meaningful number of names to check', () => {
    expect(names.length).toBeGreaterThan(150)
  })

  it.each([6, 8, 10, 12, 14, 16, 18, 22])('fits every name in %i characters', (max) => {
    for (const name of names) {
      const fitted = fitPlayerName(name, max)
      expect(fitted.length).toBeLessThanOrEqual(max)
      expect(fitted.trim()).not.toBe('')
    }
  })

  it('leaves most names untouched at a generous budget', () => {
    // Sanity on the ladder: at 22 characters only the widest name should be abbreviated.
    const abbreviated = names.filter((n) => fitPlayerName(n, 22) !== n.trim().replace(/\s+/g, ' '))
    expect(abbreviated).toHaveLength(0)
  })
})

/*
 * Surname particles. `Amon-Ra St. Brown` shortened to `A. Brown` is indistinguishable from AJ Brown or
 * Antonio Brown, both of whom this league has drafted -- so the one word carrying the distinction must
 * not be the first thing spent. A naive split makes `St.` a middle token, and middles go first.
 */
describe('a surname with a particle', () => {
  it('keeps St. attached however the sheet spaces it', () => {
    for (const name of ['Amon-Ra St. Brown', 'Amon-Ra St.Brown']) {
      expect(splitName(name).last.replace(/\s+/g, ''), name).toBe('St.Brown')
      expect(splitName(name).middles, name).toEqual([])
    }
  })

  it('never shortens him to a bare Brown', () => {
    /*
     * The assertion the maintainer actually asked for: at every budget from the floor to the full
     * name, the result must not be something a reader would read as a different Brown.
     */
    for (let max = 4; max <= 20; max += 1) {
      const fitted = fitPlayerName('Amon-Ra St. Brown', max)
      expect(fitted, `max=${max} -> ${fitted}`).not.toBe('A. Brown')
      expect(fitted, `max=${max} -> ${fitted}`).not.toBe('Amon-Ra Brown')
    }
  })

  it('shows the particle at any budget that can hold a surname at all', () => {
    expect(fitPlayerName('Amon-Ra St. Brown', 17)).toBe('Amon-Ra St. Brown')
    expect(fitPlayerName('Amon-Ra St. Brown', 13)).toBe('A. St. Brown')
    expect(fitPlayerName('Amon-Ra St. Brown', 11)).toContain('St.')
    expect(fitPlayerName('Amon-Ra St. Brown', 9)).toContain('St.')
  })

  it('reaches initials that still name both halves', () => {
    // `A SB`, not `A S` -- a particle and its surname are one name, so both letters survive.
    expect(fitPlayerName('Amon-Ra St. Brown', 5)).toBe('A SB')
  })

  it('handles the other particles the league pool contains', () => {
    expect(fitPlayerName('Kyle Van Noy', 11)).toBe('K. Van Noy')
    expect(splitName('Kyle Van Noy').last).toBe('Van Noy')
    expect(splitName('Robert De Boer').last).toBe('De Boer')
  })

  it('does not mistake a joke middle for a particle', () => {
    // `F'ing` is not a name fragment, and dropping it is exactly right.
    expect(splitName("JJ F'ing McCarthy").middles).toEqual(["F'ing"])
    expect(fitPlayerName("JJ F'ing McCarthy", 16)).toBe('JJ McCarthy')
  })

  it('still drops a suffix before it touches the particle', () => {
    // The suffix is the least identifying part; the particle is among the most.
    expect(fitPlayerName('Amon-Ra St. Brown Jr', 13)).toBe('A. St. Brown')
  })
})
