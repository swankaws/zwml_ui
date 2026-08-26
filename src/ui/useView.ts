/**
 * Which of the two views is on the wall (docs/DESIGN.md 7.4, 7.9).
 *
 * `R` toggles. This lives in a hook rather than in the store, unlike the poll loop and the
 * watchdog: those are outside React because the failure they exist for is the React tree
 * unmounting itself (8.1), and a view toggle has nothing to recover from -- if the tree is
 * dead there is no view to switch to, and `FrozenBoard` is what the room gets instead. So
 * this follows `useDisplayScale`, which is the established pattern here for a
 * keyboard-driven display value.
 *
 * The idle auto-return is the part worth arguing about, so: it stays, and it is the
 * difference between a feature and a hazard. Nobody stands at this machine. Someone presses
 * `R` to settle an argument about who still needs a kicker, walks back to the table, and
 * the projector is now showing rosters for the rest of the auction -- with the max bids,
 * which are the reason the display exists, nowhere on the wall. Returning by itself makes
 * the roster view safe to reach for.
 *
 * 45 seconds rather than 7.4's ~30: reading twelve squads takes longer than half a minute,
 * and any keypress restarts the clock, so an operator who is actively using it is never
 * yanked away mid-sentence.
 */

import { useEffect, useRef, useState } from 'react'

export type View = 'board' | 'roster'

export const IDLE_RETURN_MS = 45_000

/** `?view=roster` pins the view, which is how the layout gate measures it. */
export function viewFromQuery(search: string): View | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('view')
  return raw === 'roster' ? 'roster' : raw === 'board' ? 'board' : null
}

export function useView(search = typeof window === 'undefined' ? '' : window.location.search): View {
  const pinned = viewFromQuery(search)
  const [view, setView] = useState<View>(pinned ?? 'board')
  /*
   * Ref as well as state, because the idle timer's callback and the keydown handler both
   * need the current view without being re-bound on every toggle -- re-binding the listener
   * is what would drop a keypress that arrives during the re-render.
   */
  const viewRef = useRef<View>(pinned ?? 'board')

  useEffect(() => {
    // A pinned view is a measurement or an operator decision made in the URL; nothing may
    // move it, including the idle timer.
    if (pinned !== null) return

    let idle: number | undefined
    const show = (next: View) => {
      viewRef.current = next
      setView(next)
      window.clearTimeout(idle)
      // Only the roster view returns on its own. The board is where it returns TO.
      if (next === 'roster') idle = window.setTimeout(() => show('board'), IDLE_RETURN_MS)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'r' || event.key === 'R') {
        show(viewRef.current === 'roster' ? 'board' : 'roster')
        event.preventDefault()
        return
      }

      /*
       * Any other key means someone is at the keyboard, so restart the clock rather than
       * pulling the view out from under them. Note `r` is ALSO the refetch key in
       * `main.tsx`: pressing it does both, which is harmless and arguably right -- someone
       * switching views is someone who wants current figures.
       */
      if (viewRef.current === 'roster') {
        window.clearTimeout(idle)
        idle = window.setTimeout(() => show('board'), IDLE_RETURN_MS)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(idle)
    }
  }, [pinned])

  return view
}
