import { describe, expect, it } from 'vitest'
import { pickAuctionTab } from './tabs'
import { league } from '../config/league'

const newest = [...league.auctionTabs].sort((a, b) => b.year - a.year)[0]!

describe('pickAuctionTab', () => {
  it('defaults to the newest configured tab', () => {
    expect(pickAuctionTab()).toEqual({ ...newest, warning: null })
  })

  it('honours ?year= for a configured tab', () => {
    expect(pickAuctionTab('?year=2025')).toEqual({ year: 2025, gid: '599461641', warning: null })
  })

  it('ignores other query parameters', () => {
    expect(pickAuctionTab('?scale=1.1&year=2025&rail=off').year).toBe(2025)
  })

  it('tolerates a missing leading question mark', () => {
    expect(pickAuctionTab('year=2025').year).toBe(2025)
  })

  it('trims a fat-fingered value', () => {
    expect(pickAuctionTab('?year= 2025 ').year).toBe(2025)
  })

  /*
   * The whole reason this returns a warning instead of throwing. A mistyped URL
   * parameter at 7pm must cost a warning line, not the board -- and it has to name
   * what IS available, since the person reading it is standing at a projector and
   * cannot go and look.
   */
  it('falls back to the newest tab with a warning for an unconfigured year', () => {
    const choice = pickAuctionTab('?year=2019')

    expect(choice.gid).toBe(newest.gid)
    expect(choice.warning).toContain('2019')
    expect(choice.warning).toContain(String(newest.year))
  })

  it.each(['?year=', '?year=abc', '?year=2026x'])('warns rather than failing on %s', (search) => {
    const choice = pickAuctionTab(search)

    expect(choice.gid).toBe(newest.gid)
    expect(choice.warning).not.toBeNull()
  })

  // gids are what `/export` actually selects on, so a typo here is the wrong-tab
  // failure of section 5.2: a plausible board full of wrong numbers.
  it('returns a numeric gid for every configured tab', () => {
    for (const tab of league.auctionTabs) {
      expect(pickAuctionTab(`?year=${tab.year}`).gid).toMatch(/^[0-9]+$/)
    }
  })
})
