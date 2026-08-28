/**
 * The clip picker.
 *
 * `MomentOverlay` itself is presentation and dismissal, which the layout gate measures on a real screen.
 * This is the one piece of it that is a decision.
 *
 * It USED to be deterministic -- seeded on the manager's or player's name -- and these tests pinned that.
 * The maintainer's call was variety: with four homer clips a name-seed that happens to collide gives none.
 * So the tests now assert the properties that survive randomness, which are the ones that actually matter.
 */

import { describe, expect, it } from 'vitest'
import { gifFrom } from './MomentOverlay'
import { PLAYER_TAGS } from '../model/playerTags'

const DONE = ['done_1.gif', 'done_2.gif', 'done_3.gif', 'done_4.gif', 'done_5.gif']

describe('gifFrom', () => {
  it('only ever returns a clip from the list it was given', () => {
    // The property that must hold however the choice is made: a name not in the list is a broken <img>.
    for (let i = 0; i < 200; i += 1) expect(DONE).toContain(gifFrom(DONE))
  })

  it('reaches every clip in the list, so added variety is actually used', () => {
    /*
     * The reason for the change. Adding `homer_4.gif` is pointless if the picker can never land on it, and a
     * name-seeded pick over a handful of names could easily miss one. 200 draws over 5 clips missing any is
     * about 5 x 0.8^200 -- vanishingly unlikely to flake.
     */
    const seen = new Set(Array.from({ length: 200 }, () => gifFrom(DONE)))
    expect(seen.size).toBe(DONE.length)
  })

  it('handles a single-clip list, which is what the kicker and the hoarder have', () => {
    expect(gifFrom(['punting.gif'])).toBe('punting.gif')
    expect(gifFrom(['hoarder_1.gif'])).toBe('hoarder_1.gif')
  })

  it('draws from every tag clip list without going out of bounds', () => {
    // Drives the real table rather than a fixture, so a badly-typed clips array fails here.
    for (const entry of PLAYER_TAGS) {
      for (let i = 0; i < 50; i += 1) expect(entry.clips).toContain(gifFrom(entry.clips))
    }
  })

  it('uses all four homer clips', () => {
    const homer = PLAYER_TAGS.find((entry) => entry.tag === 'h')
    expect(homer?.clips).toHaveLength(4)
    const seen = new Set(Array.from({ length: 200 }, () => gifFrom(homer?.clips ?? [])))
    expect(seen.size).toBe(4)
  })
})
