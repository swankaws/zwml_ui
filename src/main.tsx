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
import { resolveSettings, settingsFromQuery } from './config/displaySettings'
import './ui/theme.css'

const search = typeof window === 'undefined' ? '' : window.location.search
const fixture = loadFixture(search)

/*
 * Query layer only, for now. Phase 4 adds the SETTINGS tab beneath it -- the
 * precedence chain in `resolveSettings` already has the slot, so wiring the fetch
 * in is a one-line change here and nothing under src/ui moves.
 */
const query = settingsFromQuery(search)
const settings = resolveSettings(query.settings)

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
      feedLabel="FIXTURE"
      feed="stale"
    />,
  )
}
