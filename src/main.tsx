import { createRoot } from 'react-dom/client'
import { league, totalAuctionSlots } from './config/league'

/**
 * Placeholder shell. The board itself is build-order phase 3; this exists so
 * the repo builds, deploys, and proves the Pages pipeline end to end before
 * there is anything real to break. See docs/DESIGN.md section 12.
 */
function App() {
  const year = league.auctionTabs[0]?.year
  return (
    <main
      style={{
        background: '#0b0d10',
        color: '#f2f4f7',
        font: '600 clamp(16px, 3vh, 28px)/1.4 system-ui, sans-serif',
        minHeight: '100vh',
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '1.6em' }}>ZWML {year} Auction</h1>
      <p style={{ opacity: 0.7 }}>
        Display scaffold. {league.managers.length} managers &middot;{' '}
        {totalAuctionSlots} auction slots &middot; ${league.budget} each.
      </p>
      <p style={{ opacity: 0.5, fontSize: '0.7em' }}>
        See docs/DESIGN.md for the build order.
      </p>
    </main>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
