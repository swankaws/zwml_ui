/**
 * Entry point. Phase 3: the static board, fixture data, no network.
 *
 * See docs/DESIGN.md section 12. Phase 4 replaces `loadFixture` with the polling
 * client and adds the error boundary and the out-of-tree watchdog (8.1); nothing
 * under src/ui changes when it does.
 */

import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { loadFixture } from './dev/fixtureState'
import {
  columnsPinnedByQuery,
  resolveSettings,
  settingsFromQuery,
} from './config/displaySettings'
import './ui/theme.css'

const search = typeof window === 'undefined' ? '' : window.location.search
const fixture = loadFixture(search)

/*
 * Query layer only, for now. Phase 4 adds the SETTINGS tab beneath it -- the
 * precedence chain in `resolveSettings` already has the slot, so wiring the fetch
 * in is a one-line change here and nothing under src/ui moves.
 *
 * The roster comes from the parsed sheet, not from `league.managers`, so `?order=`
 * accepts whoever is actually playing. Validating against the committed list would
 * reject a *correct* order the moment the league swaps a manager -- and then fall
 * back to the equally stale committed order (9.2).
 */
const roster = fixture.state.managers.map((m) => m.name)
const query = settingsFromQuery(search, roster)
const settings = resolveSettings(query.settings)

/*
 * `?asSheet=1` replays the same query settings down the SHEET path instead of the
 * query path. Provenance changes behaviour -- only a URL overrules the column fit
 * test (App's `columnsFrom`) -- so without this there is no way to rehearse what the
 * live SETTINGS tab will actually do until phase 4 wires the fetch, and "we will find
 * out on the night" is the one thing section 10 refuses to accept.
 *
 * It is how the layout gate covers the maintainer's real tab. Phase 4 deletes it
 * along with the rest of the fixture harness.
 */
const asSheet = new URLSearchParams(search.replace(/^\?/, '')).get('asSheet') !== null
const columnsFrom = !asSheet && columnsPinnedByQuery(search) ? 'query' : 'sheet'

const warnings = [...fixture.warnings, ...query.warnings]
if (warnings.length > 0) {
  // Template drift and a fumbled setting are warnings, not failures: the board
  // still renders (5.4), and the operator needs to be told what was ignored.
  console.warn(`[zwml] ${warnings.length} warning(s)`, warnings)
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <App
      year={fixture.year}
      state={fixture.state}
      order={fixture.order}
      sales={fixture.sales}
      settings={settings}
      columnsFrom={columnsFrom}
      feedLabel="FIXTURE"
      feed="stale"
    />,
  )
}
