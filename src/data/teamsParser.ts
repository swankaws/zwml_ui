/**
 * The `TeamsToManagers` tab: which team name belongs to which manager (docs/DESIGN.md 7.2).
 *
 * A convenience for the person running the draft, who knows the teams and is learning the names -- so the
 * whole feature is deliberately optional. Nothing on the board depends on it: if the tab is missing,
 * unreachable, renamed, or shaped differently than expected, the result is simply no tooltip.
 *
 * COLUMN ORDER IS DISCOVERED, NOT CONFIGURED. The parser finds whichever column resolves to known manager
 * names and takes the team from the other one. That is not cleverness for its own sake -- it means a tab
 * written as `Team, Manager` and one written as `Manager, Team` both work, a header row is skipped for
 * free because "Manager" is not a manager, and nobody has to keep a column index in this file in step
 * with a spreadsheet somebody may reorganise the morning of the draft.
 */

import { readManagerName } from './normalize'

export interface TeamsResult {
  /** Canonical manager name -> team name. Empty when the tab could not be read. */
  teams: Record<string, string>
  warnings: string[]
}

/** How many columns to consider. Wide enough for a stray note column, narrow enough to stay cheap. */
const MAX_COLUMNS = 8

/**
 * Which column holds the manager names.
 *
 * Scored by how many cells resolve, rather than by the first hit, so a `Notes` column that happens to
 * mention somebody once does not win over the actual roster column.
 */
function managerColumn(grid: readonly (readonly string[])[]): number | null {
  let best: { column: number; hits: number } | null = null
  for (let column = 0; column < MAX_COLUMNS; column += 1) {
    let hits = 0
    for (const row of grid) {
      if (readManagerName(row[column] ?? '') !== null) hits += 1
    }
    if (hits > 0 && (best === null || hits > best.hits)) best = { column, hits }
  }
  return best?.column ?? null
}

/**
 * Which column holds the team names, given where the managers are.
 *
 * Discovered the same way and for the same reason: the column with the most content across the rows that
 * actually name a manager. "The first other cell with something in it" was tried and is wrong -- a notes
 * column to the LEFT of the managers wins every row, and every tooltip then reads out of it. Ties break
 * toward the column nearest the managers, which is where a human would have put it.
 */
function teamColumn(grid: readonly (readonly string[])[], managers: number): number | null {
  let best: { column: number; filled: number } | null = null
  for (let column = 0; column < MAX_COLUMNS; column += 1) {
    if (column === managers) continue
    let filled = 0
    for (const row of grid) {
      if (readManagerName(row[managers] ?? '') === null) continue
      if ((row[column] ?? '').trim() !== '') filled += 1
    }
    if (filled === 0) continue
    const better =
      best === null ||
      filled > best.filled ||
      (filled === best.filled &&
        Math.abs(column - managers) < Math.abs(best.column - managers))
    if (better) best = { column, filled }
  }
  return best?.column ?? null
}

export function parseTeamsToManagers(grid: readonly (readonly string[])[]): TeamsResult {
  const warnings: string[] = []
  const column = managerColumn(grid)
  if (column === null) {
    /*
     * Named as a tab problem rather than a board problem, because that is what it is -- and the board
     * carries on regardless. The message says which tab so the fix is obvious from the wall.
     */
    warnings.push('TEAMS: no column of manager names found; team tooltips are off.')
    return { teams: {}, warnings }
  }

  const names = teamColumn(grid, column)
  if (names === null) {
    warnings.push('TEAMS: found manager names but no team names beside them; team tooltips are off.')
    return { teams: {}, warnings }
  }

  const teams: Record<string, string> = {}
  for (const row of grid) {
    const manager = readManagerName(row[column] ?? '')
    if (manager === null) continue

    /* One column for every row, so a tooltip cannot come from a different place on different rows. */
    const team = (row[names] ?? '').trim()
    if (team === '') continue

    /*
     * First one wins, and a disagreement is reported. A manager listed twice with two different teams is
     * a spreadsheet someone is mid-edit on; silently taking the last would make the tooltip depend on row
     * order, which nobody would think to check.
     */
    const existing = teams[manager]
    if (existing !== undefined && existing !== team) {
      warnings.push(`TEAMS: ${manager} is listed as both "${existing}" and "${team}"; using the first.`)
      continue
    }
    teams[manager] = team
  }

  return { teams, warnings }
}
