/**
 * Confirmation for `X`, the re-baseline key (docs/DESIGN.md 7.9).
 *
 * `X` throws away the sale log and the operator's pointer correction and re-baselines from the next poll.
 * That is the right recovery when the ticker or the rotation has gone wrong in a way no number of nudges
 * will fix -- and it is a single unshifted keystroke next to `Z` and `C`, with no undo, on a machine sitting
 * in a room full of people. Hitting it by accident mid-draft costs the night's ticker and puts the rotation
 * back to the top of the order.
 *
 * ANYTHING OTHER THAN `Y` CANCELS, which is the whole design. Not "Y confirms and N cancels and other keys
 * do nothing" -- if the operator is reaching for a key at all, the safe reading of that is that they did not
 * mean to re-baseline. It also means the dialog can never get stuck: whatever they press next, it goes away.
 */

import { useEffect, useState } from 'react'

export interface ConfirmResetProps {
  /** Called only on `Y`. Absent on the fixture path, where the dialog exists to be measured. */
  onConfirm?: () => void
  /** `?confirmReset=1`, fixture-only, so the layout gate can measure the card without a keypress. */
  pinned?: boolean
}

export function ConfirmReset({ onConfirm, pinned = false }: ConfirmResetProps) {
  const [asking, setAsking] = useState(false)

  /* Opening. Deliberately separate from the answering listener below, so `X` cannot answer its own prompt. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'x' && event.key !== 'X') return
      event.preventDefault()
      setAsking(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!asking) return
    const onKey = (event: KeyboardEvent) => {
      /*
       * `X` again is treated as another request rather than as an answer, so a double tap does not confirm.
       * Everything else closes, and only `Y` acts.
       */
      if (event.key === 'x' || event.key === 'X') return
      event.preventDefault()
      setAsking(false)
      if (event.key === 'y' || event.key === 'Y') onConfirm?.()
    }
    /*
     * Capture, so this runs before the view and scale handlers bound on window. Without it, cancelling with
     * `r` would also toggle the roster -- an accidental `X` would leave the operator on a different screen.
     */
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [asking, onConfirm])

  if (!asking && !pinned) return null

  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm re-baseline">
      <div className="confirm-card">
        <div className="confirm-label">RE-BASELINE THE DRAFT?</div>
        <div className="confirm-body">
          This clears the sales ticker and the nomination correction, then re-reads the sheet from scratch.
          The money is not affected.
        </div>
        <div className="confirm-keys">
          <b>Y</b> to re-baseline · any other key cancels
        </div>
      </div>
    </div>
  )
}
