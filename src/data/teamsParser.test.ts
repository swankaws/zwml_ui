/**
 * The `TeamsToManagers` tab.
 *
 * Every test here is a shape the tab could plausibly arrive in, because the whole point of discovering the
 * column rather than configuring it is that the sheet may be reorganised without warning.
 */

import { describe, expect, it } from 'vitest'
import { parseTeamsToManagers } from './teamsParser'
import { league } from '../config/league'

/* Indexed rather than destructured: `noUncheckedIndexedAccess` makes a destructured element `undefined`. */
const A = league.managers[0] as string
const B = league.managers[1] as string
const C = league.managers[2] as string

describe('parseTeamsToManagers', () => {
  it('reads manager then team', () => {
    const { teams, warnings } = parseTeamsToManagers([
      [A, 'Team Chaos'],
      [B, 'Gridiron Goons'],
    ])
    expect(teams).toEqual({ [A]: 'Team Chaos', [B]: 'Gridiron Goons' })
    expect(warnings).toEqual([])
  })

  it('reads team then manager, because column order is discovered', () => {
    // The same tab written the other way round. Nobody should have to tell this file which way it is.
    const { teams } = parseTeamsToManagers([
      ['Team Chaos', A],
      ['Gridiron Goons', B],
    ])
    expect(teams).toEqual({ [A]: 'Team Chaos', [B]: 'Gridiron Goons' })
  })

  it('skips a header row for free', () => {
    // "Manager" is not a manager, so the row resolves to nothing and is ignored. No special case needed.
    const { teams, warnings } = parseTeamsToManagers([
      ['Manager', 'Team'],
      [A, 'Team Chaos'],
    ])
    expect(teams).toEqual({ [A]: 'Team Chaos' })
    expect(warnings).toEqual([])
  })

  it('tolerates a blank spacer column between the two', () => {
    expect(parseTeamsToManagers([[A, '', 'Team Chaos']]).teams).toEqual({ [A]: 'Team Chaos' })
  })

  it('resolves aliases and casing the way the rest of the sheet does', () => {
    // Reuses `readManagerName`, so `Jeffrey` and a lower-case name behave here exactly as on the board.
    const { teams } = parseTeamsToManagers([['jeffrey', 'Big Cats']])
    expect(teams).toEqual({ Jeff: 'Big Cats' })
  })

  it('prefers the column with the MOST manager names, not the first one that matches', () => {
    /*
     * A notes column mentioning somebody once must not win over the roster column -- otherwise the team
     * names would be read out of the wrong column and every tooltip would be confidently wrong.
     */
    const { teams } = parseTeamsToManagers([
      [`ask ${A}`, 'Team Chaos', A],
      ['', 'Gridiron Goons', B],
      ['', 'Third Rail', C],
    ])
    expect(teams[A]).toBe('Team Chaos')
    expect(teams[B]).toBe('Gridiron Goons')
  })

  it('reports a manager listed with two different teams and keeps the first', () => {
    // A sheet somebody is mid-edit on. Taking the last would make the tooltip depend on row order.
    const { teams, warnings } = parseTeamsToManagers([
      [A, 'Team Chaos'],
      [A, 'Something Else'],
    ])
    expect(teams[A]).toBe('Team Chaos')
    expect(warnings.join(' ')).toContain('listed as both')
  })

  it('does not warn when the same manager and team appear twice', () => {
    const { warnings } = parseTeamsToManagers([
      [A, 'Team Chaos'],
      [A, 'Team Chaos'],
    ])
    expect(warnings).toEqual([])
  })

  it('says so, once, when there is no column of manager names', () => {
    /*
     * The wrong tab, or an empty one. This is a TAB problem and not a board problem: the message names the
     * tab, and the caller carries on with no tooltips rather than treating it as a failure.
     */
    const { teams, warnings } = parseTeamsToManagers([['Week', 'Points'], ['1', '92']])
    expect(teams).toEqual({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('team tooltips are off')
  })

  it('returns nothing for an empty tab rather than throwing', () => {
    expect(parseTeamsToManagers([]).teams).toEqual({})
    expect(parseTeamsToManagers([[], ['']]).teams).toEqual({})
  })

  it('ignores a manager row with no team beside it', () => {
    // A half-filled sheet. A tooltip reading "" is worse than no tooltip.
    expect(parseTeamsToManagers([[A, ''], [B, 'Gridiron Goons']]).teams).toEqual({ [B]: 'Gridiron Goons' })
  })
})
