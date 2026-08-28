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

import { useEffect, useState } from 'react'
import {
  HOARDER_OVER,
  MOMENT_HOLD_MS,
  NAMED_PLAYERS,
  namedPlayerFor,
  type Moment,
  type MomentKind,
} from '../model/moments'
import { PLAYER_TAGS } from '../model/playerTags'
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
const BROKE_GIFS = ['broke_1.gif'] as const
const HOARDER_GIFS = ['hoarder_1.gif'] as const
/*
 * Every clip the tag TABLE knows about, so the preload picks them up for free -- the overlay does not need
 * to hard-code any of them. `PLAYER_TAGS` lives in `playerTags.ts`.
 */
const TAG_GIFS = PLAYER_TAGS.flatMap((entry) => entry.clips)

/** The banner over every tag moment. Says a judgement was recorded, without naming the marker. */
const TAG_LABEL = 'FOR THE RECORD'
/* Taken from the table, so a new named player needs no edit here. */
const NAMED_GIFS = NAMED_PLAYERS.map((entry) => entry.clip)
const PUNT_GIFS = ['punting.gif'] as const
const ALL_GIFS = [
  ...PUNT_GIFS,
  ...MONEY_GIFS,
  ...BROKE_GIFS,
  ...HOARDER_GIFS,
  ...NAMED_GIFS,
  ...TAG_GIFS,
  ...DONE_GIFS,
]

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

function choicesFor(moment: Moment): readonly string[] {
  switch (moment.kind) {
    case 'firstKicker':
    case 'extraKicker':
      return PUNT_GIFS
    case 'rosterFull':
      return DONE_GIFS
    case 'firstBroke':
      return BROKE_GIFS
    case 'hoarder':
      return HOARDER_GIFS
    case 'namedPlayer':
      return NAMED_GIFS
    /*
     * Restricted to the fired tag's own clips, so a `(h)` sale draws from the homer clips and never from the
     * dick_move ones. The `?clip=` override still applies through the shared code path below.
     */
    case 'playerTag':
      return moment.tag?.clips ?? []
    case 'bigSpender':
      return MONEY_GIFS
  }
}

function gifFor(moment: Moment, clip: number | null): string {
  /*
   * A named player's clip is not a choice -- it belongs to that player, so it comes straight off the table
   * rather than through the name-seeded picker. A pinned `?clip=` preview still overrides, below.
   */
  if (moment.kind === 'namedPlayer' && clip === null) {
    const entry = namedPlayerFor(moment.sale.player)
    if (entry !== null) return entry.clip
  }
  const choices = choicesFor(moment)
  /* A pinned preview may ask for one by number; wraps, because `?clip=9` should show something. */
  if (clip !== null) return choices[(clip - 1) % choices.length] as string
  /* Seeded on the manager for a finished roster, on the player otherwise -- see `gifFrom`. */
  return gifFrom(choices, moment.kind === 'rosterFull' ? moment.sale.manager : moment.sale.player)
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
        /* DRAFTED, not 'off the board': a kept kicker was already on the board and was not drafted. */
        label: 'FIRST KICKER DRAFTED',
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
    case 'hoarder':
      return {
        /* The position is on the sale, so the accusation names what they are stockpiling. */
        label: `${moment.count ?? HOARDER_OVER + 1} ${moment.sale.position ?? ''}`.trim().toUpperCase(),
        headline: 'HOARDER!',
        who: `${manager} — ${player}`,
        price: money$,
      }
    case 'firstBroke':
      return {
        label: 'FIRST DOWN TO $1 BIDS',
        headline: 'TAPPED OUT',
        who: `${manager} — ${player}`,
        price: money$,
      }
    case 'namedPlayer':
      return {
        label: player.toUpperCase(),
        /* The headline is the table's, so the joke and the clip cannot drift apart. */
        headline: namedPlayerFor(player)?.headline ?? player,
        who: manager,
        price: money$,
      }
    case 'playerTag':
      return {
        /*
         * ONE shared banner for every tag, and never the letter itself.
         *
         * `TAG (h)` leaked the mechanism: the marker is the recorder's private mark on the sheet, and the
         * room should see the joke, not the plumbing that fired it. And the banner is shared rather than
         * per-tag so the family reads consistently by construction -- a per-tag banner is one more string
         * to keep in step every time a marker is added.
         */
        label: TAG_LABEL,
        headline: moment.tag?.headline ?? 'TAGGED',
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
  const firstTag = PLAYER_TAGS[0]
  const sale = {
    slot: '1:9',
    seq: 1,
    player:
      kind === 'firstKicker' || kind === 'extraKicker'
        ? 'Harrison Butker'
        : kind === 'namedPlayer'
        ? (NAMED_PLAYERS[0]?.player ?? 'Travis Kelce')
        : 'Justin Jefferson',
    price: kind === 'firstKicker' ? 1 : 72,
    manager: 'Kevin',
    position: kind === 'firstKicker' ? ('K' as const) : ('WR' as const),
    tags: kind === 'playerTag' && firstTag ? [firstTag.tag] : [],
  }
  return kind === 'playerTag' && firstTag ? { kind, sale, tag: firstTag } : { kind, sale }
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
  /**
   * `?clip=N`, 1-based, for a pinned preview only. Ignored for a real moment, whose clip is chosen from
   * the player's or manager's name so it is both varied across a night and reproducible.
   */
  clip?: number | null
}

/**
 * Moments this page has already shown, by object identity. MODULE SCOPE, not a ref, and not by accident.
 *
 * `App` renders inside `ErrorBoundary`, which grants three recoveries, and a recovery REMOUNTS it -- so a
 * ref resets to null and the overlay replays whatever moment is still sitting in the snapshot. That is not
 * theoretical: a 4.5-hour endurance run against the deployed board caught a `bigSpender` lingering in the
 * snapshot for FORTY-SEVEN MINUTES, which is correct (the supersede rule only fires on a poll that produces
 * sales, and there were none) but would have meant a render crash replaying a 47-minute-old celebration.
 *
 * A `WeakSet`, so holding these costs nothing over a four-hour session -- the entries disappear with the
 * moment objects themselves. There is one board per page, which is the honest scope for "already shown".
 */
const alreadyShown = new WeakSet<Moment>()

export function MomentOverlay({ moment, pinned = null, enabled = true, clip = null }: MomentOverlayProps) {
  const [shown, setShown] = useState<Moment | null>(null)

  useEffect(() => {
    if (moment === null) {
      // Superseded by a sale that earned nothing, or cleared by `X`.
      setShown(null)
      return
    }
    if (!alreadyShown.has(moment)) {
      alreadyShown.add(moment)
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

  const gif = gifFor(active, pinned !== null ? clip : null)
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
