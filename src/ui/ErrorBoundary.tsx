/**
 * Keeps the projector lit when a render throws (docs/DESIGN.md section 8.1).
 *
 * React 19 unmounts the whole tree on an uncaught render error: the wall goes white,
 * in a room where nobody is holding a keyboard, at the loudest moment of the night.
 * This catches that. The decisions all live in `boundaryState.ts` so they can be tested
 * without a DOM; what is left here is the React plumbing and nothing else.
 *
 * `data-boundary` is on the wrapper for `tools/verify-layout.mjs`, which drives the
 * `?crash=1` case in real Chrome -- the only honest way to check that a crashed board
 * still shows figures.
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import {
  INITIAL_BOUNDARY,
  afterCrash,
  afterNewData,
  isBroken,
  type BoundaryState,
} from './boundaryState'

export interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Changes when a new board arrives. The snapshot reference itself is ideal: the
   * store only replaces it when something actually changed.
   */
  resetKey: unknown
  /** Rendered while frozen. Must be simple enough that it cannot throw. */
  fallback: ReactNode
  /** Starts the watchdog's clock (`store.noteRenderError`). */
  onBroken?: (error: Error) => void
  /** Stops it (`store.clearRenderError`). */
  onRecovered?: () => void
}

interface State extends BoundaryState {
  /** Set by `getDerivedStateFromError` so the throwing children stop rendering at once. */
  caught: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { ...INITIAL_BOUNDARY, caught: false }

  /**
   * Both lifecycle methods, on purpose, and they do different jobs.
   *
   * This one runs during the render phase and is what stops React unmounting the tree:
   * it must return new state synchronously. It has no access to the previous state, so
   * it cannot run the machine -- it only raises a flag, which `render` treats as "show
   * the fallback for this one frame".
   */
  static getDerivedStateFromError(): Partial<State> {
    return { caught: true }
  }

  /** Runs after the commit, WITH previous state, so the machine advances here. */
  componentDidCatch(error: Error, info: ErrorInfo) {
    const next = afterCrash(this.state)
    this.setState({ ...next, caught: false })

    /*
     * Logged, not swallowed. Nobody is watching a console on draft night, but this is
     * the only record of what actually broke, and the morning after is when it gets
     * read.
     */
    console.error('[zwml] render error', error, info.componentStack)

    // Announced once, on the transition into frozen: the watchdog measures how long
    // the tree has been broken, and a retry that throws again must not restart that
    // clock. While retrying, the board is still on the wall -- nothing is wrong yet.
    if (isBroken(next)) this.props.onBroken?.(error)
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey === this.props.resetKey) return

    const next = afterNewData(this.state)
    if (next === this.state) return

    this.setState({ ...next, caught: false })
    if (isBroken(this.state) && !isBroken(next)) this.props.onRecovered?.()
  }

  render() {
    const frozen = this.state.caught || this.state.view === 'frozen'

    return (
      <div className="boundary" data-boundary={frozen ? 'frozen' : this.state.view}>
        {/*
         * A keyed Fragment, not a keyed div: the key is what turns the retry into a
         * remount rather than a re-render -- a subtree that threw part-way through a
         * commit can be left in a state where rendering the same elements again throws
         * for an entirely different reason -- and a Fragment buys that without putting
         * an extra box between `.boundary` and `.app`.
         */}
        {frozen ? (
          this.props.fallback
        ) : (
          <Fragment key={this.state.renderKey}>{this.props.children}</Fragment>
        )}
      </div>
    )
  }
}
