/**
 * The clip picker.
 *
 * `MomentOverlay` itself is presentation and dismissal, which the layout gate measures on a real screen.
 * This is the one piece of it that is a pure decision, and it is tested here because "pick one at random"
 * was implemented as something deliberately NOT random.
 */

import { describe, expect, it } from 'vitest'
import { gifFrom } from './MomentOverlay'
import { league } from '../config/league'

const DONE = ['done_1.gif', 'done_2.gif', 'done_3.gif', 'done_4.gif', 'done_5.gif']

describe('gifFrom', () => {
  it('always gives the same name the same clip', () => {
    /*
     * The reason this is not `Math.random()`. A stable pick is testable, it survives the overlay
     * remounting after an ErrorBoundary recovery, and nobody in the room can predict it anyway.
     */
    expect(gifFrom(DONE, 'Kevin')).toBe(gifFrom(DONE, 'Kevin'))
  })

  it('spreads the twelve managers across the clips', () => {
    // Not a uniform distribution, and it does not need to be -- what would be wrong is all twelve
    // landing on one clip, which is what a bad hash would do.
    const picks = new Set(league.managers.map((manager) => gifFrom(DONE, manager)))
    expect(picks.size).toBeGreaterThan(1)
  })

  it('only ever returns a name from the list it was given', () => {
    for (const manager of league.managers) expect(DONE).toContain(gifFrom(DONE, manager))
  })

  it('handles a single-choice list, which is what the kicker has', () => {
    expect(gifFrom(['punting.gif'], 'Harrison Butker')).toBe('punting.gif')
  })

  it('does not throw on an empty name', () => {
    // A blank manager name is already refused upstream by `snapshotSlots`, but a crash here would take
    // the whole board down over a cosmetic choice.
    expect(DONE).toContain(gifFrom(DONE, ''))
  })
})
