/**
 * When the ON THE CLOCK list is allowed to slide.
 *
 * The animation itself is a side effect on a real element and belongs to the eye. The DECISION is a pure
 * rule with a right answer, and it is the same rule the value flash had to learn: a board that merely
 * appeared has not changed.
 */

import { describe, expect, it } from 'vitest'
import { SHIFT_MS, shouldAnimateShift } from './useShiftAnimation'

describe('shouldAnimateShift', () => {
  it('slides when the rotation advances', () => {
    expect(shouldAnimateShift(3, 4)).toBe(true)
  })

  it('slides when the operator walks the pointer BACK', () => {
    // `Shift+N` retreats. The list really does move, so it should say so -- direction is the eye's problem.
    expect(shouldAnimateShift(4, 3)).toBe(true)
  })

  it('does NOT slide on a first paint', () => {
    /*
     * The important one. The watchdog reloads the page on purpose when the feed is broken, so a first paint
     * is not a rare event -- and animating it would announce a hand-off that did not happen, every time.
     * `undefined` is "no render seen yet"; `null` is "the cursor is unknown".
     */
    expect(shouldAnimateShift(undefined, 4)).toBe(false)
    expect(shouldAnimateShift(null, 4)).toBe(false)
  })

  it('does not slide when nothing moved', () => {
    // The board re-publishes on every age tick, once a second, all night.
    expect(shouldAnimateShift(4, 4)).toBe(false)
    expect(shouldAnimateShift(0, 0)).toBe(false)
  })

  it('does not slide when the cursor becomes unknown', () => {
    // Every roster full, or the order lost. Nothing is on the clock, so there is no hand-off to show.
    expect(shouldAnimateShift(4, null)).toBe(false)
    expect(shouldAnimateShift(null, null)).toBe(false)
  })

  it('treats position 0 as a real position, not as absent', () => {
    // The classic falsy-zero trap: the top of the order is a legitimate cursor.
    expect(shouldAnimateShift(0, 1)).toBe(true)
    expect(shouldAnimateShift(1, 0)).toBe(true)
  })

  it('is over well inside a poll interval', () => {
    /*
     * Two sales can land in consecutive polls, and an animation still running when the next one arrives
     * would queue or fight. 320ms against a 3s poll leaves an order of magnitude.
     */
    expect(SHIFT_MS).toBeLessThan(1000)
  })
})
