/**
 * `tools/measure.mjs` parses.
 *
 * A trivial-looking test that has already earned its place four times over. The whole probe body of that
 * file is a TEMPLATE LITERAL evaluated in the browser, so a single backtick typed into one of its comments
 * ends the string and Node parses the remainder as code. The symptom is `measure.mjs exited 1` from the
 * layout gate -- four minutes into a run, long after the unit suite said everything was fine.
 *
 * `node --check` is the whole check. It costs milliseconds and moves that failure from the end of the
 * slowest command in the project to the start of the fastest one.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

describe('the layout harness', () => {
  it('is syntactically valid JavaScript', async () => {
    await expect(run(process.execPath, ['--check', 'tools/measure.mjs'])).resolves.toBeDefined()
  })

  it('has a syntactically valid runner too', async () => {
    await expect(run(process.execPath, ['--check', 'tools/verify-layout.mjs'])).resolves.toBeDefined()
  })
})
