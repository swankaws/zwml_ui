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
import './ui/theme.css'

const search = typeof window === 'undefined' ? '' : window.location.search
const fixture = loadFixture(search)

if (fixture.warnings.length > 0) {
  // Template drift is a warning, not a failure: the board still renders (5.4).
  console.warn(`[zwml] ${fixture.warnings.length} parse warning(s)`, fixture.warnings)
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <App
      year={fixture.year}
      state={fixture.state}
      order={fixture.order}
      sales={fixture.sales}
      feedLabel="FIXTURE"
      feed="stale"
    />,
  )
}
