/**
 * Where the spreadsheet lives.
 *
 * The spreadsheet id is deliberately NOT committed to this repository. See
 * docs/DESIGN.md section 9.1 for the threat model -- in short, this keeps the id out
 * of code search, clones, and git history. It does NOT make the sheet private;
 * only the sheet's own sharing setting does that.
 *
 * Resolution order, first hit wins:
 *
 *   1. `#sheet=` URL fragment   -- never sent to any server; the recommended form
 *   2. `?sheet=` query string   -- works, but lands in host access logs
 *   3. build-time default       -- base64 in `VITE_SHEET_ID_B64`, from a CI secret
 *   4. `localStorage`           -- remembered, only when there is no CI default
 *   5. nothing                  -- the app shows a setup screen (section 8)
 *
 * Storage ranks BELOW the build default deliberately. The CI secret is the
 * blessed configuration; `localStorage` is a leftover from whoever last used
 * this browser. If storage outranked it, an id pinned during a rehearsal would
 * silently override a corrected secret with nothing on screen to explain why,
 * and the fix would need DevTools on the machine driving the projector.
 *
 * An id is NOT persisted at resolve time -- only once a fetch has proved it
 * works, via `confirmSheetId()`. Otherwise a well-formed typo pasted into
 * `#sheet=` would stick permanently and suppress the setup card that is
 * supposed to let the operator correct it.
 */

const STORAGE_KEY = 'zwml:sheetId'

/**
 * Google's key alphabet. The length bound and the character class together are
 * what make an id safe to interpolate into a URL path: no `/`, `.`, `?`, `#`,
 * or `:` can survive, so a hostile `?sheet=` value cannot escape the
 * `/spreadsheets/d/<id>/export` path or point the fetch somewhere else.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/

/** Matches the id inside a full "docs.google.com/spreadsheets/d/<id>/edit" URL. */
const URL_PATTERN = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,64})/

export type SheetIdSource = 'fragment' | 'query' | 'storage' | 'build' | 'none'

export interface SheetLocation {
  id: string | null
  source: SheetIdSource
}

/**
 * Accepts either a bare spreadsheet id or a full Google Sheets URL pasted from
 * the browser bar, and returns the id -- or `null` if the input cannot be one.
 * Used both for the setup screen's paste field and for URL parameters.
 */
export function extractSheetId(input: string | null | undefined): string | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  const matched = URL_PATTERN.exec(raw)?.[1]
  const candidate = matched ?? raw
  return ID_PATTERN.test(candidate) ? candidate : null
}

/** CSV export URL for one tab. MUST be fetched with `redirect: 'follow'`. */
export function csvUrl(spreadsheetId: string, gid: string): string {
  if (!ID_PATTERN.test(spreadsheetId)) {
    throw new Error(`Refusing to build a URL from a malformed spreadsheet id`)
  }
  if (!/^[0-9]+$/.test(gid)) {
    throw new Error(`Refusing to build a URL from a malformed gid: ${gid}`)
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`
}

/**
 * Pure resolution over already-gathered candidates, so the precedence rules are
 * testable without a DOM. `resolveSheetId()` is the browser wrapper.
 */
export function pickSheetId(candidates: {
  fragment?: string | null
  query?: string | null
  stored?: string | null
  buildDefault?: string | null
}): SheetLocation {
  const ordered: [SheetIdSource, string | null | undefined][] = [
    ['fragment', candidates.fragment],
    ['query', candidates.query],
    ['build', candidates.buildDefault],
    ['storage', candidates.stored],
  ]

  for (const [source, value] of ordered) {
    const id = extractSheetId(value)
    if (id) return { id, source }
  }
  return { id: null, source: 'none' }
}

/** Decodes the build-time default. Absent by design in local checkouts. */
export function decodeBuildDefault(encoded: string | undefined): string | null {
  if (!encoded) return null
  try {
    return extractSheetId(atob(encoded.trim()))
  } catch {
    // Malformed base64 -- treat as absent rather than crashing the board.
    return null
  }
}

function readParam(search: string, key: string): string | null {
  return new URLSearchParams(search.replace(/^[#?]/, '')).get(key)
}

function safeStorage(): Storage | null {
  // Private-browsing and disabled-storage modes throw on access, not on use.
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function rememberSheetId(id: string): void {
  if (!ID_PATTERN.test(id)) return
  try {
    safeStorage()?.setItem(STORAGE_KEY, id)
  } catch {
    // Quota or private mode. The id still works for this session.
  }
}

export function forgetSheetId(): void {
  try {
    safeStorage()?.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
}

/**
 * Resolves the id in the browser. Deliberately does NOT persist and does NOT
 * touch the address bar -- see `confirmSheetId()`.
 */
export function resolveSheetId(): SheetLocation {
  if (typeof window === 'undefined') {
    return pickSheetId({ buildDefault: decodeBuildDefault(import.meta.env.VITE_SHEET_ID_B64) })
  }

  return pickSheetId({
    fragment: readParam(window.location.hash, 'sheet'),
    query: readParam(window.location.search, 'sheet'),
    stored: safeStorage()?.getItem(STORAGE_KEY),
    buildDefault: decodeBuildDefault(import.meta.env.VITE_SHEET_ID_B64),
  })
}

/**
 * Call once the FIRST fetch against `location` has succeeded. Only then is the
 * id worth remembering, and only then is it safe to drop it from the address bar
 * -- if the fetch had failed, the operator would still need the URL they typed.
 *
 * A build-time id is not stored: it arrives on every load anyway, and storing it
 * would make it outlive a corrected CI secret.
 */
export function confirmSheetId(location: SheetLocation): void {
  if (!location.id || location.source === 'build') return
  if (location.source === 'fragment' || location.source === 'query') {
    rememberSheetId(location.id)
    scrubUrl()
  }
}

/** Drops `sheet=` from both the query string and the fragment, in place. */
function scrubUrl(): void {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('sheet')

    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
    fragment.delete('sheet')
    const rest = fragment.toString()
    url.hash = rest ? `#${rest}` : ''

    window.history.replaceState(null, '', url.toString())
  } catch {
    // Non-fatal: the id is already resolved and stored.
  }
}
