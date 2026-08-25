/**
 * First-run setup: where is the sheet? (docs/DESIGN.md sections 8, 9.1)
 *
 * The spreadsheet id is deliberately not in the repository, so a checkout with no
 * `VITE_SHEET_ID_B64` secret has nothing to fetch. That is the intended state, not a
 * broken one, and this is what it looks like: a paste field, and one sentence about the
 * sharing setting -- which is the other thing that has to be true before anything works.
 *
 * Note what this does NOT do: persist the id. A well-formed typo pasted here would then
 * resolve from storage on the next load, suppressing this very card, and the only way
 * back would be devtools on the machine driving the projector (9.1). Accepting a paste
 * puts it in the URL fragment instead, and `confirmSheetId` persists it only once a
 * fetch has proved it works.
 */

import { useState } from 'react'
import { extractSheetId } from '../config/sheetLocation'

export interface SetupProps {
  year: number
  /** Given a validated spreadsheet id. The caller decides how to start. */
  onAccept: (id: string) => void
}

export function Setup({ year, onAccept }: SetupProps) {
  const [value, setValue] = useState('')
  const [rejected, setRejected] = useState(false)

  return (
    <div className="standby standby-setup" data-problem="setup">
      <h1>ZWML {year} AUCTION</h1>
      <p className="standby-message">Paste the Google Sheets link.</p>

      <form
        className="setup-form"
        onSubmit={(event) => {
          event.preventDefault()
          const id = extractSheetId(value)
          if (id === null) {
            // The field keeps its contents: whatever was pasted is the only copy, and
            // it is usually a link with one character wrong.
            setRejected(true)
            return
          }
          setRejected(false)
          onAccept(id)
        }}
      >
        <input
          className="setup-input"
          type="text"
          autoFocus
          spellCheck={false}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setRejected(false)
          }}
        />
        <button className="setup-button" type="submit">
          START
        </button>
      </form>

      {rejected && <p className="standby-action setup-error">That is not a Google Sheets link.</p>}
      <p className="standby-action">
        The workbook must be shared: Share → General access → Anyone with the link → Viewer.
      </p>
    </div>
  )
}
