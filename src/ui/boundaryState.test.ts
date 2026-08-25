import { describe, expect, it } from 'vitest'
import {
  INITIAL_BOUNDARY,
  MAX_RECOVERIES,
  afterCrash,
  afterNewData,
  isBroken,
  type BoundaryState,
} from './boundaryState'

describe('afterCrash', () => {
  it('retries once before giving up', () => {
    const state = afterCrash(INITIAL_BOUNDARY)

    expect(state.view).toBe('retrying')
    // A remount, not a re-render: a subtree that threw mid-commit can throw again for
    // an unrelated reason if its elements are merely re-rendered.
    expect(state.renderKey).toBe(INITIAL_BOUNDARY.renderKey + 1)
  })

  it('freezes on the second crash', () => {
    const state = afterCrash(afterCrash(INITIAL_BOUNDARY))

    expect(state.view).toBe('frozen')
    expect(isBroken(state)).toBe(true)
  })

  it('does not keep remounting once frozen', () => {
    const frozen = afterCrash(afterCrash(INITIAL_BOUNDARY))
    const again = afterCrash(frozen)

    expect(again.view).toBe('frozen')
    expect(again.renderKey).toBe(frozen.renderKey)
  })

  it('leaves the recovery budget alone', () => {
    expect(afterCrash(afterCrash(INITIAL_BOUNDARY)).recoveries).toBe(0)
  })
})

describe('afterNewData', () => {
  it('is a no-op on a healthy board', () => {
    expect(afterNewData(INITIAL_BOUNDARY)).toBe(INITIAL_BOUNDARY)
  })

  it('thaws a frozen board', () => {
    const frozen = afterCrash(afterCrash(INITIAL_BOUNDARY))
    const thawed = afterNewData(frozen)

    expect(thawed.view).toBe('ok')
    expect(thawed.crashes).toBe(0)
    expect(thawed.renderKey).toBe(frozen.renderKey + 1)
  })

  it('confirms a retry that is already rendering', () => {
    const thawed = afterNewData(afterCrash(INITIAL_BOUNDARY))

    expect(thawed.view).toBe('ok')
    expect(thawed.crashes).toBe(0)
    expect(thawed.recoveries).toBe(0)
  })

  /*
   * The failure mode this bound exists for: a sheet in a state the parser cannot
   * survive would otherwise cycle crash -> freeze -> new poll 3s later -> thaw ->
   * crash, flickering the wall every three seconds. And because each thaw clears the
   * store's render-error clock, the watchdog's window never elapses and the reload
   * that would fix it never happens.
   */
  it('stops thawing after the budget is spent, so the watchdog can take over', () => {
    let state: BoundaryState = INITIAL_BOUNDARY
    for (let attempt = 0; attempt < MAX_RECOVERIES; attempt += 1) {
      state = afterNewData(afterCrash(afterCrash(state)))
      expect(state.view).toBe('ok')
    }

    state = afterCrash(afterCrash(state))
    expect(state.view).toBe('frozen')

    const stuck = afterNewData(state)
    expect(stuck.view).toBe('frozen')
    expect(isBroken(stuck)).toBe(true)
    expect(stuck.recoveries).toBe(MAX_RECOVERIES)
  })

  it('counts a thaw only when one actually happened', () => {
    const retried = afterCrash(INITIAL_BOUNDARY)
    expect(afterNewData(retried).recoveries).toBe(0)

    const frozen = afterCrash(retried)
    expect(afterNewData(frozen).recoveries).toBe(1)
  })
})

describe('isBroken', () => {
  it('is false while retrying, because the wall still has the board', () => {
    expect(isBroken(afterCrash(INITIAL_BOUNDARY))).toBe(false)
  })

  it('is false on a healthy board', () => {
    expect(isBroken(INITIAL_BOUNDARY)).toBe(false)
  })
})
