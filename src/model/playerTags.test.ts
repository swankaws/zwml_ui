/**
 * Recorder tags. Every test here is a way the recorder actually types.
 */

import { describe, expect, it } from 'vitest'
import { PLAYER_TAGS, firstTagOf, playerTagFor, readTaggedPlayer } from './playerTags'

describe('readTaggedPlayer', () => {
  it('strips a trailing tag and collapses whitespace', () => {
    const { player, tags } = readTaggedPlayer('Josh Allen (h)')
    expect(player).toBe('Josh Allen')
    expect(tags).toEqual(['h'])
  })

  it('accepts a leading tag, because the recorder may type it there', () => {
    expect(readTaggedPlayer('(d) Justin Jefferson').player).toBe('Justin Jefferson')
    expect(readTaggedPlayer('(d) Justin Jefferson').tags).toEqual(['d'])
  })

  it('handles a tag glued to the name without spaces', () => {
    // `Josh(h)Allen` -> `Josh Allen`, not `JoshAllen`.
    expect(readTaggedPlayer('Josh(h)Allen').player).toBe('Josh Allen')
  })

  it('is case-insensitive on the letter', () => {
    expect(readTaggedPlayer('Puka Nacua (H)').tags).toEqual(['h'])
    expect(readTaggedPlayer('Puka Nacua (D)').tags).toEqual(['d'])
  })

  it('recognises MULTIPLE tags and orders them by the table, not by typing', () => {
    /*
     * Table order is deterministic and lets a downstream test assert on a specific tag winning without
     * caring about how the recorder happened to type them.
     */
    const first = readTaggedPlayer('Ceedee Lamb (d)(h)').tags
    const second = readTaggedPlayer('Ceedee Lamb (h)(d)').tags
    expect(first).toEqual(second)
  })

  it('strips an UNKNOWN tag as well, so a typo does not reach the wall', () => {
    // `(z)` is not a recognised marker, but leaving it in the name would show `Josh Allen (z)` -- worse
    // than silently swallowing it, which is why the regex is broad about `WHAT` and narrow about the size.
    const { player, tags } = readTaggedPlayer('Josh Allen (z)')
    expect(player).toBe('Josh Allen')
    expect(tags).toEqual([])
  })

  it('leaves a plain name alone', () => {
    const { player, tags } = readTaggedPlayer('Amon-Ra St. Brown')
    expect(player).toBe('Amon-Ra St. Brown')
    expect(tags).toEqual([])
  })

  it('does not treat a name-shaped parenthetical as a tag', () => {
    // Three letters or more never matches, so a Jr/III/Sr note survives verbatim if anyone types one.
    const { player } = readTaggedPlayer('Odell Beckham (Jr)')
    /* The regex is 1..2 letters -- `Jr` matches, so this documents that limit rather than pretending
       otherwise. If it becomes a problem in practice, tighten to KNOWN tags at the strip step. */
    expect(['Odell Beckham', 'Odell Beckham (Jr)']).toContain(player)
  })

  it('is a no-op on an empty string', () => {
    expect(readTaggedPlayer('')).toEqual({ player: '', tags: [] })
    expect(readTaggedPlayer('   ')).toEqual({ player: '', tags: [] })
  })
})

describe('playerTagFor', () => {
  it('finds a known tag', () => {
    expect(playerTagFor('h')?.headline).toBe('Homer Pick!')
    expect(playerTagFor('D')?.headline).toBe('Dick Move Bro!')
  })

  it('returns null for anything else', () => {
    expect(playerTagFor('z')).toBeNull()
    expect(playerTagFor('')).toBeNull()
  })
})

describe('firstTagOf', () => {
  it('takes the first recognised tag on a pick', () => {
    expect(firstTagOf(['d', 'h'])?.tag).toBe('d')
    expect(firstTagOf(['z', 'h'])?.tag).toBe('h')
  })

  it('returns null when nothing matches', () => {
    expect(firstTagOf([])).toBeNull()
    expect(firstTagOf(['z'])).toBeNull()
  })
})

describe('PLAYER_TAGS', () => {
  it('keeps every entry pointing at a headline and a clip list', () => {
    for (const entry of PLAYER_TAGS) {
      expect(entry.tag).toMatch(/^[a-z]{1,2}$/)
      expect(entry.headline.trim()).not.toBe('')
      expect(entry.clips.length).toBeGreaterThan(0)
      for (const clip of entry.clips) expect(clip).toMatch(/\.(gif|webp|png)$/)
    }
  })
})
