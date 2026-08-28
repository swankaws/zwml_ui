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
     * Which axis the LIST advances along, and this is subtler than "which one is bigger".
     *
     * On a phone the rail is a wrapping flex row, so the first two children can sit on the same line -- or
     * two pixels apart on baselines, depending on the font -- while the row itself runs left to right. An
     * earlier version compared `offsetTop` and picked the winner: it saw the 2px baseline drop and animated
     * `translateY(2px)`, which is invisible and reads as "no animation".
     *
     * The honest signal is the horizontal delta being LARGER than the vertical: on the projector's stacked
     * list the horizontal delta is 0, so `vertical` wins by default. `>` rather than `>=` for the tie so
     * the projector case stays vertical when both are zero (which happens on the first paint).
     */
    const step = shiftStep(first, second)
    if (step === null) return

    element.animate(
      [
        /* Start where the list WAS -- one slot further along -- and settle to where it now is. */
        {
          transform:
            step.axis === 'y' ? `translateY(${step.delta}px)` : `translateX(${step.delta}px)`,
        },
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
  /*
   * Timers OUTSIDE the effect, one per name, cleared only on unmount.
   *
   * This is the fix for a real bug and the reason not to go back to the obvious version. The first attempt
   * created the removal timer inside the effect and returned `clearTimeout` as its cleanup. `justFinished`
   * is a one-shot -- true for exactly one commit -- so on the very next render the effect's key changed to
   * empty, React ran the cleanup, and the cleanup CANCELLED THE REMOVAL. The name stayed in this set
   * forever: rendered, holding its grid row open, and pinned at `opacity: 0` by the animation's `both` fill
   * mode. Which read as a permanent gap in ON THE CLOCK, and as a manager who never came back after their
   * pick was undone.
   *
   * A cleanup that cancels the work it was scheduled to protect is easy to write and hard to see.
   */
  const timers = useRef(new Map<string, number>())

  /* A stable key, so the effect depends on the CONTENTS of the set rather than its identity. */
  const key = [...justFinished].sort().join('|')

  useEffect(() => {
    if (key === '') return
    const names = key.split('|')
    setExiting((held) => new Set([...held, ...names]))

    for (const name of names) {
      // Restart the clock if this name is somehow already leaving, rather than stacking two timers.
      const running = timers.current.get(name)
      if (running !== undefined) window.clearTimeout(running)
      timers.current.set(
        name,
        window.setTimeout(() => {
          timers.current.delete(name)
          setExiting((held) => {
            if (!held.has(name)) return held
            const next = new Set(held)
            next.delete(name)
            return next.size === 0 ? EMPTY : next
          })
        }, ms),
      )
    }
  }, [key, ms])

  /* Timers are cancelled ONLY here. Anywhere else and they cancel the removal they exist to perform. */
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer)
      timers.current.clear()
    },
    [],
  )

  return exiting
}

/** Shared empty set, so an unchanged result is referentially stable and cannot cause a re-render. */
const EMPTY: ReadonlySet<string> = new Set()

/**
 * Should this entry still be drawn in ON THE CLOCK?
 *
 * A finished manager is shown only while they are leaving. Anyone not finished is always shown -- which is
 * also what puts a manager straight back after their pick is UNDONE, without waiting out an exit for
 * something that has been reversed.
 */
export function isVisibleNominee(full: boolean, leaving: boolean): boolean {
  return !full || leaving
}

/**
 * Should this entry be playing its exit animation?
 *
 * Guarded on CURRENT fullness, not on the exiting set alone, and that guard is the undo case: a manager can
 * still be inside the 620ms hold when their pick is retracted, and animating them out then would fade a
 * name that has just become eligible again -- invisible until the hold expired, and gone at the moment it
 * became their turn. The stale entry in the set expires on its own timer, harmlessly.
 */
export function isLeavingNominee(full: boolean, leaving: boolean): boolean {
  return full && leaving
}

/**
 * Which axis a list advances along, and by how much.
 *
 * Extracted so the rule is testable, and the rule matters. On the projector the rail is a stacked list --
 * vDelta 47, hDelta 0 -- and on a phone it is a wrapping flex row -- vDelta 2 (baseline drop), hDelta 42.
 * Comparing `top` alone picked VERTICAL on the phone and animated a 2px shift, which is invisible; the
 * larger-absolute-delta rule picks horizontal there and vertical everywhere else.
 *
 * `null` for a first paint or a shift into a wrapped position -- either way there is nothing to animate.
 */
export function shiftStep(
  first: { offsetTop: number; offsetLeft: number },
  second: { offsetTop: number; offsetLeft: number },
): { axis: 'x' | 'y'; delta: number } | null {
  const vDelta = second.offsetTop - first.offsetTop
  const hDelta = second.offsetLeft - first.offsetLeft
  const axis = Math.abs(vDelta) >= Math.abs(hDelta) ? 'y' : 'x'
  const delta = axis === 'y' ? vDelta : hDelta
  return delta > 0 ? { axis, delta } : null
}
