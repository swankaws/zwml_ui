import { describe, expect, it } from 'vitest'
import { resolveNominationOrder } from './order'
import { league } from '../config/league'

const ROSTER: string[] = [...league.managers]

describe('resolveNominationOrder', () => {
  it('prefers a valid A1 over the committed order', () => {
    const a1 = 'Kevin > Corky > Ryan'
    const result = resolveNominationOrder(ROSTER, a1)

    expect(result.source).toBe('sheet')
    expect(result.order.slice(0, 3)).toEqual(['Kevin', 'Corky', 'Ryan'])
  })

  it('falls back to the committed order when A1 is blank', () => {
    const result = resolveNominationOrder(ROSTER, '')

    expect(result.source).toBe('config')
    expect(result.order).toEqual(league.nominationOrder)
    expect(result.warnings).toEqual([])
  })

  /*
   * Both committed fixtures carry an A1 naming `Rob`, who has not played in years.
   * A1 goes stale exactly like the committed list does, so it gets the same
   * treatment: reject the whole thing, say so, and fall through.
   */
  it('rejects an A1 naming someone who is not on this board, with a warning', () => {
    const result = resolveNominationOrder(ROSTER, 'Kevin > Rob > Ryan')

    expect(result.source).toBe('config')
    expect(result.warnings.join(' ')).toContain('Rob')
  })

  /*
   * The regression this module exists for. The committed order names the CURRENT
   * season's managers, so against a past board it names people with no row; the rail
   * treats a manager it cannot find as able to nominate, and 2025 rendered `Kris` ON
   * THE CLOCK on a draft that had finished a year earlier -- while the same state
   * reported `draftComplete`. No rotation is honest here; a wrong one is not.
   */
  it('reports no order at all rather than one naming managers who are absent', () => {
    const pastRoster = ROSTER.filter((name) => name !== 'Kris').concat('Nick')
    const result = resolveNominationOrder(pastRoster, '')

    expect(result.source).toBe('none')
    expect(result.order).toEqual([])
    /*
     * The room is told what to DO, not which name in a list it cannot see tripped the check.
     *
     * A1 is empty here, so the only complaint available is about the committed order -- and no operator
     * can edit that during a draft. Naming `Kris` was strictly worse than useless: it read as an
     * instruction to go and fix a manager who is not in this season at all.
     */
    expect(result.warnings).toEqual([
      'No nomination order is set. Fix cell A1 or the SETTINGS tab `order` row.',
    ])
  })

  // A1 is validated against the roster in front of us, not the committed list, so a
  // manager the config has never heard of can join the rotation without a deploy.
  it('accepts an A1 naming a manager the committed config does not know', () => {
    const roster = ['NewGuy', 'Kevin']
    const result = resolveNominationOrder(roster, 'NewGuy > Kevin')

    expect(result).toMatchObject({ source: 'sheet', order: ['NewGuy', 'Kevin'] })
  })

  it('keeps a short A1 order, warning that the rest will not nominate', () => {
    const result = resolveNominationOrder(ROSTER, 'Kevin > Corky')

    expect(result.source).toBe('sheet')
    expect(result.order).toEqual(['Kevin', 'Corky'])
    expect(result.warnings.join(' ')).toContain('2 of 12')
  })

  it('rejects an A1 that repeats a manager', () => {
    const result = resolveNominationOrder(ROSTER, 'Kevin > Kevin > Ryan')

    expect(result.source).toBe('config')
    expect(result.warnings.join(' ')).toContain('more than once')
  })

  // Whatever else happens, this must not throw: the rail hides, the board renders (8).
  it('survives an empty roster', () => {
    expect(resolveNominationOrder([], 'Kevin > Ryan')).toMatchObject({ source: 'none', order: [] })
  })

  it('reads a comma-separated A1, as a person would type it', () => {
    const result = resolveNominationOrder(ROSTER, 'Kevin, Corky, Ryan')

    expect(result).toMatchObject({ source: 'sheet', order: ['Kevin', 'Corky', 'Ryan'] })
  })
})
