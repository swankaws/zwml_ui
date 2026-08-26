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

export type View = 'board' | 'roster' | 'history' | 'complete'

export const IDLE_RETURN_MS = 45_000

const VIEWS: readonly View[] = ['board', 'roster', 'history', 'complete']

/** `?view=roster` pins the view, which is how the layout gate measures it. */
export function viewFromQuery(search: string): View | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('view')
  return VIEWS.find((view) => view === raw) ?? null
}

export interface ViewControl {
  view: View
  /**
   * Tap affordance for touch devices, which have no keyboard at all (7.9: "anything reachable
   * only by key must also be reachable by tap"). The maintainer found this the hard way -- the
   * roster view was unreachable on a phone.
   */
  toggle: () => void
  /** Jump straight to a view, for the touch controls, which have no cycle to walk. */
  show: (next: View) => void
}

export function useView(search = typeof window === 'undefined' ? '' : window.location.search): ViewControl {
  const pinned = viewFromQuery(search)
  const [view, setView] = useState<View>(pinned ?? 'board')
  /*
   * Ref as well as state, because the idle timer's callback and the keydown handler both
   * need the current view without being re-bound on every toggle -- re-binding the listener
   * is what would drop a keypress that arrives during the re-render.
   */
  const viewRef = useRef<View>(pinned ?? 'board')

  /*
   * Held in a ref so the tap handler and the key handler drive the same `show`, including its idle
   * timer, without the effect being re-created (and the listener re-bound) on every toggle.
   */
  const showRef = useRef<(next: View) => void>(() => {})

  useEffect(() => {
    // A pinned view is a measurement or an operator decision made in the URL; nothing may
    // move it, including the idle timer.
    if (pinned !== null) return

    let idle: number | undefined
    const show = (next: View) => {
      viewRef.current = next
      setView(next)
      window.clearTimeout(idle)
      /*
       * The board is what everything returns TO, so only the other views run the clock -- except the
       * finale, which is exempt. The idle timer exists so a projector is never stranded on a reference
       * screen while bidding continues; once every roster is full there is no bidding to return to, and
       * being stranded on the party is the desired outcome.
       */
      if (next !== 'board' && next !== 'complete') {
        idle = window.setTimeout(() => show('board'), IDLE_RETURN_MS)
      }
    }

    /** Any interaction restarts the clock -- see `onKey` for why this matters for history. */
    const bump = () => {
      if (viewRef.current === 'board') return
      window.clearTimeout(idle)
      idle = window.setTimeout(() => show('board'), IDLE_RETURN_MS)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'r' || event.key === 'R') {
        show(viewRef.current === 'roster' ? 'board' : 'roster')
        event.preventDefault()
        return
      }

      /* The way out of the finale, and harmless everywhere else. */
      if (event.key === 'Escape' && viewRef.current !== 'board') {
        show('board')
        return
      }

      if (event.key === 'h' || event.key === 'H') {
        show(viewRef.current === 'history' ? 'board' : 'history')
        event.preventDefault()
        return
      }

      /*
       * Any other key means someone is at the keyboard, so restart the clock rather than pulling
       * the view out from under them.
       *
       * `r` used to ALSO refetch, because `main.tsx` bound the same letter. Two actions on one key
       * reads as a bug even when both are harmless, so refetch moved to `g`.
       */
      if (viewRef.current === 'roster') {
        window.clearTimeout(idle)
        idle = window.setTimeout(() => show('board'), IDLE_RETURN_MS)
      }
    }

    showRef.current = show
    window.addEventListener('keydown', onKey)
    /*
     * Scrolling and touching count as being present. The history view is the one screen that is
     * READ rather than glanced at, and it is the one screen that scrolls -- so a keypress-only idle
     * timer would pull it away from someone halfway down the list, which is worse than the hazard
     * the timer exists for.
     */
    window.addEventListener('wheel', bump, { passive: true })
    window.addEventListener('touchmove', bump, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', bump)
      window.removeEventListener('touchmove', bump)
      window.clearTimeout(idle)
    }
  }, [pinned])

  return {
    view,
    toggle: () => showRef.current(viewRef.current === 'roster' ? 'board' : 'roster'),
    show: (next: View) => showRef.current(next),
  }
}

/**
 * Whether the keyboard reference is on screen (7.9).
 *
 * `?` or `H` toggles, `Esc` closes. A hook rather than store state, for the same reason as the
 * view toggle: there is nothing here to survive a dead React tree, because with no tree there is
 * no overlay to show.
 *
 * `?view=help` pins it open, which is how the layout gate measures it -- an overlay that has never
 * been measured is exactly the mistake the notices strip made (see `Notices.tsx`).
 */
export interface HelpControl {
  open: boolean
  toggle: () => void
}

export function useHelp(search = typeof window === 'undefined' ? '' : window.location.search): HelpControl {
  const pinned = new URLSearchParams(search.replace(/^\?/, '')).get('view') === 'help'
  const [open, setOpen] = useState(pinned)

  useEffect(() => {
    if (pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // `?` only. `h` went to the history view, and one key doing two things reads as a bug.
      if (event.key === '?' || event.key === '/') {
        setOpen((was) => !was)
        event.preventDefault()
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])

  return { open, toggle: () => setOpen((was) => !was) }
}
