/**
 * The error boundary's state machine (docs/DESIGN.md section 8.1).
 *
 * Pure, and in its own file, for a reason worth stating: the suite runs in node with
 * no jsdom, so a boundary whose logic lived inside the class could only be tested by
 * adding jsdom and a testing library -- four days before the draft -- to assert on a
 * DOM that is not the one the projector uses anyway. Splitting the decisions out means
 * every transition is a unit test here, and the thing jsdom would have checked badly
 * (does the wall still show figures?) is checked properly in real Chrome by
 * `tools/verify-layout.mjs`.
 *
 * Three views, and the middle one is the point. React 19 unmounts the tree on an
 * uncaught render error, so the projector goes white in a room where nobody is holding
 * a keyboard. A boundary that renders a bare "something went wrong" is barely better:
 * the room loses the numbers. So: retry once (a one-off measurement race deserves a
 * second chance), and if it throws again, freeze -- keep the last good figures on the
 * wall in a form too simple to fail.
 */

export type BoundaryView =
  /** Children render normally. */
  | 'ok'
  /** Caught once; remounting the children to see if it was transient. */
  | 'retrying'
  /** Caught twice. The plain-text fallback holds the last good figures. */
  | 'frozen'

export interface BoundaryState {
  view: BoundaryView
  /** Consecutive catches. Reset by a recovery, never by a retry. */
  crashes: number
  /** How many times new data has thawed a frozen board. Bounded -- see below. */
  recoveries: number
  /** Bumped to force a full remount rather than a re-render of a poisoned subtree. */
  renderKey: number
}

/**
 * How many times fresh data may thaw a frozen board.
 *
 * Not unbounded, and this is the subtle one. A sheet in a state our parser cannot
 * survive would otherwise cycle -- crash, freeze, new poll 3s later, thaw, crash --
 * flickering the wall every three seconds forever. Worse, each thaw clears the store's
 * render-error clock, so the watchdog's 15-second window never elapses and the reload
 * that would actually fix it never happens. After this many attempts the board stays
 * frozen, the clock keeps running, and the watchdog takes over.
 */
export const MAX_RECOVERIES = 3

export const INITIAL_BOUNDARY: BoundaryState = {
  view: 'ok',
  crashes: 0,
  recoveries: 0,
  renderKey: 0,
}

/** A render threw. */
export function afterCrash(state: BoundaryState): BoundaryState {
  const crashes = state.crashes + 1

  if (crashes === 1) {
    // Remount, don't re-render: a subtree that threw mid-commit can be left in a
    // state where re-rendering the same elements throws again for a different reason.
    return { ...state, view: 'retrying', crashes, renderKey: state.renderKey + 1 }
  }

  return { ...state, view: 'frozen', crashes }
}

/**
 * A new board arrived from the store.
 *
 * This is the only recovery signal, deliberately. Detecting "the retry rendered fine"
 * from inside a class component means inferring it from `componentDidUpdate` not
 * having been preceded by another catch, which is exactly the kind of ordering
 * assumption that works in a test and fails on the night. New data is unambiguous, and
 * it is also the case that actually matters: the crash was almost certainly caused by
 * the *previous* body.
 */
export function afterNewData(state: BoundaryState): BoundaryState {
  if (state.view === 'ok') return state

  if (state.view === 'retrying') {
    // The retry is already rendering children; fresh data just confirms it.
    return { ...state, view: 'ok', crashes: 0 }
  }

  if (state.recoveries >= MAX_RECOVERIES) return state

  return {
    view: 'ok',
    crashes: 0,
    recoveries: state.recoveries + 1,
    renderKey: state.renderKey + 1,
  }
}

/** True while the store's render-error clock should be running (see the watchdog). */
export function isBroken(state: BoundaryState): boolean {
  return state.view === 'frozen'
}
