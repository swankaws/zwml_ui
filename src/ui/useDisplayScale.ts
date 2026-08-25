/**
 * Live type-scale control (docs/DESIGN.md section 7.1).
 *
 * Every size in 7.1 is arithmetic. The real room, the real throw distance and the
 * real bulb decide what is actually readable, and that can only be found out on
 * site -- which is why this is not a nice-to-have. The phase-3 legibility spike
 * exists to use it.
 *
 * Four sources, most immediate first:
 *
 *   `+` / `-` keys   the operator, in the room, looking at the wall
 *   `?scale=1.15`    a URL, which needs no sheet and no network
 *   SETTINGS tab     durable, phone-editable, shared (7.5, 9)
 *   1                the default
 *
 * `0` clears the operator's nudge and hands control back to the sheet.
 *
 * Read the ceiling before reaching for any of them: at 1080p with twelve rows the
 * type is bound by ROW HEIGHT, so above ~1.15 the glyphs clip rather than grow.
 * Measured -- see the table in 7.1.
 */

import { useEffect, useRef, useState } from 'react'

const MIN = 0.6
const MAX = 2
const STEP = 0.05
const STORAGE_KEY = 'zwml:scale'

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  const stepped = Math.round(value / STEP) * STEP
  /*
   * Second rounding because the first one is not exact in binary: 1.15 comes back
   * as 1.1500000000000001, which then goes into localStorage and the --scale
   * custom property in that form. Exact at two decimals for a 0.05 step.
   */
  const clean = Math.round(stepped * 100) / 100
  return Math.min(MAX, Math.max(MIN, clean))
}

/**
 * Query, then the operator's stored nudge, then the sheet, then 1.
 *
 * The stored value sits *above* the sheet but is only ever written when someone
 * actually presses a key (see below). That distinction is the whole reason this is
 * a separate function: an earlier version persisted the scale on every render, so
 * `localStorage` always held a value and permanently shadowed the SETTINGS tab --
 * which would have looked exactly like "editing the sheet does nothing", at 7pm,
 * on the one night it matters.
 */
export function readInitialScale(
  search: string,
  stored: string | null,
  sheetScale: number | null = null,
): number {
  const fromQuery = new URLSearchParams(search.replace(/^\?/, '')).get('scale')
  const candidate = fromQuery ?? stored ?? (sheetScale === null ? null : String(sheetScale))
  if (candidate === null) return 1
  const parsed = Number.parseFloat(candidate)
  return Number.isNaN(parsed) ? 1 : clampScale(parsed)
}

/** True when `?scale=` pins the value, in which case nothing else may move it. */
export function scalePinnedByQuery(search: string): boolean {
  return new URLSearchParams(search.replace(/^\?/, '')).get('scale') !== null
}

export function useDisplayScale(sheetScale: number | null = null): {
  scale: number
  nudged: boolean
} {
  const search = typeof window === 'undefined' ? '' : window.location.search
  const pinned = scalePinnedByQuery(search)

  const [scale, setScale] = useState(() => {
    if (typeof window === 'undefined') return 1
    try {
      return readInitialScale(search, window.localStorage.getItem(STORAGE_KEY), sheetScale)
    } catch {
      return readInitialScale(search, null, sheetScale)
    }
  })
  const [nudged, setNudged] = useState(false)
  // Ref, not state: the keydown handler must not be re-bound every nudge.
  const nudgedRef = useRef(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale))
  }, [scale])

  /*
   * Phase 4 fetches the SETTINGS tab, so its scale arrives *after* the first
   * render. Following it here is what makes a sheet edit visible without a reload
   * -- and skipping it when the operator has nudged or the URL has pinned the
   * value is what stops the sheet from yanking the wall out from under them.
   */
  useEffect(() => {
    if (sheetScale === null || pinned || nudgedRef.current) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      // Private mode; treat as no stored nudge.
    }
    if (stored !== null) return
    setScale(clampScale(sheetScale))
  }, [sheetScale, pinned])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const persist = (value: number) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(value))
        } catch {
          // Private mode. The scale still applies for this session.
        }
      }

      // `=` is the unshifted `+` key, which is what someone actually presses.
      if (event.key === '+' || event.key === '=') {
        setScale((s) => {
          const next = clampScale(s + STEP)
          persist(next)
          return next
        })
      } else if (event.key === '-' || event.key === '_') {
        setScale((s) => {
          const next = clampScale(s - STEP)
          persist(next)
          return next
        })
      } else if (event.key === '0') {
        /*
         * Reset means "forget that I touched it", not "set 1". Clearing the stored
         * nudge is what lets the SETTINGS tab take over again -- otherwise the only
         * way back to the sheet's value would be devtools, which is not a thing
         * anyone is doing in a room full of people mid-auction.
         */
        try {
          window.localStorage.removeItem(STORAGE_KEY)
        } catch {
          // Nothing was stored.
        }
        nudgedRef.current = false
        setNudged(false)
        setScale(sheetScale === null ? 1 : clampScale(sheetScale))
        event.preventDefault()
        return
      } else {
        return
      }
      nudgedRef.current = true
      setNudged(true)
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetScale])

  return { scale, nudged }
}
