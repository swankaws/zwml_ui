/**
 * Team names per manager, fetched once (docs/DESIGN.md 7.2).
 *
 * A convenience for whoever is running the draft: hover a manager on the board and see which team is
 * theirs. Everything here is built to be ignorable -- one fetch, no retry, no polling, and every failure
 * path ends in an empty map and no tooltip.
 *
 * NOT in `boardStore`. The store owns the poll loop, the nomination pointer and the ticker, and it is the
 * code this display cannot afford to have wrong. A tooltip for one person does not get to add a third
 * fetch target to it. The cost of keeping it out here is that the tab is read once per page load, which is
 * exactly right: team names do not change during an auction.
 */

import { useEffect, useState } from 'react'
import { league } from '../config/league'
import { parseCsv } from '../data/csv'
import { parseTeamsToManagers } from '../data/teamsParser'
import type { SheetSource } from '../data/sheetClient'

/** Frozen so a caller cannot mutate the shared empty case, and stable so it never re-renders. */
const NONE: Readonly<Record<string, string>> = Object.freeze({})

export function useTeamNames(
  source: SheetSource | null,
  gid: string | null = league.teamsTabGid,
): Readonly<Record<string, string>> {
  const [teams, setTeams] = useState<Readonly<Record<string, string>>>(NONE)

  useEffect(() => {
    if (source === null || gid === null) return
    /*
     * `cancelled` rather than an AbortController on the store's behalf: this is a one-shot read whose
     * only job is to not call `setTeams` after unmount. Aborting the request would be tidier and buys
     * nothing -- it is one small CSV.
     */
    let cancelled = false
    source
      .fetchTab(gid)
      .then((tab) => {
        if (cancelled) return
        const { teams: parsed, warnings } = parseTeamsToManagers(parseCsv(tab.text))
        /*
         * Logged, not surfaced on the wall. A malformed teams tab costs a tooltip, and the notices strip
         * is for things that affect what the room is reading -- 7.8's rule is that a warning has to be
         * worth the space it takes from the rows.
         */
        if (warnings.length > 0) console.warn(`[zwml]\n${warnings.join('\n')}`)
        setTeams(Object.keys(parsed).length > 0 ? parsed : NONE)
      })
      .catch(() => {
        /*
         * Deliberately silent. The tab may not exist, may be renamed, may be private -- and none of that
         * is a reason to put anything on a wall in front of twelve people.
         */
      })
    return () => {
      cancelled = true
    }
  }, [source, gid])

  return teams
}
