/**
 * Live type-scale control (docs/DESIGN.md section 7.1).
 *
 * Every size in 7.1 is arithmetic. The real room, the real throw distance and the
 * real bulb decide what is actually readable, and that can only be found out on
 * site -- which is why this is not a nice-to-have. The phase-3 legibility spike
 * exists to use it.
 *
 * `+` / `-` nudge the scale, `0` resets, and `?scale=1.15` pins it so the tuned
 * value survives the reload that the projector browser will inevitably get.
 */

import { useEffect, useState } from 'react'

const MIN = 0.6
const MAX = 2
const STEP = 0.05
const STORAGE_KEY = 'zwml:scale'

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX, Math.max(MIN, Math.round(value / STEP) * STEP))
}

/** Reads `?scale=`, then `localStorage`. Query wins so a URL can force a value. */
export function readInitialScale(search: string, stored: string | null): number {
  const fromQuery = new URLSearchParams(search.replace(/^\?/, '')).get('scale')
  const candidate = fromQuery ?? stored
  if (candidate === null) return 1
  const parsed = Number.parseFloat(candidate)
  return Number.isNaN(parsed) ? 1 : clampScale(parsed)
}

export function useDisplayScale(): { scale: number; nudged: boolean } {
  const [scale, setScale] = useState(() => {
    if (typeof window === 'undefined') return 1
    try {
      return readInitialScale(window.location.search, window.localStorage.getItem(STORAGE_KEY))
    } catch {
      return readInitialScale(window.location.search, null)
    }
  })
  const [nudged, setNudged] = useState(false)

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale))
    try {
      window.localStorage.setItem(STORAGE_KEY, String(scale))
    } catch {
      // Private mode. The scale still applies for this session.
    }
  }, [scale])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // `=` is the unshifted `+` key, which is what someone actually presses.
      if (event.key === '+' || event.key === '=') {
        setScale((s) => clampScale(s + STEP))
      } else if (event.key === '-' || event.key === '_') {
        setScale((s) => clampScale(s - STEP))
      } else if (event.key === '0') {
        setScale(1)
      } else {
        return
      }
      setNudged(true)
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { scale, nudged }
}
