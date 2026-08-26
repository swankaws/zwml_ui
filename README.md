# zwml_ui

Live auction-draft display for the ZWML fantasy football league. A read-only,
projector-sized mirror of the league's Google Sheet: the commissioner enters
picks exactly as they do today, and the board updates within a few seconds.

Answers, from across a room:

- how much money each manager has left
- how many roster spots they still have to fill
- **what the most they can bid right now is**
- what positions they still need
- who is on the clock to nominate

## Status

Design complete, implementation starting. **[docs/DESIGN.md](docs/DESIGN.md) is
the source of truth** — architecture, the verified sheet schema, UI design,
failure modes, and the build order.

## How it works

A static single-page app on GitHub Pages polls the sheet's CSV export every
three seconds. No backend, no credentials, no login, no cost.

```
Google Sheet (link-shared)
  └─ /export?format=csv&gid=…  ──►  browser: parse → derive → render
```

Everything runs client-side, so the deployed bundle is year-agnostic and a new
season needs no redeploy. Target display is **1920 × 1080**; phones and laptops
get the same components with a narrower column set.

## The spreadsheet id is not in this repo

By design — see [DESIGN.md §9.1](docs/DESIGN.md). The app resolves it at runtime:

1. a `#sheet=<id-or-url>` fragment (persisted to `localStorage`, then stripped
   from the address bar)
2. `localStorage`
3. a base64 build-time default from the `SHEET_ID_B64` repository secret
4. otherwise a setup card asking you to paste the sheet URL

This keeps the id out of code search, clones, and git history. It is **not**
access control: anyone on the running page can read the URL from the network
tab, and the sheet's own sharing setting is the only real control. Base64 is
obfuscation, not encryption.

A test (`src/config/no-committed-sheet-id.test.ts`) scans every tracked file and
fails the build if an id is ever committed.

## Development

Requires **Node 22.12+** (Vite 7). The exact version is pinned in
`.node-version`, which mise, nvm, fnm, and CI all read.

```bash
npm install
cp .env.example .env.local   # then set VITE_SHEET_ID_B64, or just use #sheet=
npm run dev                  # local dev server
npm test                     # parser and model unit tests
npm run build                # production bundle into dist/
```

Push to `main` deploys to Pages via `.github/workflows/deploy.yml`. CI needs the
`SHEET_ID_B64` secret (Settings → Secrets and variables → Actions); without it
the build still succeeds and the board shows its setup card.

`src/config/league.ts` holds every league rule and sheet coordinate, and is the
only file that should need editing between seasons.

Real captures from the live sheet live in `docs/data-samples/` and are the
fixtures the parser tests run against. Note `2026-auction-gviz-collapsed.csv` is
deliberately *not* representative — see DESIGN.md section 5.0.

## Draft-night notes

- Deploy **at least 15 minutes early**, hard-reload the projector once, then stop
  deploying. Pages serves `index.html` with a fixed 10-minute cache.
- Keep the sheet open in a second tab as a fallback display.
- If the ticker shows sales that already happened, or **ON THE CLOCK** names the
  wrong manager, press **`X`** — that clears leftover session state (usually from
  a rehearsal run) and re-baselines from the current sheet. `Shift+N` nudges the
  pointer back one if it is just off by a step. See DESIGN.md §7.5.
- The money columns never depend on session state, so they stay correct even
  when the ticker or nominator is confused.
- **Stop the laptop sleeping.** `caffeinate -dimsu` in a Terminal, or System
  Settings → Lock Screen → display off "Never" *and* "Prevent automatic sleeping
  when the display is off". A suspend stops the poll loop, and waking from one can
  cost the ticker and the nominator (the money is unaffected).
- **`?` lists every key.** There is no `D` overlay — the keys are `?` help,
  `R` rosters, `H` sale history, `N`/`Shift+N` nominator, `X` reset, `T` light/dark,
  `+`/`−`/`0` type size, `G` fetch now.
- **If the footer goes amber or red, the figures have stopped tracking the sheet.**
  The header's `STALE`/`OFFLINE` age is the age of the FIGURES, not of the last
  request — so a green `LIVE` means what is on the wall is current. `G` will not
  fix a sheet the parser has refused; that needs the sheet repaired.
- **Deploying needs `npm run deploy`**, not a bare `git push` — pushing alone
  stopped triggering the workflow, so the script pushes *and* dispatches it.
