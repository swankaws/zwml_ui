/**
 * Resolving the nomination order from whichever source has one (docs/DESIGN.md 7.5).
 *
 * Four sources, and the reason there are four is that the rotation has to survive
 * every partial failure of the others. Cheapest usable one wins:
 *
 *   1. `?order=` / the SETTINGS tab   -- applied above this by `resolveSettings`
 *   2. cell A1 of the auction tab     -- what the maintainer actually curates
 *   3. `league.nominationOrder`       -- the committed last resort
 *   4. nothing                        -- the strip hides; it does not guess
 *
 * This lived in `dev/fixtureState.ts` through phase 3. It moved here when the live
 * client arrived, because it was never dev-only: A1 is read from the same request the
 * board already makes, so the live path needs exactly this chain (section 12, phase 4).
 *
 * Pure: a roster and a string in, an order out. No fetch, no DOM.
 */

import { league } from '../config/league'
import { parseOrder } from '../config/displaySettings'

export interface ResolvedOrder {
  order: readonly string[]
  warnings: string[]
  /** Which source won, for the status bar and the debug overlay. */
  source: 'sheet' | 'config' | 'none'
}

/**
 * @param roster  Names **as parsed from this tab**, never `league.managers`.
 * @param a1      Raw text of A1, unvalidated (`ParsedTab.orderHint`).
 */
export function resolveNominationOrder(roster: readonly string[], a1: string): ResolvedOrder {
  /*
   * A1 is validated against the roster of the tab in front of us, which is the whole
   * point: it lets a manager the committed config has never heard of appear in the
   * rotation without a deploy. It also goes stale -- both committed fixtures carried
   * an A1 naming `Rob`, who has not played in years -- so a fumbled A1 rejects
   * wholesale and falls through rather than putting a wrong rotation on the wall.
   */
  const fromSheet = parseOrder(a1, roster, 'A1')
  if (fromSheet.order) {
    return { order: fromSheet.order, warnings: fromSheet.warnings, source: 'sheet' }
  }

  /*
   * The committed order is validated too, against this same roster.
   *
   * Skipping that looks harmless -- it is our own list -- and is not. It names the
   * CURRENT season's managers, so on a past tab it names someone with no row. The
   * rail then treats a manager it cannot find as "not full", i.e. able to nominate,
   * and 2025 rendered `Kris` ON THE CLOCK on a draft that finished a year ago, while
   * the same state reported `draftComplete`. A rotation naming someone who is not on
   * the board is not a usable rotation; showing none is honest.
   */
  const fromConfig = parseOrder(league.nominationOrder.join(' > '), roster, 'Committed order')

  if (fromConfig.order) {
    return { order: fromConfig.order, warnings: fromSheet.warnings, source: 'config' }
  }

  /*
   * Both failed, so the rail will say NOMINATION ORDER NOT SET -- and the room gets ONE box about it.
   *
   * Surfacing both sources' complaints put two near-identical amber sentences side by side on the 2025
   * board, differing only in a name, and the second was unactionable anyway: nobody can edit the
   * committed fallback during a draft. Dropping it left two boxes still -- A1's complaint, plus a
   * generic "fix A1" -- which is one box too many for the same reason. A1 already named the cell.
   *
   * So the fix is appended to A1's own sentence rather than printed beside it. The generic line only
   * stands alone when A1 was silent, i.e. when the cell is empty and there is nothing to quote.
   */
  const remedy = 'Fix cell A1 or the SETTINGS tab `order` row.'
  const warnings =
    fromSheet.warnings.length > 0
      ? [`${fromSheet.warnings.join(' ')} ${remedy}`]
      : [`No nomination order is set. ${remedy}`]

  return { order: [], warnings, source: 'none' }
}
