/**
 * The live board: the store's snapshot, turned into the phase-3 UI (docs/DESIGN.md 12).
 *
 * Everything below this file was written in phase 3 against fixture data and is unchanged
 * by going live -- which was the point of keeping fetching out of the components. This is
 * the whole seam: subscribe, merge the settings layers, choose between the board and the
 * standby screen.
 *
 * `useSyncExternalStore` and not `useState` + an effect, for the reason in 8.1: an
 * effect-based subscription dies with the tree it lives in, and the store deliberately
 * outlives the tree so a crashed board can still be reloaded by the watchdog.
 *
 * TWO components, and the split is load-bearing rather than tidiness. The subscription
 * sits OUTSIDE the error boundary and the throwable render sits inside it. Put the
 * subscription inside and a crash unmounts it, so no later poll can reach the boundary --
 * `resetKey` freezes at whatever value crashed, `afterNewData` never fires, and the one
 * mechanism that would thaw the wall is the one the crash disabled.
 */

import { useSyncExternalStore } from 'react'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { FrozenBoard } from './FrozenBoard'
import { Notices } from './Notices'
import { Standby } from './Standby'
import { columnsPinnedByQuery, resolveSettings, settingsFromQuery } from '../config/displaySettings'
import { league } from '../config/league'
import type { BoardSnapshot, BoardStore } from '../live/boardStore'
import { pinnedMomentKind } from '../model/moments'

export interface LiveBoardProps {
  store: BoardStore
  /** `window.location.search`, passed in rather than read, so this stays testable. */
  search: string
  /**
   * Position in the nomination order, when something actually knows it. Phase 6 derives
   * it; until then it is `null` unless `?cursor=` says otherwise -- see `nominations.ts`.
   */
  cursor?: number | null
}

export function LiveBoard({ store, search, cursor = null }: LiveBoardProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return (
    <ErrorBoundary
      /*
       * The snapshot reference is the ideal reset signal: the store replaces it only when
       * something a viewer could see actually changed, so this ticks exactly when there
       * is new material to try rendering and never merely because a second passed.
       */
      resetKey={snapshot}
      fallback={
        <FrozenBoard state={snapshot.state} year={snapshot.year} feedLabel={snapshot.feedLabel} />
      }
      onBroken={store.noteRenderError}
      onRecovered={store.clearRenderError}
    >
      <BoardSurface snapshot={snapshot} search={search} cursor={cursor} />
    </ErrorBoundary>
  )
}

interface SurfaceProps {
  snapshot: BoardSnapshot
  search: string
  cursor: number | null
}

/**
 * A pure function of the snapshot: no subscription, no store, nothing to unmount. This
 * is the part allowed to throw, and the boundary above catches it.
 */
function BoardSurface({ snapshot, search, cursor }: SurfaceProps) {
  /*
   * The roster comes from the parsed sheet, not `league.managers`, so `?order=` accepts
   * whoever is actually playing. Validating against the committed list would reject a
   * *correct* order the moment the league swaps a manager -- and then fall back to the
   * equally stale committed order (9.2). Before the first poll lands there is no sheet
   * roster yet, and the committed list is the only thing to check against.
   */
  const roster = snapshot.state?.managers.map((manager) => manager.name) ?? league.managers
  const query = settingsFromQuery(search, roster)

  // Defaults < SETTINGS tab < query string. The URL wins because whoever typed it can
  // see the wall and whoever is editing the sheet cannot.
  const settings = resolveSettings(snapshot.sheetSettings, query.settings)

  const notices = (
    <Notices
      /*
       * A problem is only a footer notice once there are figures on the wall: those
       * numbers are still the truth as of the last good poll, and they are what the room
       * came for. With no board at all the same problem takes the whole screen below.
       */
      problem={snapshot.state === null ? null : snapshot.problem}
      warnings={[...snapshot.warnings, ...query.warnings]}
      unmatched={snapshot.state?.unmatched}
      duplicated={snapshot.state?.duplicated}
    />
  )

  if (snapshot.state === null) {
    return (
      <Standby
        year={snapshot.year}
        problem={snapshot.problem}
        feedLabel={snapshot.feedLabel}
        notices={notices}
      />
    )
  }

  /*
   * The strip goes *into* the shell rather than beside it. As a sibling it was a fixed
   * overlay, and the layout gate measured it covering four managers' figures -- see the
   * header of `Notices.tsx`.
   */
  return (
    <App
      year={snapshot.year}
      state={snapshot.state}
      order={snapshot.order}
      /*
       * `?cursor=N` still wins, because it exists so the layout gate can measure the
       * on-clock styling without a second poll. With no override the live basis is passed
       * instead and `App` derives the pointer against the order it is about to render.
       */
      cursor={cursor}
      pointer={cursor === null ? snapshot.pointer : null}
      sales={snapshot.sales}
      revisions={snapshot.revisions}
      settings={settings}
      columnsFrom={columnsPinnedByQuery(search) ? 'query' : 'sheet'}
      feed={snapshot.feed}
      feedLabel={snapshot.feedLabel}
      notices={notices}
      moment={snapshot.moment}
      /*
       * Fixture-only by construction, so a `?moment=` left in a bookmark cannot strand the projector on
       * an overlay that has no timer and no key out. See `pinnedMomentKind`.
       */
      pinnedMoment={pinnedMomentKind(search)}
    />
  )
}
