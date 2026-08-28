/**
 * The ON THE CLOCK list sliding into place when the rotation advances (docs/DESIGN.md 7.5).
 *
 * A sale moves the pointer, the top name drops off, and everyone below shifts up. That happened
 * instantaneously, which is the one moment in the night the room is most likely to be looking somewhere
 * else -- an animation is what makes the hand-off visible from the corner of an eye.
 *
 * WHY THE WEB ANIMATIONS API rather than a CSS class or a `key` remount, which is how the value flash
 * works. A remount would re-mount every `Nominee`, and each of those captures its own hand-off wash on
 * mount -- so the shift would set every name in the list washing, not just the one that changed. Animating
 * the container directly leaves the children and their state completely alone.
 *
 * The offset is READ OFF THE SCREEN, not configured. The rail is vertical on a projector and horizontal on
 * a phone, and comparing the first two children tells us which without this file knowing anything about the
 * breakpoint that decided it. Duplicating a media query in JS is how the two drift apart.
 */

import { useEffect, useRef, useState } from 'react'

/** Long enough to read as a movement, short enough to be over before the next thing happens. */
export const SHIFT_MS = 320

/**
 * Should a cursor moving from `previous` to `next` animate?
 *
 * Extracted and exported because it is the only part of this with a right answer worth pinning: the rule
 * that a first paint does NOT animate is the same rule the value flash learned the hard way. Without it,
 * every reload -- including the watchdog's own, which happens when the feed is broken -- would slide the
 * list for a board that merely appeared.
 */
export function shouldAnimateShift(previous: number | null | undefined, next: number | null): boolean {
  if (next === null) return false
  // No previous value means this is the first render we have seen, not a change.
  if (previous === null || previous === undefined) return false
  return previous !== next
}

/**
 * Slides `ref`'s children into place whenever `cursor` changes.
 *
 * Returns nothing: the animation is a side effect on a real element, and there is no state a caller could
 * usefully read. It is deliberately incapable of changing the final layout -- the last keyframe is
 * `transform: none`, so whatever the harness measures after it settles is exactly what it measured before
 * this existed.
 */
export function useShiftAnimation(ref: React.RefObject<HTMLElement | null>, cursor: number | null): void {
  const previous = useRef<number | null | undefined>(undefined)

  useEffect(() => {
    const animate = shouldAnimateShift(previous.current, cursor)
    previous.current = cursor
    if (!animate) return

    const element = ref.current
    // `animate` is absent in older engines and in any non-browser test environment.
    if (!element || typeof element.animate !== 'function') return

    const children = [...element.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
    if (children.length < 2) return

    const [first, second] = children as [HTMLElement, HTMLElement]
    /*
     * Which way the list runs, observed rather than assumed. A second child lower down means the rail is
     * stacked (the projector); level with the first means it is a row (a phone).
     */
    const vertical = second.offsetTop > first.offsetTop
    const delta = vertical ? second.offsetTop - first.offsetTop : second.offsetLeft - first.offsetLeft
    if (delta <= 0) return

    element.animate(
      [
        /* Start where the list WAS -- one slot further along -- and settle to where it now is. */
        { transform: vertical ? `translateY(${delta}px)` : `translateX(${delta}px)` },
        { transform: 'none' },
      ],
      { duration: SHIFT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }, [ref, cursor])
}

/**
 * How long a finished manager takes to leave ON THE CLOCK. Mirrors `--nominee-exit` in theme.css.
 *
 * Duplicated rather than read from the stylesheet because the value has to hold the element in the React
 * tree, and reading a custom property means a layout query on every poll for a number that changes when
 * somebody edits CSS -- which a test can catch instead.
 */
export const NOMINEE_EXIT_MS = 620

/**
 * Names to keep rendering while their exit animation plays.
 *
 * React has no exit animation: the moment a manager is no longer in the list, their element is gone and
 * there is nothing left to animate. So the departing name is HELD here for the length of the animation,
 * independently of renders -- which matters because the board re-publishes on the age tick every second,
 * and something as ordinary as that would otherwise cut the animation off part-way through.
 */
export function useExiting(justFinished: ReadonlySet<string>, ms = NOMINEE_EXIT_MS): ReadonlySet<string> {
  const [exiting, setExiting] = useState<ReadonlySet<string>>(EMPTY)

  /* A stable key, so an effect can depend on the CONTENTS of the set rather than its identity. */
  const key = [...justFinished].sort().join('|')

  useEffect(() => {
    if (key === '') return
    const names = key.split('|')
    setExiting((held) => new Set([...held, ...names]))
    const timer = window.setTimeout(() => {
      setExiting((held) => {
        const next = new Set(held)
        for (const name of names) next.delete(name)
        return next.size === 0 ? EMPTY : next
      })
    }, ms)
    return () => window.clearTimeout(timer)
  }, [key, ms])

  return exiting
}

/** Shared empty set, so an unchanged result is referentially stable and cannot cause a re-render. */
const EMPTY: ReadonlySet<string> = new Set()
