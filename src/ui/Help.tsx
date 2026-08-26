/**
 * The keyboard reference (docs/DESIGN.md 7.9).
 *
 * Eight keys are bound and none of them is labelled anywhere on the wall, which is fine right up
 * until the one night it is not: draft night is unrepeatable, the operator may not be the person
 * who built this, and the keys that matter most are the recovery ones -- `N` when the wall names
 * the wrong nominator, `X` when the ticker has gone wrong. A shortcut nobody can find is a
 * shortcut that does not exist.
 *
 * It is an overlay, and that is the one place in this app where covering the board is correct:
 * it exists only while somebody is holding the keyboard and asking for it. Contrast the notices
 * strip, which had to move INTO the flow precisely because it could appear unbidden (see the
 * header of `Notices.tsx`).
 *
 * It lists only keys that actually work. 7.9 also specifies `F` for fullscreen and `S` to cycle
 * sort, and neither is built -- a help screen that names them would be worse than no help screen,
 * because the operator would press them during the auction and conclude the board was broken.
 */

export interface HelpProps {
  open: boolean
  /** Tapping the backdrop closes it, since a phone has no `Esc`. */
  onClose?: () => void
}

interface Shortcut {
  keys: string
  what: string
  /** Shown smaller, for the ones whose behaviour would otherwise surprise someone. */
  note?: string
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: '?', what: 'This list', note: 'or H · Esc, or tap outside, to close' },
  { keys: 'R', what: 'Roster view', note: 'every squad; returns here by itself after 45s' },
  { keys: 'N', what: 'Nominator forward', note: 'sticks for the rest of the night' },
  { keys: '⇧N', what: 'Nominator back' },
  { keys: 'X', what: 'Reset ticker and nominator', note: 're-reads the sheet as the new baseline' },
  { keys: '+ −', what: 'Type bigger / smaller' },
  { keys: '0', what: 'Forget the type change', note: 'hands the size back to the SETTINGS tab' },
  { keys: 'G', what: 'Read the sheet now', note: 'it polls every 3s anyway' },
]

export function Help({ open, onClose }: HelpProps) {
  if (!open) return null

  return (
    <div className="help" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      {/* Stops a tap inside the card from closing it while still letting the backdrop do so. */}
      <div className="help-card" onClick={(event) => event.stopPropagation()}>
        <h2>KEYBOARD</h2>
        <dl className="help-list">
          {SHORTCUTS.map((shortcut) => (
            <div className="help-row" key={shortcut.keys}>
              <dt>
                <kbd>{shortcut.keys}</kbd>
              </dt>
              <dd>
                {shortcut.what}
                {shortcut.note && <span className="help-note">{shortcut.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {/*
         * Said plainly, and said here because this is where the operator is already looking.
         *
         * The board works out who is on the clock from the sales it has watched, and there are real
         * ways for it to be off: an order that is not the league's actual rotation, a pick typed out
         * of sequence, or a reload that absorbed one. When the screen and the room disagree, the
         * room is right -- so the fix has to be one key, and the operator has to know it exists.
         */}
        <p className="help-foot">
          Wrong name on the clock? Press <kbd>N</kbd> until it is right. The correction sticks for
          the rest of the draft.
        </p>
        {/* A phone reaches this overlay by tapping `?`, so it needs to know keys are not the only way. */}
        <p className="help-foot help-touch">On a phone, use the buttons in the header.</p>
      </div>
    </div>
  )
}
