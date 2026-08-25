/**
 * Minimal but correct RFC 4180 CSV parser.
 *
 * Splitting on newlines is NOT good enough here. Cell A16 of the live auction
 * tab contains a quoted cell with an embedded newline, so a line-splitting
 * parser desynchronizes from that row onward -- every band-1 bench row, DEF,
 * Total, and Remaining anchor lands one row off, and the result still "parses".
 * That is the exact class of silent corruption this app must not ship.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, escaped quotes
 * (`""`), and CRLF or LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  // A trailing newline should not produce a spurious empty final row.
  const src = text.endsWith('\n') ? text.slice(0, -1) : text

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < src.length) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      quoted = true
      i++
    } else if (ch === ',') {
      endField()
      i++
    } else if (ch === '\r') {
      // Consume CRLF or a bare CR as one line ending.
      endRow()
      i += src[i + 1] === '\n' ? 2 : 1
    } else if (ch === '\n') {
      endRow()
      i++
    } else {
      field += ch
      i++
    }
  }

  // Flush the last row, which has no trailing newline.
  endRow()
  return rows
}

/** Safe cell read. Out-of-range coordinates return '' rather than throwing. */
export function cell(rows: string[][], r: number, c: number): string {
  return rows[r]?.[c]?.trim() ?? ''
}
