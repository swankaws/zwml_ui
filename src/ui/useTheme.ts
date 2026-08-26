/**
 * Dark or light (docs/DESIGN.md 7.7).
 *
 * §7.7 argues for dark, and the argument is sound: a projector bulb washes out dark-on-white and a
 * bright rectangle four hours long is unpleasant to sit under. But it is a PREDICTION, made on a
 * laptop, about a projector nobody has seen -- and the one thing this project has learned repeatedly
 * is that predictions about that projector need an escape hatch. A dim bulb, a washed-out lamp, or a
 * room with the lights on can all make light-on-dark the harder read, and discovering that at 7pm
 * with no way to change it would be the expensive version of being wrong.
 *
 * So it follows the same four-source shape as `scale` (9.2), most immediate first:
 *
 *   `T` key         the operator, in the room, looking at the wall
 *   `?theme=light`  a URL, needing no sheet and no network
 *   SETTINGS tab    durable, phone-editable, shared with everyone watching
 *   dark            the default, and what every measurement was taken against
 *
 * The operator's choice is remembered in `localStorage`, and -- exactly as `useDisplayScale`
 * learned the hard way -- only ever WRITTEN when a key is actually pressed. Persisting on every
 * render would permanently shadow the SETTINGS tab, which looks precisely like "editing the sheet
 * does nothing".
 */

import { useEffect, useRef, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'zwml:theme'

export function themeFromQuery(search: string): Theme | null {
  const raw = new URLSearchParams(search.replace(/^\?/, '')).get('theme')
  return raw === 'light' || raw === 'dark' ? raw : null
}

/** Query, then the operator's stored choice, then the sheet, then dark. */
export function readInitialTheme(
  search: string,
  stored: string | null,
  sheetTheme: Theme | null = null,
): Theme {
  const candidate = themeFromQuery(search) ?? stored ?? sheetTheme
  return candidate === 'light' ? 'light' : 'dark'
}

export interface ThemeControl {
  theme: Theme
  /** For the on-screen button, which is the only route on a device with no keyboard. */
  toggle: () => void
}

export function useTheme(sheetTheme: Theme | null = null): ThemeControl {
  const search = typeof window === 'undefined' ? '' : window.location.search
  const pinned = themeFromQuery(search) !== null

  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      return readInitialTheme(search, window.localStorage.getItem(STORAGE_KEY), sheetTheme)
    } catch {
      return readInitialTheme(search, null, sheetTheme)
    }
  })
  // Ref as well as state, so the key handler is not re-bound on every toggle.
  const chosen = useRef(false)

  /*
   * On the root element rather than in React, because the palette has to cover things React does
   * not render into: `body`'s background, and the area outside `.app`'s padding. A projector shows
   * that margin, and a dark strip around a light board would look like a fault.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /*
   * The SETTINGS tab arrives after the first render, so following it here is what makes a sheet
   * edit visible without a reload -- and skipping that once the operator has chosen, or the URL has
   * pinned it, is what stops the sheet yanking the wall out from under them mid-auction.
   */
  useEffect(() => {
    if (sheetTheme === null || pinned || chosen.current) return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(STORAGE_KEY)
    } catch {
      // Private mode; treat as no stored choice.
    }
    if (stored !== null) return
    setTheme(sheetTheme)
  }, [sheetTheme, pinned])

  const choose = (next: Theme) => {
    chosen.current = true
    setTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Quota or private mode. The choice still applies for this session.
    }
  }

  useEffect(() => {
    if (pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== 't' && event.key !== 'T') return
      choose(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinned])

  return {
    theme,
    toggle: () => choose(theme === 'light' ? 'dark' : 'light'),
  }
}
