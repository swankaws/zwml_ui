/**
 * The in-draft moments, full screen (docs/DESIGN.md 7.3).
 *
 * Three of them: the first kicker sold, a player going for real money, and a manager finishing their
 * roster. The trigger lives in `model/moments.ts` and is tested there; this file is only presentation and
 * dismissal.
 *
 * DISMISSAL IS THE PART THAT MATTERS, because this thing covers the board. Three ways out, and all three
 * are load-bearing:
 *
 *   1. A timer per kind. `rosterFull` holds longest because the room stops to congratulate somebody;
 *      the other two are seconds, because they land mid-flow.
 *   2. Any key or any tap. Deliberately WITHOUT `preventDefault`, so every existing shortcut still works
 *      through the overlay -- the operator does not have to know it is there.
 *   3. Supersede. The store replaces `moment` on every poll that produces sales, so a newer sale hides
 *      this immediately and it can never sit over the next nomination.
 *
 * And a fourth for the night itself: `eggs off` in the SETTINGS tab, or `?eggs=off`, which turns the whole
 * feature off from a phone with no deploy and no CDN wait.
 *
 * No new key binding. `? R H N ⇧N X T G + - 0 Esc` are all taken, and adding a row to `Help` would mean
 * editing the four gate cases that pin `helpRows === 10`.
 */

import { useEffect, useRef, useState } from 'react'
import { MOMENT_HOLD_MS, type Moment, type MomentKind } from '../model/moments'
import { money } from './columns'

/**
 * Five of them, so a manager finishing does not always get the same clip.
 *
 * Under `base: './'` these must be root-relative-free -- a leading slash would break a board served from
 * a subpath, which GitHub Pages does (`/zwml_ui/`). Vite copies `public/` to the bundle root, so a bare
 * relative name resolves against the document.
 */
const DONE_GIFS = ['done_1.gif', 'done_2.gif', 'done_3.gif', 'done_4.gif', 'done_5.gif'] as const
const MONEY_GIFS = ['money.gif', 'money_2.gif', 'money_3.gif'] as const
const PUNT_GIFS = ['punting.gif'] as const
const ALL_GIFS = [...PUNT_GIFS, ...MONEY_GIFS, ...DONE_GIFS]

/**
 * Which clip this moment gets. Deterministic on a name rather than `Math.random()`.
 *
 * Nobody in the room can predict it, the same name always gets the same clip, and it is testable -- three
 * properties a random pick would cost. Seeded on the MANAGER for a finished roster (each manager gets
 * their own, and finishes only once) and on the PLAYER for a record sale (each record-breaker gets their
 * own, and there are about six of those in an evening).
 */
export function gifFrom(choices: readonly string[], seed: string): string {
  let sum = 0
  for (let index = 0; index < seed.length; index += 1) sum += seed.charCodeAt(index)
  return choices[sum % choices.length] as string
}

function gifFor(moment: Moment): string {
  switch (moment.kind) {
    case 'firstKicker':
    case 'extraKicker':
      return gifFrom(PUNT_GIFS, moment.sale.player)
    case 'rosterFull':
      return gifFrom(DONE_GIFS, moment.sale.manager)
    case 'bigSpender':
      return gifFrom(MONEY_GIFS, moment.sale.player)
  }
}

/**
 * The copy, in parts rather than one sentence.
 *
 * Split so the who and the money can be sized and coloured separately: the maintainer's note was that the
 * names were too small to read from the room and the price deserved the accent. A single interpolated
 * string could not do either without markup in the middle of it.
 */
function lines(moment: Moment): { label: string; headline: string; who: string; price: string } {
  const { player, manager, price } = moment.sale
  const money$ = money(price)
  switch (moment.kind) {
    case 'firstKicker':
      return {
        label: 'FIRST KICKER OFF THE BOARD',
        headline: 'A KICKER. REALLY.',
        who: `${manager} — ${player}`,
        price: money$,
      }
    case 'extraKicker':
      return {
        label: 'MORE THAN ONE KICKER',
        /*
         * The count is on the moment rather than worked out here. It also has to be a number rather than
         * the word "two": a third kicker is funnier than the second and the headline should say so.
         */
        headline: `${moment.count ?? 2} KICKERS?!`,
        who: `${manager} — ${player}`,
        price: money$,
      }
    case 'bigSpender':
      return {
        // The label says WHY this one fired -- it is a record, not merely an expensive player.
        label: 'NEW HIGHEST SALE',
        headline: 'BIG SPENDER!!!',
        who: `${manager} — ${player}`,
        price: money$,
      }
    case 'rosterFull':
      return {
        label: 'ROSTER FULL',
        headline: `${manager.toUpperCase()} IS DONE`,
        who: `last slot: ${player}`,
        price: money$,
      }
  }
}

/** A stand-in moment for `?moment=`, so the layout gate can measure a screen no fixture produces. */
function demoMoment(kind: MomentKind): Moment {
  const sale = {
    slot: '1:9',
    seq: 1,
    player: kind === 'firstKicker' ? 'Harrison Butker' : 'Justin Jefferson',
    price: kind === 'firstKicker' ? 1 : 72,
    manager: 'Kevin',
    position: kind === 'firstKicker' ? ('K' as const) : ('WR' as const),
  }
  return { kind, sale }
}

export interface MomentOverlayProps {
  /** The live moment, by reference. A new object means a new moment; `null` clears it. */
  moment: Moment | null
  /**
   * `?moment=kicker|spender|done`, fixture-only. Pins the overlay open with no timer and no key out,
   * which is what makes it measurable -- and why `pinnedMomentKind` refuses without a fixture.
   */
  pinned?: MomentKind | null
  /** `eggs off`. */
  enabled?: boolean
}

export function MomentOverlay({ moment, pinned = null, enabled = true }: MomentOverlayProps) {
  const [shown, setShown] = useState<Moment | null>(null)
  /** The last moment we opened for, so the same one is not reopened after it is dismissed. */
  const opened = useRef<Moment | null>(null)

  useEffect(() => {
    if (moment === null) {
      // Superseded by a sale that earned nothing, or cleared by `X`.
      opened.current = null
      setShown(null)
      return
    }
    if (moment !== opened.current) {
      opened.current = moment
      setShown(moment)
    }
  }, [moment])

  /*
   * Preloaded after mount rather than in markup, so 11MB of gif never competes with the first poll. The
   * board is the thing that has to be on screen at 7pm; nobody fills a roster inside the first hour.
   */
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      for (const name of ALL_GIFS) {
        const image = new Image()
        image.src = name
      }
    }, 2_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enabled])

  const active = pinned !== null ? demoMoment(pinned) : shown

  useEffect(() => {
    if (active === null || pinned !== null) return
    const timer = window.setTimeout(() => setShown(null), MOMENT_HOLD_MS[active.kind])
    return () => window.clearTimeout(timer)
  }, [active, pinned])

  useEffect(() => {
    if (active === null || pinned !== null) return
    // No `preventDefault`: every existing shortcut must still fire through the overlay.
    const dismiss = () => setShown(null)
    window.addEventListener('keydown', dismiss)
    window.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [active, pinned])

  if (!enabled || active === null) return null

  const gif = gifFor(active)
  const copy = lines(active)

  return (
    <div className="moment" data-kind={active.kind} role="presentation">
      <div className="moment-card">
        <div className="moment-label">{copy.label}</div>
        <div className="moment-headline">{copy.headline}</div>
        {/*
          * `alt` empty and `role="presentation"` above: the clip is the joke, not information. Everything
          * it conveys is in the type beside it, which is also what shows if the file never loads.
          */}
        <img className="moment-gif" src={gif} alt="" />
        <div className="moment-detail">
          <span className="moment-who">{copy.who}</span>
          <span className="moment-price">{copy.price}</span>
        </div>
      </div>
    </div>
  )
}
