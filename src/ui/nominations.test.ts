import { describe, expect, it } from 'vitest'
import { nominationWindow } from './nominations'

const ORDER = ['Kevin', 'Corky', 'Ryan', 'Toby', 'Jeff', 'Marc']
const noneFull = () => false

const names = (entries: { name: string }[]) => entries.map((e) => e.name)

describe('nominationWindow', () => {
  it('returns five nominators from the cursor forward', () => {
    const window = nominationWindow({ order: ORDER, cursor: 0, isFull: noneFull })
    expect(names(window)).toEqual(['Kevin', 'Corky', 'Ryan', 'Toby', 'Jeff'])
  })

  it('marks only the first eligible manager as on the clock', () => {
    const window = nominationWindow({ order: ORDER, cursor: 0, isFull: noneFull })
    expect(window.filter((e) => e.onClock).map((e) => e.name)).toEqual(['Kevin'])
  })

  it('wraps around the end of the order', () => {
    const window = nominationWindow({ order: ORDER, cursor: 4, isFull: noneFull })
    expect(names(window)).toEqual(['Jeff', 'Marc', 'Kevin', 'Corky', 'Ryan'])
  })

  it('shows a full manager struck through instead of hiding them', () => {
    // The room knows the order by heart; a name vanishing reads as a bug.
    const window = nominationWindow({
      order: ORDER,
      cursor: 0,
      isFull: (n) => n === 'Kevin',
      liveCount: 2,
    })
    expect(names(window)).toEqual(['Kevin', 'Corky', 'Ryan'])
    expect(window[0]).toMatchObject({ name: 'Kevin', full: true, onClock: false })
  })

  it('does not count a full manager toward the live total', () => {
    const window = nominationWindow({
      order: ORDER,
      cursor: 0,
      isFull: (n) => n === 'Corky' || n === 'Ryan',
      liveCount: 3,
    })
    expect(names(window)).toEqual(['Kevin', 'Corky', 'Ryan', 'Toby', 'Jeff'])
    expect(window.filter((e) => !e.full)).toHaveLength(3)
  })

  it('puts the clock on the first manager who can actually nominate', () => {
    const window = nominationWindow({
      order: ORDER,
      cursor: 0,
      isFull: (n) => n === 'Kevin' || n === 'Corky',
    })
    expect(window.find((e) => e.onClock)?.name).toBe('Ryan')
  })

  it('returns nothing when nobody is eligible, so the rail can say the draft is over', () => {
    // Twelve crossed-out names is both useless -- the table already says FULL for
    // each of them -- and the rail over-subscription 7.2 exists to prevent.
    expect(nominationWindow({ order: ORDER, cursor: 0, isFull: () => true })).toEqual([])
  })

  it('terminates rather than spinning when nobody is eligible', () => {
    // An unbounded scan for a nominator who does not exist would hang the board.
    const order = Array.from({ length: 500 }, (_, i) => `M${i}`)
    expect(nominationWindow({ order, cursor: 3, isFull: () => true })).toEqual([])
  })

  it('caps rendered lines so a mostly-full field cannot outgrow the rail', () => {
    // Late in the draft: only the last two managers in the order can still bid.
    const window = nominationWindow({
      order: ORDER,
      cursor: 0,
      isFull: (n) => n !== 'Jeff' && n !== 'Marc',
      liveCount: 5,
    })
    expect(window.length).toBeLessThanOrEqual(6)
    expect(window.filter((e) => !e.full).map((e) => e.name)).toEqual(['Jeff', 'Marc'])
    expect(window.find((e) => e.onClock)?.name).toBe('Jeff')
  })

  it('honours an explicit line cap', () => {
    const window = nominationWindow({
      order: ORDER,
      cursor: 0,
      isFull: (n) => n !== 'Marc',
      liveCount: 5,
      maxEntries: 2,
    })
    // Two skips shown, then the eligible manager -- never more than cap + 1 lines.
    expect(window.length).toBeLessThanOrEqual(3)
    expect(window.at(-1)).toMatchObject({ name: 'Marc', onClock: true })
  })

  it('never repeats a manager when the order is shorter than the window', () => {
    const short = ['Kevin', 'Corky']
    const window = nominationWindow({ order: short, cursor: 0, isFull: noneFull, liveCount: 5 })
    expect(names(window)).toEqual(['Kevin', 'Corky'])
  })

  it('renders nothing for an unset order rather than throwing', () => {
    // league.nominationOrder is [] until Q14 is answered, and the board must
    // still come up.
    expect(nominationWindow({ order: [], cursor: 0, isFull: noneFull })).toEqual([])
  })

  it('tolerates a cursor past the end or below zero', () => {
    expect(names(nominationWindow({ order: ORDER, cursor: 13, isFull: noneFull }))[0]).toBe('Corky')
    expect(names(nominationWindow({ order: ORDER, cursor: -1, isFull: noneFull }))[0]).toBe('Marc')
  })

  it('returns nothing for a non-positive window', () => {
    expect(nominationWindow({ order: ORDER, cursor: 0, isFull: noneFull, liveCount: 0 })).toEqual([])
  })
})
