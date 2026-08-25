import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The spreadsheet id must not live in this repository (docs/DESIGN.md section 9.1).
 * That is a policy, and a policy without a test is a wish -- it would quietly
 * die the first time someone hardcodes the id "just to debug something".
 *
 * This scans every git-tracked file rather than a list of usual suspects,
 * because the whole point is to catch the file nobody thought of.
 */

/** Ids used in tests and docs. Fictional; safe to appear in the tree. */
const ALLOWED_PLACEHOLDERS = new Set([
  '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x',
  '2ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-y',
])

/** A spreadsheet id sitting in a Google Sheets URL. */
const IN_URL = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,64})/g

/** A long key literal assigned to something that names a sheet id. */
const IN_ASSIGNMENT =
  /(?:sheet[_-]?id|spreadsheet[_-]?id|SHEET_ID)\s*[:=]\s*['"`]([A-Za-z0-9_-]{20,64})['"`]/gi

const SKIP_DIRS = ['node_modules/', 'dist/']
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Tracked files *and* untracked-but-not-ignored ones, so a fresh file is caught
 * before it is ever committed rather than after.
 */
function trackedFiles(): string[] | null {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8' },
    )
    return [...new Set(out.split('\0').filter(Boolean))]
  } catch {
    return null // not a git checkout; nothing to assert about
  }
}

const files = trackedFiles()

describe('no committed spreadsheet id', () => {
  it.skipIf(files === null)('every tracked file is clean', () => {
    const offenders: string[] = []

    for (const file of files ?? []) {
      if (SKIP_DIRS.some((dir) => file.startsWith(dir))) continue
      let text: string
      try {
        if (statSync(file).size > MAX_BYTES) continue
        text = readFileSync(file, 'utf8')
      } catch {
        continue // deleted, binary, or unreadable -- not our concern
      }

      for (const pattern of [IN_URL, IN_ASSIGNMENT]) {
        pattern.lastIndex = 0
        for (const match of text.matchAll(pattern)) {
          const id = match[1]
          if (!id || ALLOWED_PLACEHOLDERS.has(id)) continue
          const line = text.slice(0, match.index).split('\n').length
          offenders.push(`${file}:${line} -> ${id}`)
        }
      }
    }

    expect(
      offenders,
      'A spreadsheet id is committed. Resolve it at runtime via config/sheetLocation.ts instead ' +
        '(docs/DESIGN.md section 9.1). If this is a placeholder, add it to ALLOWED_PLACEHOLDERS.',
    ).toEqual([])
  })

  it.skipIf(files === null)('no .env file but the example is tracked', () => {
    const tracked = (files ?? []).filter((f) => /(^|\/)\.env($|\.)/.test(f))
    expect(tracked.filter((f) => f !== '.env.example')).toEqual([])
  })
})
