/**
 * Tests for the phase-3 fixture loader, and specifically for order resolution.
 *
 * `loadFixture` is scaffolding that phase 4 deletes, so it would be reasonable to
 * leave it untested -- except that `resolveOrder` implements the precedence chain of
 * DESIGN.md 7.5, and phase 4 moves that logic to the live path rather than replacing
 * it. The bug pinned below was found by rendering the 2025 board, not by reading the
 * code, which is the kind of thing a test should be holding.
 */

import { describe, expect, it } from 'vitest'
import { league } from '../config/league'
import { loadFixture } from './fixtureState'

describe('order resolution', () => {
  it('reads the live 2026 order straight out of A1, with no warnings', () => {
    const { order, warnings } = loadFixture('')
    expect(order).toEqual([
      'Jeff', 'Toby', 'Tony', 'Derrick', 'Marc', 'Corky',
      'Bill', 'Ryan', 'Colin', 'Kevin', 'Kris', 'Jason',
    ])
    expect(warnings).toEqual([])
  })

  it('puts Kris in the rotation, four days after he joined and with no deploy', () => {
    // The whole point of 9.2, reduced to one assertion: a manager the config learned
    // about days before the draft is on the wall because the SHEET said so.
    expect(loadFixture('').order).toContain('Kris')
    expect(loadFixture('').state.managers.map((m) => m.name)).toContain('Kris')
  })

  /*
   * The regression this file exists for.
   *
   * 2025's A1 names `Rob`, so it is rejected and the committed order is used instead.
   * That order names THIS season's managers, and `Kris` has no row on the 2025 board.
   * The rail treats a manager it cannot find as "not full", i.e. able to nominate, so
   * the completed 2025 draft rendered `Kris ON THE CLOCK` -- while the same state
   * reported `draftComplete: true`. A rotation naming someone who is not on the board
   * is not a usable rotation, so it degrades to none.
   */
  it('shows no rotation on a past board rather than a manager who is not in it', () => {
    const { order, state, warnings } = loadFixture('?fixture=2025')

    expect(state.draftComplete).toBe(true)
    expect(state.managers.map((m) => m.name)).not.toContain('Kris')
    expect(order).not.toContain('Kris')
    expect(order).toEqual([])

    // Both rejections are reported -- the stale A1 and the wrong-season fallback.
    expect(warnings.filter((w) => /not a known manager/.test(w))).toHaveLength(2)
  })

  it('recognizes the 2025 board as twelve managers including Nick', () => {
    // Proof the past-manager list is doing its job: Nick resolves, so the 2025 board
    // is complete and the parse is clean, even though he is not in this season's twelve.
    const { state, warnings } = loadFixture('?fixture=2025')
    expect(state.managers).toHaveLength(12)
    expect(state.managers.map((m) => m.name)).toContain('Nick')
    expect(state.unmatched).toEqual([])
    expect(warnings.filter((w) => /Unrecognized manager/.test(w))).toEqual([])
  })

  it('still honours ?demoOrder=1, which the rail budget is verified against', () => {
    const { order, state } = loadFixture('?demoOrder=1')
    expect(order).toEqual(state.managers.map((m) => m.name))
  })

  it('keeps the committed fallback in step with the live sheet', () => {
    /*
     * `nominationOrder` is the last resort, reached only if the sheet is unreadable.
     * It is worth nothing if it names last season's roster, and nothing checks that
     * for us -- so assert it against this season's twelve. If someone edits one list
     * and not the other, this fails instead of the wall quietly showing a stale order.
     */
    expect([...league.nominationOrder].sort()).toEqual([...league.managers].sort())
  })
})
