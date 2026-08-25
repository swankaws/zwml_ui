# ZWML Auction Display — Design

**Status:** Draft, rev 6 — 1080p target, spreadsheet id out of the repo, review findings verified and fixed
**Last updated:** 2026-08-25
**Blocking questions:** none — Q1–Q13 all resolved. Q14 is data entry (the 12-name order), not a
design decision.
**Changes in this rev:**
1. **The projector is 1080p, not 1024 × 768.** This is *not* a pure relaxation — 16:9 gives less
   vertical room than 4:3 for the same physical image, so it changed the layout rather than just the
   numbers. See §7.1 and §7.2.
2. **The spreadsheet id is no longer stored in this repository** and must never be re-added; it is
   resolved at runtime (§9.1, D14).
3. **Fixed a real bug found in adversarial review:** persisted session state was keyed by year only,
   so state written during the dress rehearsal would be restored on draft night and replay every
   keeper entered in between as a fake sale, putting the wrong name under ON THE CLOCK at the
   most-watched moment. §7.5 now specifies a staleness window, absorb-don't-replay reconciliation, and
   an `X` reset key.
4. Two smaller review fixes: the id-resolution precedence now ranks the CI default **above**
   `localStorage` and persists only after a successful fetch (§9.1), and the committed-id guard test
   now catches base64 and unquoted forms it was previously blind to.
5. **Rev 6 — the eight findings left unverified in rev 5 have now been checked one by one.** Five were
   real and are fixed: the header's `$/slot` divided by zero at draft end and counted unspendable money
   (§6); the blank-price rule contradicted the slot test in a way that made every sale flicker mid-entry
   (§5.3, §5.5); nothing implemented the promised "never blank the screen", and the watchdog shared a
   fate with the tree it was meant to rescue (**§8.1, new**); the rail's vertical budget was
   over-subscribed by ~50 px and the mock hid it by showing 6 of 12 names (§7.2); and the phase-7
   legibility measurement was the sole test of §7.1's arithmetic, so it moves to **phase 3** (§12). One
   was a genuine imbalance worth measuring rather than re-guessing (column widths, §7.2), one was a
   documentation overstatement (`SETTINGS` "zero redeploy", §7.5), and the endurance claim in §2 now has
   an actual test in phase 4. One flagged item was **rejected** with reasoning: `MAX BID` stays in
   column 5.

**Carried correction from earlier revs:** rev 2's claim that the row geometry was dynamic and that band 1
was structurally irregular was **wrong** — both were artifacts of the `gviz` endpoint, not the sheet.
See §5.0. The template is fixed and uniform; the primary endpoint is `/export?format=csv&gid=`.

**Repo:** https://github.com/swankaws/zwml_ui
**Data source:** one link-shared Google Sheet, verified readable with no credentials. Its id is
deliberately **not recorded here or anywhere else in the repo** — see §9.1.

---

## 1. Purpose

A large-format, always-on display for a live fantasy football auction draft, projected on a wall
while the auction runs. It is a **read-only mirror** of the league's existing Google Sheet: the
commissioner keeps entering picks exactly as they do today, and the display updates itself within
a few seconds.

Its job is to answer, at a glance and from across a room, the questions that otherwise get shouted
mid-auction:

- How much money does each manager have left?
- How many roster spots do they still have to fill?
- **What is the most they can bid right now?**
- What positions do they still need?

The league already maintains an **`AUCTION DISPLAY`** tab that computes exactly these figures by
hand (§5.6). That tab is the proof this display is worth building — and its column choices are the
league's own mental model, which this design deliberately matches.

### Non-goals

- Not an auction *engine*. It does not run the clock, take bids, or write to the sheet.
- Not multi-league or multi-tenant. One sheet, one league.
- No login, no user accounts, no server we operate.

**In scope, but secondary:** league members opening the same URL on **phones and laptops** during the
draft (Q8). The projector is the design target and wins every trade-off; the compact layout is the
same components with fewer columns, not a separate product.

---

## 2. Constraints

| Constraint | Implication |
|---|---|
| Zero hosting cost | Static site only, no backend we pay for. GitHub Pages. |
| Updates when the sheet changes | Browser polls the sheet; no server push available for free. |
| Runs unattended ~4 hours | No auth token that expires mid-draft. No human clicking a consent popup. |
| Read from a projector, 10–30 ft away | Very large type, high contrast, dark background, no fine detail. |
| Projector is **1920 × 1080 (16:9)** (Q7) | 16:9 is *short*. Vertical room, not width, is the binding constraint (§7.1). |
| Also viewed on phones and laptops (Q8) | Column-priority layout must degrade to one narrow column without a second codebase. |
| Operated by one person who is also running the draft | Zero-config startup: open URL, fullscreen, done. **This is why the sheet id is baked in at deploy time rather than typed on draft night** (§9.1). |
| The sheet's location must not be in the repo | Resolved at runtime; committed config holds gids only, which are useless alone (§9.1, D14). |
| The sheet's layout is fixed and not ours to change | The parser adapts to the sheet, never the reverse. |

---

## 3. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Sheet access | **Link-shared sheet, read `/export?format=csv&gid=` directly from the browser** — verified (§5.0) |
| D2 | Front end | **Vite + React + TypeScript** |
| D3 | Primary layout | **Full manager table, always visible, nothing rotating** |
| D4 | Extras in scope | **Recent-sales ticker** (via poll diffing, §7.3), **full per-manager roster view** (§7.4), **auto-advancing nomination strip** (§7.5) |
| D5 | Hosting | GitHub Pages, project site, GitHub Actions publishing source |
| D6 | Source of truth for derived numbers | **Recompute in the app from player-level data**, cross-checking the sheet's own figures (§5.7) |
| D7 | Data store | **Keep the Google Sheet as the system of record** — do not build our own (§5.10) |
| D8 | Sales history | **Browser-side poll diffing** (§7.3); optional Apps Script change log as a later upgrade (§5.11) |
| D9 | Display target | **1920 × 1080 (16:9) is the primary target**, laid out as **table + side rail** to buy back the vertical room 16:9 costs (§7.1); phones and laptops second (Q8) |
| D10 | Grid parsing | **Walk the fixed template, verify every anchor by label** (§5.4) — the geometry is uniform and stable (§5.3) |
| D11 | Defensive / Divisional draft | **Out of scope for the display** (Q5, §7.4) |
| D12 | Nomination order source | **A new `SETTINGS` tab, with a `league.ts` fallback** — never added to the auction grid (Q13, §7.5) |
| D13 | Live session state | **Persist `(order, baseline, saleLog)` to `localStorage`** so a mid-draft reload is exact (§7.5) |
| D14 | Spreadsheet location | **Never committed.** Resolved at runtime: `#sheet=` fragment → `localStorage` → base64 build-time default from a CI secret → setup screen (§9.1) |

### D1 — resolved

The sheet is shared **"Anyone with the link → Viewer"** and confirmed readable with no credentials
as of 2026-08-24. **We use `/export?format=csv&gid=<gid>`, not `gviz/tq`** — see §5.0 for why.

Verified against the real sheet with `Origin: https://swankaws.github.io`:

- **CORS works on both hops.** The first response is a `307` carrying
  `access-control-allow-origin: https://swankaws.github.io`, redirecting to
  `doc-10-b0-sheets.googleusercontent.com`, which returns
  `access-control-allow-origin: *`. The wildcard on the final hop is what makes this legal, since a
  cross-origin redirect taints the request origin to `null`. So a browser `fetch` works with no
  proxy — but it **must** use `redirect: 'follow'` (the default).
- `cache-control: no-cache, no-store, max-age=0, must-revalidate` on **both** hops — always fresh,
  no publish lag.
- `content-disposition: attachment` is present and harmless to `fetch` (it would only matter if a
  human navigated to the URL).
- The full 63-row × 28-column tab is ~5 KB uncompressed, ~1 KB gzipped.
- **No documented quota** on either endpoint, so league members can open the board on phones and
  laptops (Q8) without us managing a rate limit.

Link-sharing alone is sufficient — **"Publish to web" is not required** and would be worse (§5.8).

> ⚠️ **Standing note:** the whole workbook is world-readable to anyone with the URL, and the URL is
> observable in the running page's network traffic even though it is no longer in the repo or greppable
> in the bundle (§9.1 — that is discoverability reduction, not access control). Column `AB` of the auction tab currently
> contains league business (`"RULE CHANGES 2026 … Increase dues to $150"`). That is mild, but it is
> a reminder that *everything* in this workbook is public now, including anything added later.
> If dues records, contact details, or payment tracking ever land in it, move the auction tabs to a
> dedicated spreadsheet and share only that.

**Hot spare (behind a flag, not the default):** Sheets API v4 with an API key — documented and
supported, unlike `gviz`, but needs a GCP project, ships a key in public JS, and carries a real
quota (300 reads/min/project, 60/min/user ≈ 15 concurrent viewers at 3 s polling), with Google
warning that overage *"is planned to incur charges … later in 2026."* Insurance, not primary.

**Rejected:** browser OAuth via Google Identity Services — tokens last ~1 hour, Google removed
silent refresh, and renewal requires a click in a popup, so the display would go dark mid-draft.
Also rejected: a service-account key, which cannot reach a browser without publishing its private
key. **Available if the sheet ever needs to go private again:** an Apps Script web app
(*Execute as: me* / *Anyone*), plain `GET` with no custom headers — Apps Script cannot answer a
CORS preflight, so any custom header breaks it permanently.

---

## 4. Architecture

```
┌──────────────────────────────────────┐
│ Google Sheet (link-shared)           │
│  tab "2026 Auction"   ← picks, live  │
│  tab "AUCTION DISPLAY" ← cross-check │
└─────────────────┬────────────────────┘
                  │  HTTPS GET every ~3s, no credentials, cache: 'no-store'
                  │  /spreadsheets/d/<id>/export?format=csv&gid=1565415907
                  │      id resolved at runtime, never committed (§9.1)
                  │      redirect: 'follow'  (required — see D1)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ Browser — static SPA served from GitHub Pages                │
│                                                              │
│  sheetClient ─► gridParser ─► ManagerBlock[] ─► derive ─► UI │
│   (poll,         (fixed        (name, picks,     (spent,     │
│    backoff,       template,     totals as        needs,      │
│    body-hash      label-        written)         maxBid,     │
│    change         verified)                      posCounts)  │
│    detection)                                                │
│                        │                                     │
│                        └─► diffEngine ─► sales ticker        │
│                                                              │
│  config/league.ts ──► budget, slot template, manager names   │
└──────────────────────────────────────────────────────────────┘
```

Everything runs in the browser. No build-time data fetch, so the deployed bundle is year-agnostic
and a new draft season needs no redeploy.

### Modules

| Module | Responsibility |
|---|---|
| `config/league.ts` | Budget, slot template, min bid, poll interval, manager roster and display order, name aliases, tab gids. The only file that changes year to year. **Holds no spreadsheet id** (§9.1). |
| `config/sheetLocation.ts` | Resolves the spreadsheet id at runtime and builds validated export URLs (§9.1). Pure functions plus a thin browser wrapper, so precedence is testable without a DOM. |
| `data/sheetClient.ts` | Fetches a tab by `gid` via `/export?format=csv`. Owns polling, backoff, abort, and change detection. Interface `SheetSource` so the gviz, API-v4, or Apps Script variant drops in. |
| `data/tabs.ts` | Tab inventory and auction-tab selection (§5.2). |
| `data/gridParser.ts` | Raw cell grid → `ManagerBlock[]`. Reads the fixed template, then verifies its assumptions against the row labels (§5.4). Collects `ParseWarning[]` instead of throwing. |
| `model/derive.ts` | `ManagerBlock[]` + config → `ManagerState[]` + `LeagueState`. Pure, unit-tested, no DOM. |
| `model/diff.ts` | Compares consecutive parses to emit `SaleEvent[]` for the ticker and to flash changed values. |
| `ui/*` | Presentational components. Receive derived state, own no fetching. |
| `ui/StatusBar` | Live/stale indicator, data age, warning count. |

### Update loop

1. Poll every **3 s**, `fetch(url, { cache: 'no-store' })`.
2. Hash the response body. Unchanged → stop. No re-parse, no re-render.
3. Changed → parse → derive → diff → render, flashing values that moved and pushing new sales onto
   the ticker.
4. On error: keep the last good frame, mark the status bar stale with the data's age, retry with
   backoff (3 → 6 → 12 s, cap ~15 s). **Never** blank the screen or show a stack trace.
5. On `visibilitychange` → visible, force an immediate refetch rather than trusting the interval
   (browsers throttle background timers).

**Refetch the whole tab every poll — conditional requests are unavailable.** Neither `/export` nor
`gviz` sends an `ETag` or `Last-Modified`; both answer `cache-control: no-cache, no-store,
max-age=0, must-revalidate` on every hop, and `If-None-Match` was verified to return a full 200
body. gviz's `tqx=sig:` "not_modified" handshake is *not implemented* by Google Sheets (tested:
returned the full table with `status:ok`). At ~5 KB raw / ~1 KB gzipped this is irrelevant.

Polling beats every free alternative. Drive push notifications are structurally impossible for a
static site (they POST to a server with a CA-signed cert, and `files` channels expire within a day
with no auto-renewal). An Apps Script `onEdit` → Firebase route would give sub-second updates but
adds a service and a silent-failure mode where one missed trigger leaves the board invisibly
stale. ~4,800 requests over four hours against Google's CDN is free and boring.

---

## 5. Data contract — verified against the live sheet

### 5.0 Endpoint choice: `/export`, not `gviz` — and a correction

**An earlier revision of this document claimed the sheet's row geometry was dynamic and that band 1
was structurally irregular. Both claims were wrong.** They were artifacts of the `gviz/tq` endpoint,
not properties of the sheet. The maintainer was correct that the template is fixed. Recording the
error here because the two endpoints disagree in ways that will bite anyone who assumes otherwise.

Same tab, same moment, two endpoints:

| | `/export?format=csv&gid=` | `gviz/tq?tqx=out:csv` |
|---|---|---|
| Rows returned | **63 — the true grid** | 43 |
| `K` rows (col B) | **10, 31, 52** — uniform stride 21 | 8, 27, 40 |
| `DEF` rows | **19, 40, 61** | 15, 29, 41 |
| Bench rows per band | **8, 8, 8** | 6, 1, 0 |
| Band 1 header | `B2 = "Kevin"`, `B3 = "Pos"` | `"Kevin Pos"` — **one concatenated cell** |

Two distinct gviz behaviors caused this:

1. **gviz silently drops fully-empty rows.** 63 → 43. Because the number of empty rows *shrinks as
   the draft fills in*, **gviz row indices shift during the draft** — which is what I misread as the
   sheet changing. The sheet is stable; the gviz *representation* is not.
2. **gviz auto-detects header rows and concatenates them.** It merged sheet rows 2 and 3
   (`"Kevin"` + `"Pos"`) into the single label `"Kevin Pos"`, inventing the "irregular band 1" that
   does not exist. Passing `headers=0` suppresses this, but the empty-row dropping remains.

**Therefore `/export?format=csv&gid=` is the primary endpoint.** It returns the literal grid,
preserving empty rows and keeping row numbers identical to what the maintainer sees in Google
Sheets — which makes the sheet debuggable against the app by eye. Its only real constraint is that
it selects by `gid` only, never by tab name; the gids are stable and already known (§5.1).

`gviz/tq` is retained as a **fallback** behind the same `SheetSource` interface. If used, it needs
`headers=0` and a parser that cannot depend on row indices at all.

> Meta-lesson worth keeping: **verify structural claims against more than one endpoint before
> designing around them.** A single source's representation is not the data.

### 5.1 Tab inventory (read 2026-08-24)

| gid | Name | Role |
|---|---|---|
| 1565415907 | `2026 Auction` | current season — **primary source** |
| 1089546311 | `AUCTION DISPLAY` | league's hand-built summary — cross-check only |
| 599461641 | `2025 Auction` | prior season |
| 2115370449 … 1982099215 | `2024`–`2018 Auction` | prior seasons, 7 more tabs |
| 1494036952 | `2017 Final Rosters` | different shape, ignore |
| 1445441490 | `Top 300` | player rankings — 323 rows, **stale by ~3 seasons**; see §7.6 |

### 5.2 Tab selection

`/export` selects a tab **by `gid` only** — there is no name-based selector — so the mapping from
year to gid lives in `config/league.ts` (§9) and the app picks the **highest configured year**,
with `?year=2025` to override for testing. The gids are permanent for the life of a tab, so this
list only changes when a new season tab is created.

Optionally, a `/htmlview` scrape can auto-detect a newly added `YYYY Auction` tab: that endpoint
returns 200 with CORS on a link-shared sheet and embeds every tab name and gid. It is undocumented
markup, so a scrape failure must always fall back to config and never take the board down.

> **⚠️ Why gid-only is a feature, not a limitation.** gviz accepts `&sheet=<name>` and, on a name
> that doesn't exist, **silently returns the WRONG TAB** — verified: `&sheet=Sheet1` answered
> `status:"ok"` with the *first* tab's data and no error at all. That is the nastiest failure mode
> available to this design, because it renders a plausible-looking board full of wrong numbers.
> `/export`'s `gid=` is unambiguous and 400s on a bad value. Regardless, **always assert expected
> anchor cells after parsing** and refuse to render on mismatch (§5.4).

### 5.3 Layout of a `YYYY Auction` tab

A **grid**, not a pick log: 12 managers laid out as **3 bands of 4**, each manager owning a
6-column block.

**The geometry is a fixed, perfectly uniform template.** Verified identical in the `2026 Auction`
and `2025 Auction` tabs, and identical across all three bands. Row numbers below are the **real
Google Sheets row numbers** the maintainer sees, so the sheet and the app can be compared by eye.

```
        B        C                D       E          F     │  H…M   │  N…S  │  T…Y
 r2   Kevin                                                │ Corky  │ Ryan  │ Toby     ← band name
 r3   Pos      Player            $                         │        │       │          ← header
 r4    QB      Jayden Daniels    $10    Needs       0      │   ← stats mini-block, cols +3/+4
 r5    RB      De'Von Achane     $10    Max Bid     $1     │
 r6    RB      Chase Brown       $11    QB          2      │
 r7    WR      Jameson Williams  $4     RB          6      │
 r8    WR      Emeka Egbuka      $28    WR          5      │
 r9    TE      Tyler Warren      $18    TE          1      │
 r10   K       Fairbairn         $1     K           1      │
 r11…r18       8 bench rows, position typed per player     │
 r19   DEF     (no player, no price)                       │
 r20           Total             $200                      │
 r21           Remaining         $0                        │
 r22   (blank spacer)
 r23  Jeff / Marc / Bill / Derrick   ← band 2, same shape, +21 rows
 r44  Colin / Jason / Nick / Tony    ← band 3, same shape, +42 rows
```

**Row anchors — stride 21, three bands** (Google Sheets row numbers; subtract 1 for 0-indexed):

| Element | Band 1 | Band 2 | Band 3 |
|---|---|---|---|
| Manager name | 2 | 23 | 44 |
| `Pos` / `Player` / `$` header | 3 | 24 | 45 |
| Starters (`QB RB RB WR WR TE K`) | 4–10 | 25–31 | 46–52 |
| Bench (8 rows) | 11–18 | 32–39 | **53–60** |
| `DEF` | 19 | 40 | 61 |
| `Total` | 20 | 41 | 62 |
| `Remaining` | 21 | 42 | 63 |

**Column geometry:** manager blocks start at columns **B, H, N, T** (0-indexed 1, 7, 13, 19),
stride 6. Within a block: `+0` Pos, `+1` Player, `+2` $, `+3` stat label, `+4` stat value,
`+5` spacer.

**Stats mini-block** (cols `+3`/`+4`, rows 4–10 relative to the band): `Needs`, `Max Bid`, then
`QB`, `RB`, `WR`, `TE`, `K` counts. Computed by sheet formula — see §5.7 before trusting it.

**Roster template — 16 slots, of which 15 are auction slots** (confirmed by the maintainer for
2026):

- 7 fixed **starter** rows: `QB, RB, RB, WR, WR, TE, K`. These keep their `Pos` label even when the
  slot is empty.
- 8 **bench** rows, position typed per player as drafted. The rows always exist; empty ones simply
  carry no `Pos` label, no player, and no price. **No rows are inserted during the draft.**
- 1 **`DEF`** row — position label only, **no player and no price**, because defenses are chosen in
  a separate "Defensive Draft" (cols Y/Z), not bought with auction dollars.
- Therefore **auction roster size = 15**, and the `$200` budget buys 15 players. Confirmed
  arithmetically: every completed stats block's `QB+RB+WR+TE+K` sums to exactly 15.

**The one usable slot test:** a row is a pick iff it has **both a non-empty Player and a non-blank
price cell**. `Pos`-label presence is *not* a slot test — empty starter rows have a label, empty bench
rows do not, and the `DEF` row has a label but never a price.

> ⚠️ **Order of operations matters here, and review caught the doc getting it wrong.** §5.5 coerces a
> blank or unparseable price to `$0`. If that coercion runs *before* the slot test, every row with a
> player name passes, the "and a parseable price" half of the test is dead, and a half-entered row
> becomes a $0 pick.
>
> This is not hypothetical: the commissioner types the player name and the price as two separate
> keystrokes, so **every single sale passes through a name-without-price state** that a 3-second poll
> will sometimes catch. In that window the coerce-first reading consumes a roster slot, drops `needs`
> by one, bumps a position count, and shifts `maxBid` by exactly $1 — for the manager who just won
> the bid, while the room is looking at them. Then it corrects itself a poll later. Numbers that
> flicker are worse than numbers that lag, because the room stops trusting the board.
>
> **The rule, stated once and referenced everywhere else:** the slot test runs on the **raw** cells,
> before any coercion. A blank price means *not yet a pick* — the row is invisible to `picks`,
> `spent`, `needs`, `maxBid`, `positionCounts`, and the ticker. `$0` coercion applies only to a price
> that is present but *unparseable* (`"TBD"`, `"?"`, a stray letter), which is a genuine data error
> worth surfacing rather than a row mid-entry. §5.5 and §6 both defer to this paragraph.

**Other content in the tab** (must be ignored by the parser, and is a good reason to anchor on
labels rather than scan columns):

- `A1` — a draft-order string, `"Jeff > Toby > Tony > Derrick > Marc > Corky > Bill > Ryan >
  Colin > Kevin > Nick > Rob "`. **Resolved:** it lists `Rob`, who was *drafting on Jason's behalf*
  that year; `Jason` is the manager. So this string is a historical artifact of a past draft night
  and **is not a reliable manager list**. The parser ignores it entirely; manager identity comes
  from the block header cells and `config/league.ts`.
- Cols `Y`/`Z`, rows 1–11 — "Defensive Draft": manager → NFL team pairs.
- Col `Z`, rows 14–28 — "Divisional Draft" order. Uses **`Jeffrey`** where the auction blocks use
  **`Jeff`**.
- Col `AB` — free-text 2026 rule changes.

### 5.4 Parsing strategy: fixed template, verified by label

Because the grid is uniform (§5.3), the parser walks the template directly and uses the row labels
as an **integrity check** rather than as a search mechanism. This is simpler and stricter than a
label-driven scan: it computes where every cell *must* be, then proves the sheet agrees.

```ts
const BANDS = [1, 22, 43]          // 0-indexed manager-name rows  (= sheet rows 2, 23, 44)
const COLS  = [1, 7, 13, 19]       // 0-indexed block start columns (= B, H, N, T)
// relative to band row R: header R+1, starters R+2..R+8, bench R+9..R+16,
//                         DEF R+17, Total R+18, Remaining R+19
// relative to block col C: pos C+0, player C+1, price C+2, statLabel C+3, statValue C+4
```

> Mind the two row bases. The table in §5.3 lists **sheet** row numbers so the doc can be read
> against Google Sheets; code is **0-indexed** into the parsed CSV, one less. Getting this wrong
> shifts every block by one row and still parses — it just silently drops each manager's `QB` and
> reads `DEF` as a pick. Assert on the labels and it cannot happen.

The algorithm, per band × column:

1. **Read the manager name** at `(R, C)`; normalize and alias-resolve (§5.5).
2. **Verify the template** before trusting anything: `(R+1, C) == "Pos"`, the starter labels at
   `R+2..R+8` equal `QB RB RB WR WR TE K`, `(R+17, C) == "DEF"`, `(R+18, C+1) == "Total"`,
   `(R+19, C+1) == "Remaining"`. Each mismatch is a `ParseWarning` naming the exact cell.
3. **Collect picks** from `R+2 .. R+16` (starters + bench, excluding `DEF`): a row is a pick iff
   Player (`C+1`) is non-empty **and** `$` (`C+2`) parses as a number. Position comes from the
   row's `Pos` cell (`C+0`) when present, else inferred from the ranking data if available (§5.6).
4. **Read `Total` and `Remaining`** from `(R+18, C+2)` and `(R+19, C+2)` — recorded as *what the
   sheet says*, kept strictly separate from what we compute (§5.7).
5. **Read the stats mini-block** from `(R+2 .. R+8, C+3/C+4)`, checking each label
   (`Needs`, `Max Bid`, `QB`, `RB`, `WR`, `TE`, `K`) against its expected row.
6. **Gate rendering.** If the template verification fails in a way that means we are looking at the
   wrong tab or a restructured sheet — no `Total` label found, or fewer than the configured number
   of manager names — **refuse to render** and show the last good frame with a loud banner (§7.8).
   Isolated per-cell warnings do not blank the board; they surface in the status bar.

Everything the parser needs is a constant in `config/league.ts`, so if the maintainer ever does
restructure the tab, the fix is a config edit rather than a parser rewrite.

**Fallback for the gviz source.** If `SheetSource` is ever switched to gviz (§5.0), row indices are
not usable and the parser must instead scan for `Total` / `DEF` labels to delimit blocks. Keeping
that path behind the same interface is cheap; keeping it *primary* is not, because its geometry
shifts as the draft fills in.

**Required tests:** parse the completed fixture and the partially-cleared fixture — both captured
via `/export` — and assert correct per-manager results for each, including a manager with zero
picks and a manager with a full 15.

### 5.5 Normalization rules

- **Manager names:** trim (the sheet contains `"Bill "` with a trailing space), case-insensitive
  compare, and apply a config alias map. An unmatched name goes into a visible `⚠ Unmatched` row
  rather than being silently dropped. The `Jeffrey → Jeff` alias is now **cosmetic only** — `Jeffrey`
  appears solely in the Divisional Draft columns, which we no longer read (Q5). Keep it anyway; it
  costs one line and covers the case where it turns up somewhere else.
- **CSV parsing must be a real RFC 4180 parser, not `text.split('\n')`.** Verified: cell `A16` of
  both auction tabs contains a **quoted cell with an embedded newline**. A line-splitting parser
  desynchronizes from that row onward — every band-1 bench row, `DEF`, `Total`, and `Remaining`
  anchor lands one row off, and it *still parses*, producing a plausible board with wrong rosters.
  Found by the geometry test, not by reading: `src/data/csv.ts` handles quoted commas, escaped
  quotes, embedded newlines, and CRLF, and `csv.test.ts` asserts the fixture still contains the
  hazard so the test cannot quietly stop testing anything.
- **Prices:** strip `$` and thousands separators; `$10`, `10`, `10.00` all accepted. **Blank ≠
  unparseable** (§5.3): a *blank* price means the row is not a pick at all and is skipped silently — it
  is a row mid-entry, not an error. A price that is *present but unparseable* → `$0`, flagged as a
  warning, because that one is a real data problem someone should see.
- **Positions:** uppercase; map `D/ST`, `DST`, `DEF`, `DEFENSE` → `DEF`.
- **DEF rows carry no price and no player** and must not count toward spend or auction slots.
- Blank rows, spacer columns, and trailing empties are ignored.

### 5.6 The existing `AUCTION DISPLAY` tab

Already computes, per manager: `Spent`, `Remaining $`, `Remaining %`, `Pos. Needed`, `Max Bid`,
and `QB/RB/WR/TE/K` counts — 12 managers in 2 bands of 6, plus league totals (`Spent $2,411`,
`Total $ 2400`, `Remaining -$11`). Note those totals are from the **uncapped 2025** state, hence the
negative league remainder; the tab has not been reset for 2026.

Its layout is a **different geometry from the auction tabs** (2 bands of 6, 36 rows), so it needs its
own small parser if we use it as a cross-check — a reason to keep it strictly a development tool
rather than a runtime dependency.

**We read the auction tab, not this one** (D6), because this tab has no player-level data — so no
roster view and no sales ticker — and because its formulas are buggy (§5.7). It is, however, an
excellent **development cross-check**: parse both and assert agreement where the formulas are
sound. Its column choices also directly informed §7.2.

### 5.7 The sheet's formulas — verified against the 2026 tab

**Good news: `Max Bid` is confirmed correct, and it matches our formula exactly.** Verified against
live partial data:

| Manager | Needs | Remaining | Sheet `Max Bid` | `remaining − needs + 1` |
|---|---|---|---|---|
| Kevin | 11 | $123 | **$113** | 123 − 11 + 1 = 113 ✓ |
| Corky | 11 | $135 | **$125** | 135 − 11 + 1 = 125 ✓ |
| Ryan | 15 | $200 | **$186** | 200 − 15 + 1 = 186 ✓ |
| Nick | 14 | $190 | **$177** | 190 − 14 + 1 = 177 ✓ |

`Needs` is also confirmed as `15 − draftedCount` (Kevin: 4 drafted → 11), independently confirming
the 15-auction-slot model.

**Full-tab verification (2026-08-24).** The template of §5.3 and the derived formulas of §6 were run
against both `/export` fixtures, all 24 manager blocks:

- **Template: zero violations.** Every `Pos` header, starter label (`QB RB RB WR WR TE K`), `DEF`,
  `Total`, `Remaining`, and stats label landed on its predicted cell in both tabs. The geometry
  claim of §5.3 is not an inference — it is checked.
- **2026: all 12 managers agree on all four numbers** — `spent`, `remaining`, `needs`, `maxBid`.
- **2025: `spent` agrees for all 12**; the disagreements are exactly the known uncapped-year
  artifacts, which is the reassuring outcome.

**Column semantics worth stating, since the labels are ambiguous:** the `Total` row holds **total
dollars spent**, not the budget, and `Remaining` holds `budget − spent`. Reading `Total` as "budget"
would invert the whole board.

Two prior-year defects are **now fixed by the maintainer** for 2026: the `$200` cap is enforced
(2025's `$194`–`$206` spends were legal *that year only*), and `Remaining` derives from `$200`
throughout. The old `Remaining %` breakage and the `Max Bid = Remaining + 1` full-roster edge case
were artifacts of the uncapped 2025 tab.

One more 2025-only quirk, found during verification and worth *not* fixing: `Remaining` is floored at
`$0` for the **five** overspenders (Corky `$201`, Derrick `$203`, Tony `$204`, Toby `$205`, Jeff
`$206`), and **Marc** (`$198` spent → sheet says `$4`, not `$2`) is off by two from `200 − spent`. Six
`remaining` disagreements in total, and `spent` agrees for all twelve. Old sloppy formulas, legal that
year, invisible in 2026 — precisely why D6 recomputes and the debug overlay shows both numbers side by
side.

> **Corrected while implementing phase 2.** An earlier revision of this section also named **Nick**
> (`$194` → `$7`) as inconsistent. Read directly from the fixture at `P63`, that cell says **`$6`** —
> exactly `200 − 194`, and perfectly consistent. Only Marc is actually off. `derive.test.ts` now pins
> the exact disagreement set, so this paragraph no longer rests on anyone's reading of a spreadsheet.

**We still recompute (D6)** — not out of distrust, but because:

- The app needs per-player data anyway for the roster view and ticker, so the totals come free.
- A snapshot mid-recalculation could show a stale formula value; our numbers are always internally
  consistent with the picks we parsed.
- Historical tabs (2018–2025) retain the old behavior, and `?year=` must render them sanely.
- Agreement between the sheet's figures and ours is a **free continuous correctness check** — shown
  in the debug overlay, so any future formula change gets noticed immediately rather than silently
  contradicting the board.

The one place we deliberately differ: at `Needs = 0` we render **`FULL`** rather than a dollar
figure, since no bid is possible.

### 5.8 Rejected: "Publish to web"

Google's only timing statement is that the published copy *"might take a few minutes"* to update —
fatal for a few-seconds target. (The widely repeated "~5 minutes" figure has no authoritative
source.) It also creates a second, search-indexable public surface and a separate publish state to
manage, while buying nothing: `/export` already works on a merely link-shared sheet.

### 5.9 State of the `2026 Auction` tab

The tab was duplicated from 2025 and has since been **cleared and partially populated** by the
maintainer. Current snapshot:

- 12 manager blocks intact, template geometry unchanged from 2025, `$200` cap enforced, all
  `Remaining` values consistent.
- A handful of keepers entered — Kevin 4 players / `$77`, Corky 4 / `$65`, Nick 1 / `$10`; the
  other nine managers at `$0`.
- **Keepers will be filled in progressively**, so the tab will be partially populated for a while
  and complete before draft night. The display must look correct at every point along that path.

This snapshot is valuable beyond bookkeeping: it is the **first real partial-roster fixture** the
project has. Prior seasons are all completed drafts, so this and hand-truncated variants of it are
the primary test material. It is also what exposed the gviz row-collapsing behavior of §5.0, since
the empty-row count is what differs between a partial and a completed tab.

A **"draft looks complete / not started"** heuristic still earns its place in the status bar — if a
duplicated-but-uncleared tab is ever pointed at on draft night, that must be obvious in the first
second rather than at kickoff.

### 5.10 Considered: replacing the sheet with our own data store

Worth taking seriously, since the maintainer owns the sheet and can restructure it freely. The grid
is a wide 4-across layout rather than a pick log, so it needs a purpose-written parser — though now
that the template is known to be fixed and uniform (§5.3), that parser is short and boring.

**Recommendation: keep the Google Sheet (D7).** Not out of inertia — it wins on the merits:

| | Google Sheet (chosen) | Text/JSON file in the repo | Custom app + free-tier DB |
|---|---|---|---|
| Entering a pick live | Type in a cell. Instant. | `git commit` + push per pick, then an Actions build **and up to 10 min of Pages CDN cache** | Type in a form |
| League follows along | **Already how they do it** — live, on phones, no new URL | No | Only via our display |
| Concurrent editing | Free and battle-tested | Merge conflicts | Depends |
| Revision history | Built in, free | Git log | Must build |
| Infra to maintain | None | None | A service that can be down |
| Cost | $0 | $0 | $0 *if* free tier holds |
| Risk if it fails mid-draft | Google is up | Deploy latency is fatal | Untested on draft night |
| Parsing difficulty | **Modest, and unit-tested** | Trivial | Trivial |

The decisive points:

1. **Committing a file per pick is disqualifying.** Pages' fixed `max-age=600` and up to 10 minutes
   of propagation (§10) mean data-in-the-bundle can lag ten minutes. The whole product is
   "updates within a few seconds."
2. **"Others follow along in the sheet" is a real feature, already working.** Replacing the sheet
   means either taking that away or maintaining two systems that can disagree — and a display that
   contradicts the sheet is worse than no display.
3. **Parsing difficulty is a one-time, fully testable cost.** ~100 lines of template walking behind
   unit tests against real fixtures. It does not recur, and it cannot fail on draft night in a way
   tests didn't catch.
4. Draft night is a **single-shot, unrepeatable event**. The correct bias is toward the boring
   system the league has used for eight seasons.

**Optional sheet improvement, if parsing ever becomes a maintenance burden:** add a machine-readable
`FEED` tab that flattens the grid to one row per pick (`Manager | Pos | Player | Price`). With a
fixed template this is a pure-formula tab — no Apps Script needed. **Still not recommended now:** it
is a second representation that can silently disagree with the first, in exchange for saving ~100
tested lines. Revisit only if the grid layout changes substantially.

**Sheet changes actually worth requesting:** exactly one — a new `SETTINGS` tab holding this season's
nomination order (§7.5). Note it is a **new tab, not an edit to the auction grid**, so the verified
template of §5.3 is untouched and the change cannot affect what the league sees. Otherwise leaving
the live document alone is a feature.

### 5.11 Change log / durable sales history

The ticker works by diffing polls (§7.3), which is free and needs nothing from the sheet — but it
starts empty on page load and dies with the tab. Since the projector will be open from the start
(confirmed), that is sufficient for v1.

**A durable change log is achievable for free**, and is the natural upgrade:

- An **Apps Script `onEdit` trigger** on the sheet appends `[timestamp, manager, player, position,
  price]` to a hidden `LOG` tab. Consumer-account quota is 90 min/day of total trigger runtime
  against a few hundred sub-second runs — not close to a limit. No hosting, no cost.
- Simple `onEdit` triggers fire on **user edits only**, not formula recalcs — which is exactly
  right, since picks are typed by hand.
- The display then reads `LOG` like any other tab, and gains: a ticker that survives reload,
  true sale timestamps, `$`-per-minute draft pace, biggest sale of the night, and a post-draft
  replay.
- Caveats to design around: a bulk paste of keepers arrives as one event over a range, and
  correcting a typo logs a second entry — so `LOG` is an append-only *event* stream, not state.
  The auction tab stays the source of truth for current values.

**Scoped as a phase-8 enhancement (D8), not a v1 dependency.** It adds a script to a live league
document, and that risk isn't worth taking in the week before a draft.

Rejected for history: a free-tier hosted database (Firebase RTDB and similar). It would give true
push updates and timestamps, but it adds a second system that can disagree with the sheet, plus a
service that has never been exercised on draft night — for a feature the poll-diff already covers.

---

## 6. Derived values

Per manager, with `budget = 200`, `minBid = 1`, `auctionSlots = 15` (DEF excluded):

```
picks           = rows passing the §5.3 slot test (DEF row excluded)
spent           = Σ price
remaining       = budget − spent      // 2026 caps at $200; historical tabs can go negative,
                                      // so never floor at 0 — render the truth
slotsFilled     = picks.length
needs           = auctionSlots − slotsFilled          // verified against the sheet (§5.7)
maxBid          = needs <= 0 ? null                   // roster full → render "FULL", not a number
                             : max(minBid, remaining − (needs − 1) × minBid)
                             = max(1, remaining − needs + 1)   // ✓ matches sheet on live data
pctRemaining    = remaining / budget                  // computed correctly, unlike the sheet
avgPerSlot      = needs > 0 ? remaining / needs : 0
positionCounts  = { QB, RB, WR, TE, K } over picks    // DEF is not an auction slot; ignored (Q5)
```

`maxBid` is *the* number this display exists to publish, and the one people get wrong in their
heads. It gets the largest, boldest type on each row.

League-wide, for the header:

```
active           = managers with needs > 0             // a FULL manager cannot bid again
leagueSpent      = Σ spent                             // over all 12
leagueRemaining  = Σ remaining over active             // dollars that can still chase players
leagueNeeds      = Σ needs                             // = Σ needs over active, by definition
slotsFilled / (12 × 15)
avgPerRemainingSlot = leagueNeeds > 0                   // market pace
                        ? leagueRemaining / leagueNeeds
                        : null                          // draft over → render "—", never a number
```

> ⚠️ **Two bugs found in review, fixed above.** Both live in the header, which is on screen for the
> whole draft.
>
> 1. **Divide by zero at the moment the draft ends.** `leagueNeeds` reaches 0 when the last slot
>    fills, so the un-guarded form yields `Infinity` — the header would read `$Infinity/slot` at the
>    single most-watched moment of the night. The per-manager `avgPerSlot` one block up was already
>    guarded, which is what makes this an oversight rather than a decision. `null` renders as `—`.
> 2. **Dead money inflated the pace.** `leagueRemaining` summed over *all* managers, so a manager
>    holding $14 with a full roster contributed $14 to "dollars still chasing players" — money that
>    is structurally unspendable, since they can never bid again. Summing over `active` only is the
>    honest figure, and it matters most late, exactly when the room is watching pace to judge
>    whether the remaining players are about to go cheap.

Validation states surfaced visually, never hidden: `remaining < 0` (overspent),
`slotsFilled > 15` (over-rostered), unmatched manager names, unparseable prices.

**Who is on the board is decided by the sheet, not by `league.managers`.** `deriveLeague` builds a row
for every one of the twelve name cells; `league.managers` then supplies *order* and fixes up known
spellings, and a manager missing from it lands at the end of the board under the sheet's own spelling.
The first cut had this backwards — it iterated `league.managers` and looked each one up, so an
unrecognized name produced **eleven rows and no indication a twelfth person existed**. That is the
worst available failure: not an error, just a person quietly missing from the wall. The league
totals follow the same rule (`managers.length × auctionSlots`, not a hard-coded 180), so a roster
change days before the draft needs no deploy. Membership drift still warns, via §5.4's
`Unrecognized manager` check — it is reported, it just is not enforced.

**Not validated: position counts.** Roster construction is unrestricted for bench slots, and while
the league does have some positional caps, they are **not encoded in the sheet** (Q9). The display
therefore reports position counts as facts and never flags one as "too many" — inventing a rule the
league doesn't enforce would be worse than saying nothing.

---

## 7. UI design

### 7.1 Target display — 1920 × 1080 primary, resolution-adaptive

**The projector is 1920 × 1080 (16:9)** (Q7). It is worth being precise about what that does and
does not buy, because the intuitive reading is wrong.

**More pixels is not bigger text.** Legibility across a room depends on the *physical* height of a
glyph, which is `(type size ÷ vertical resolution) × image height`. Going from 1024 × 768 to
1920 × 1080 on the same wall makes each pixel smaller, not the text bigger. Worse, **16:9 is short**:
a projector throwing an 84″-wide image gives 63″ of height in 4:3 but only 47″ in 16:9. So for a
fixed image width, moving to 1080p *costs* about 25% of the vertical space a 12-row table has to
live in.

The real gain from 1080p is **horizontal**: ~1843 usable px instead of ~983. The design change is to
spend that width buying back the lost height, by moving the ticker and nomination strip **out of the
vertical stack and into a side rail**.

**Vertical budget at 1080 px.** Usable height after ~2% safe-area padding is ~1037 px.

```
                                  stacked (4:3 shape)   table + side rail
  header: title, totals, status         ~84 px               ~84 px
  column header row                     ~40 px               ~40 px
  nomination strip                      ~68 px            → moved to rail
  sales ticker                          ~68 px            → moved to rail
  inter-block gaps                      ~48 px               ~16 px
  ──────────────────────────────────────────────────────────────────────
  left for 12 manager rows             ~729 px              ~897 px
  per row                               ~61 px               ~75 px
  primary type size                     ~38 px               ~47 px
```

**Physical size, on an 84″-wide image** (the figure to re-measure on site):

| Layout | Type | Share of height | Physical | Legible to ≈ |
|---|---|---|---|---|
| Old 1024 × 768 stacked | 28 px | 3.6% of 63″ | 2.3″ | 29 ft |
| 1080p stacked | 38 px | 3.5% of 47″ | 1.7″ | 21 ft |
| **1080p table + rail** | **47 px** | **4.4% of 47″** | **2.1″** | **26 ft** |
| — its `MAX BID` (1.4×) | 66 px | 6.1% of 47″ | 2.9″ | 36 ft |

Using the projection rule of thumb that comfortable reading needs roughly *viewing distance ÷ 150*
of glyph height. **`MAX BID` clears the whole room; the secondary numbers clear most of it.** These
figures scale linearly with the projected image, so a 10 ft image makes all of them comfortable —
which is exactly why the on-site scale control below is not optional.

Mechanics:

- One root font-size derived from viewport height (`clamp()` on a `vh` basis) so every size,
  padding, and gap scales together from a single variable. No per-breakpoint font tables.
- **Aspect-ratio-aware, not just width-aware.** ≥16:9 gets the side rail; 4:3 and narrower fall back
  to the stacked layout with the ticker beneath. Driven by an aspect-ratio media query — the same
  1920 px width means very different things at 16:9 and 4:3.
- ~2% safe-area padding for projector overscan and keystone cropping.
- **12 rows always fit; the grid never scrolls.** Row height, type size, and column set step down
  together until they do.
- `+` / `−` keys nudge the root scale live, `?scale=1.15` pins it, and the `SETTINGS` tab sets it
  durably (§9.2) — because the real room, the real throw distance, and the real bulb decide what is
  actually readable, and that can only be discovered on site. **Budget time for this in the phase 7
  rehearsal**; the table above is arithmetic, not a measurement.
- Projectors are dimmer and lower-contrast than the laptop the design is built on: use bold weights
  over thin ones, avoid mid-grey text, and keep meaningful color differences large rather than
  subtle. Verify on the real bulb, not the editor.
- The layout must still hold up at 1280 × 720, 1024 × 768, and a laptop window, since the projector
  can change on the day.

#### The scale ceiling — measured, and smaller than it looks

The projector is not available until the day before the draft (revised Q7), so `scale` had to be
built before it could be validated on the wall. That makes its **limit** the important thing to
document, because an operator reaching for it at 7pm needs to know what it can and cannot buy.

**It buys about 15%, and it is bound by row height — not by width, and not by this multiplier.**
Twelve rows in a fixed 1080 px is the whole constraint. Measured with `tools/measure.mjs`, mid-draft
fixture, 1920 × 1080:

| `scale` | Columns | Row height | `MAX BID` | Rows want | Verdict |
|---|---|---|---|---|---|
| 1.00 | 6 | 78 px | 65.8 px | fits exactly | baseline |
| 1.05 | 6 | 78 px | 69.1 px | fits exactly | ok |
| 1.10 | 5 | 77 px | 72.3 px | fits exactly | ok — **drops `SPENT`** |
| **1.15** | **5** | **77 px** | **75.6 px** | **fits exactly** | **the ceiling: +15% type** |
| 1.20 | 5 | 77 px | 78.9 px | **+1 px** | already over; passes only on the harness's 1 px tolerance |
| 1.25 | 4 | 77 px | 82.2 px | **+3 px** | clips — the 12th row loses glyph tops |

Three things follow, and all three are worth saying out loud:

1. **The honest ceiling is 1.15**, not 1.20. 1.20 measures "clean" only because the gate tolerates a
   single pixel. Documenting it as safe would be handing over a number that is already in overflow.
2. **The type gets bigger by dropping a column.** At 1.10 the priority system gives up `SPENT` to keep
   `MAX BID` un-truncated. That is the system working, but the operator should know the trade exists
   rather than discover a column vanishing as they press `+`.
3. **`columns` and `rail` cannot buy type size at 1080p.** They free up *width*, and width is not the
   scarce axis here — `?rail=off` with four forced columns still measures `MAX BID` at 65.8 px, i.e.
   identical to the default. They matter at other aspect ratios (see below) and they are what keeps a
   raised `scale` from looking cramped.

**So the largest available lever is not in this codebase.** Every figure in the table above scales
linearly with the projected image, so moving the projector back — or throwing a 10 ft image instead
of 7 ft — is worth more than the entire `scale` range. Check the image size before touching a setting.

At **4:3 the trade is different**, because there the rail is a *bottom band* rather than a side rail,
so turning it off genuinely returns vertical space: at 1024 × 768, `?rail=off` takes row height from
50 → 56 px and `MAX BID` from 40.1 → 44.1 px (+10%). Worth knowing if the projector turns out not to
be the expected 1080p.

#### The header is the one element sized from width, and it failed silently for three phases

Everything else in `theme.css` derives from viewport *height*, because the table's binding constraint
is vertical. The header is a single `nowrap` flex strip, so its constraint is horizontal, and sizing
it from height was simply wrong.

It never surfaced because `.header h1` carries `text-overflow: ellipsis`: when the strip ran out of
room, the **title silently absorbed the entire overflow** while `.header` itself never overflowed, so
every probe in the harness reported those layouts as clean. Once the harness was taught to check the
h1 specifically, the title turned out to have **9 px of the 513 px it needed at 1280 × 1024**, 67 of
386 at 1024 × 768, and 307 of 451 on a 1440 × 900 laptop. On the wall that reads as a broken app.

The fix is `clamp(14px, 2.3vw, 1em)` — the single width-derived size in the file. Two useful
properties fall out of it: it lands within a pixel of the `0.72em` value the 4:3 block had been
hand-tuned to (24.0 px vs 23.6 px at 1024 × 768), so it *replaced* that patch rather than adding to
it; and being in `vw` it is immune to `--scale`, which is correct twice over — raising the scale
should grow the *table*, not the chrome, and a taller header steals from the twelve rows the nudge is
trying to buy. That last point is what moved the ceiling above from 1.10 to 1.15.

The general lesson, recorded because it will recur: **a graceful degradation is an invisible one.**
`text-overflow: ellipsis` is the correct behaviour and also a perfect place for a layout bug to hide.
Anything with an ellipsis needs its own assertion.

### 7.2 Main board

Columns follow the league's own `AUCTION DISPLAY` vocabulary, so the board reads as a bigger
version of something they already understand.

**At 1920 × 1080 (primary target)** — full column set, ticker and nomination strip in the rail:

```
┌───────────────────────────────────────────────────────────┬─────────────────────┐
│ ZWML 2026 AUCTION    $1,412 left · 87/180 · $16/slot ● 2s │  ON THE CLOCK       │
├─────────┬───────┬──────┬───────┬─────────┬────────────────┤  ▶ Marc             │
│ MANAGER │ SPENT │ LEFT │ NEEDS │ MAX BID │ QB  RB WR TE K │    Bill             │
├─────────┼───────┼──────┼───────┼─────────┼────────────────┤    Derrick          │
│ Kevin   │  $77  │ $123 │  11   │  $113   │  1  2  1  ·  · │    ̶J̶a̶s̶o̶n̶      FULL  │
│ Corky   │  $65  │ $135 │  11   │  $125   │  ·  1  3  ·  · │    Colin            │
│ Ryan    │   $0  │ $200 │  15   │  $186   │  ·  ·  ·  ·  · │    Nick             │
│ Nick    │  $10  │ $190 │  14   │  $177   │  1  ·  ·  ·  · │                     │
│ …  (12 rows, ~75 px each)                                 │  ───────────────    │
│                                                           │  JUST SOLD          │
│                                                           │  Ja'Marr Chase      │
│                                                           │    $60 → Toby       │
│                                                           │  Bijan Robinson     │
│                                                           │    $69 → Jeff       │
│                                                           │  Puka Nacua         │
│                                                           │    $54 → Kevin      │
│                                                           │  Malik Nabers       │
│                                                           │    $41 → Corky      │
└───────────────────────────────────────────────────────────┴─────────────────────┘
   ~1300 px                                                    ~530 px

Five live nominators (`Jason` struck through and skipped, not counted toward the five) and four
sales — the budget worked out below.
```

The rail is a real improvement over the stacked ticker, not just a space trick: a **vertical** sales
list shows 4–5 recent sales legibly instead of one scrolling line, and the nomination order is a
column of names — its natural shape — instead of a horizontal strip that has to abbreviate.

**The rail's vertical budget, which review found over-subscribed.** The mock above shows six names
under ON THE CLOCK — but the league has **twelve** managers and Q10 asked for the nomination order
displayed. Showing all of it does not fit, and the mock hid that by trailing off:

| Rail content | Height |
|---|---|
| Usable rail height (1080 − header − padding) | **~1000 px** |
| `ON THE CLOCK` label | 50 |
| 12 nomination names at rail type (~44 px) | 528 |
| Divider + `JUST SOLD` label | 74 |
| 5 sales × 2 lines (player, then `$60 → Toby`) at ~40 px | 400 |
| **Demanded** | **1052 px** — over by ~50, before any breathing room |

**Resolved: the rail shows a window, not the whole cycle** — the current nominator plus the next
four, and **4** sales instead of 5. That is 5 × 44 + 50 + 74 + 320 = 664 px, leaving real slack for
line spacing and a long name wrapping. The full order is one keypress away in the roster view.

This is the right call independent of the arithmetic: the room's live question is *"who's up, and am
I next?"*, which the next four answer completely. Positions six through twelve are minutes away and
will have changed by then anyway, since a manager who fills their roster drops out of the rotation
(§7.5). Rendering seven names nobody is acting on, to squeeze the sales list that people *do* read,
would be the wrong trade. Managers who go `FULL` are struck through and skipped as the window
advances, so the window is always five *live* nominators.

**At 4:3 or narrower**, the rail collapses beneath the table as a single-line ticker plus a
horizontal strip, and columns start dropping (below). Same components, same data.

The switch keys off **aspect ratio, not width**: the same 1920 px means very different things at 16:9
and 4:3, and it is the *height* that decides whether a rail is affordable. The boundary is
`(aspect-ratio < 16 / 10)` in range syntax, because `max-aspect-ratio: 16/10` also matches *exactly*
16:10 — which sent a 1440 × 900 laptop, with ample room for the rail, into the stacked fallback.

Measured, the stacked band holds **three nominators and one sale**, not five and four: a single 983 px
band cannot hold the rail's full contents, because player names are the widest strings in the app and
two of them cropped mid-word. Same trade the column priorities make — fewer things, all legible, beats
more things torn in half.

The one **width**-keyed rule in the whole stylesheet is for phones (≤ 700 px), and only because two
things there have no priority mechanism of their own: the header's totals strip, which ran off the
right edge, and the rail, where `Christian McCaffery` is ~9.5 em and needs the full width. The totals
wrap to a second line rather than shrink, and the rail's headings go back above their content rather
than beside it. Everything else stays aspect-keyed.

A **table, not cards.** Twelve managers sharing a baseline down each column is what makes them
comparable at a glance; cards force the eye to hunt for the same number in twelve places. **One
table of 12, not two of 6** — splitting would double the row height, but two sets of column
baselines destroys the at-a-glance comparison that is the entire point.

**Column priority.** Each column declares a priority; the layout drops from the bottom up until the
board fits. At 1080p in the rail layout **nothing drops** — the priority system now exists for
phones and laptops (Q8), and as insurance if the projector changes on the day.

| Priority | Column | Rationale |
|---|---|---|
| 1 | `MANAGER` | Identity — meaningless without it |
| 1 | `MAX BID` | **The reason the display exists** |
| 2 | `LEFT` | The number people track continuously |
| 3 | `NEEDS` | Needed to sanity-check max bid |
| 4 | Position counts | Answers "what do they still need" |
| 5 | `SPENT` | **Fully redundant** — `$200 − LEFT`. First to go. |
| 6 | `$/SLOT` pace | Nice-to-have. Off by default — see below. |

**Widths — measured in phase 3, not estimated.** The review flag below was correct: the paper widths
gave the position matrix 430 px (**36% of the content width, to priority 4**) while `MAX BID` — priority
1, rendered at 1.4× type — got 185 px, and at 1080p `LEFT` rendered `$2…` for `$200` while `SPENT`
rendered `$2…` for `$201`. Corrected by measurement, as relative units rather than px so the ratios
hold at any width:

| Column | Paper | Measured | Why it moved |
|---|---|---|---|
| `MANAGER` | 210 | 210 | — |
| `SPENT` | 120 | 145 | clipped `$201` on the 2025 fixture |
| `LEFT` | 130 | 170 | clipped `$200`, at 1.06× type |
| `NEEDS` | 105 | 95 | two digits never needed 105 |
| `MAX BID` | 185 | 190 | four glyphs at 1.4× type |
| Positions (all five) | 430 | 370 | single digits; ~60 units recovered |
| `$/SLOT` (opt-in) | — | 130 | |

The default six still sum to 1180 units, so every drop threshold below is unchanged.

> The original flag, kept because the reasoning is what produced the measurement: *"the tightest
> column on the row is the one that matters most, and it is the one at risk of clipping… I am **not**
> re-tuning these numbers here: §7.1's sizes are arithmetic, and guessing twice is not better than
> measuring once."* It clipped exactly where predicted, and the fix came from the harness rather than
> from a second guess.

**The fit test is about readability, and its floor is not a constant.** Any set of columns can be
squeezed into any width, so what decides is whether each unit of relative width still maps to enough
pixels to draw the value. The first version of that test used a fixed px-per-unit floor and passed a
390 px phone board that truncated `LEFT`, `NEEDS` and `MAX BID` on all twelve rows — because type here
is sized from viewport *height* (§7.1) while the space available is a *width*, so a phone in portrait
renders nearly a laptop's type size in a third of the room. The floor is therefore a **ratio of the
root type size**: 0.0194 px per unit per px of root type, measured off `MAX BID` (the largest type on
the row, and `$186` at ~2.63 em-widths). The same test also has to subtract row gaps and padding —
~157 px of the 1298 px table at 1080p, 12% the columns never see. Ignoring them made it optimistic by
roughly one column.

What that produces at each verified resolution:

| Display | Table area | Root type | Columns |
|---|---|---|---|
| 1920 × 1080 projector | 1298 px | 47 px | all 6 |
| 1280 × 1024 (5:4) | 1229 px | 44.5 px | all 6 |
| 1024 × 768 fallback | 983 px | 33.4 px | all 6 |
| 1440 × 900 laptop | 973 px | 39.15 px | 5 — `SPENT` drops |
| 390 × 844 phone | 374 px | 36.7 px | 2 — `MANAGER`, `MAX BID` |

The laptop is the interesting one: it keeps the rail (it is ≥ 16:10), so its table is *narrower than
the 4:3 fallback's* at nearly the projector's type size. Six columns fit there arithmetically and
`MAX BID` came up 8 px short on every row. Dropping `SPENT` — redundant with `LEFT` — is the cheapest
thing in the room.

Not changed: `MAX BID` stays in column 5 rather than moving beside `MANAGER`. Review flagged the two
priority-1 columns as "split," but `SPENT → LEFT → NEEDS → MAX BID` reads left-to-right as the
derivation that produces it, and the rightmost numeric column before the matrix gives the biggest
number a clean right-aligned edge. That is a deliberate trade, not an oversight.

**Per-row `$/SLOT` is built but off by default.** It fits at 1080p, and it is `LEFT ÷ NEEDS` — two
columns already on the row — so a ninth number competes for attention while telling the room nothing
new. The league-wide figure stays in the header totals, where pace actually reads as meaningful. A
key toggles the column on if draft night proves otherwise.

- **MAX BID** — largest type on the row, right-aligned for digit alignment. `FULL` when `needs = 0`.
- **LEFT** — second most prominent. Renders negative values honestly (`−$6` in red) for historical
  years, rather than floored at `$0` as the old sheet did.
- **Position counts** — fixed-width columns so they read as a matrix. **Zero renders as a dim `·`,
  not `0`**, so unfilled needs pop out instead of drowning in a wall of zeros. `DEF` is omitted
  entirely: it is drafted before the auction and costs nothing, so it is irrelevant while bidding
  (Q5). Counts are never flagged as "too many" (§6).
- Row states: **out of money** (`maxBid = $1`) dimmed; **roster full** dimmed with `FULL`;
  **top max bid** subtly accented so the room knows who can still swing; **invalid** (overspent /
  over-rostered) flagged in warning color.
- **The top-bid accent is suppressed when more than half the field ties it.** On the opening board
  everyone with an untouched roster has the same `$186`, and the first render lit **nine of twelve
  rows** green — a highlight on the majority conveys nothing and costs the accent its meaning for the
  rest of the night. Found on screen in phase 3, not on paper.
- Default sort: **max bid descending** — the room's real question is who can outbid whom.
  Toggleable to config order or name.

### 7.3 Recent-sales ticker — derived by diffing, not by timestamp

**The sheet records no timestamps and no global pick order.** Players sit in fixed roster slots
within each manager's block, so there is no way to reconstruct "the last five sales" from a single
snapshot.

The ticker is therefore built from **successive polls**: when a player name appears in a block that
was empty on the previous poll, that is a new sale → push
`{ player, price, manager, position }` onto a capped in-memory queue. Consequences worth stating
plainly:

- Works exactly when it matters (live, during the draft) and is genuinely real-time.
- Starts **empty on page load** and fills as the draft proceeds. **Confirmed acceptable** — the
  projector will be open before the auction starts.
- **This is actually the desired behavior for keepers.** Keepers are entered in the days before the
  draft, so they are already present at page load and correctly *do not* appear as sales. The
  ticker shows live auction results only, with no special-casing needed.
- A page reload mid-draft loses ticker history unless the sale log is persisted — which §7.5 does
  anyway for the nomination pointer, so the ticker gets reload-survival for free. §5.11's optional
  change log remains the fix for durable *cross-device* history.
- A price edited after the fact produces an update, not a duplicate sale (match on
  manager + slot, not on player name).
- The queue is **capped** (8 entries); no unbounded array over a 4-hour session.

Bottom band, newest first, `Player $Price → Manager`, new entry animating in from the left with a
brief highlight, player name color-coded by position. Doubles as live confirmation that the sheet
connection is working.

### 7.4 Roster view

Second full-screen view, toggled by keyboard: every manager as a column, their 15 auction players
grouped by position with prices, plus empty placeholder rows for unfilled slots. Useful in the
endgame when the question shifts from "who has money" to "who still needs a tight end."
Auto-returns to the main board after ~30 s idle so the projector never gets stranded.

**Scope, per Q5: the Defensive Draft and Divisional Draft are excluded from the display entirely.**
Both happen *before* the auction and are not touched during it, so showing them would spend scarce
projector pixels on data that never changes. Cols `Y`/`Z` are ignored by the parser — which also
disposes of the `Jeffrey`/`Jeff` alias problem for everything except a cosmetic config entry.

### 7.5 Nomination order — fully automatic

**Confirmed wanted (Q10).** During bidding the second-most-asked question after "what's their max
bid" is "who's up next," and the answer currently lives in someone's head.

The league's rules (Q11–Q13) turn out to be exactly the ones that make this derivable rather than
guessable:

| Rule | Consequence for the display |
|---|---|
| The order is **fixed for the season**, not dynamic | Read it once at startup; never recompute |
| Nominations rotate **strictly** through that order | The pointer advances by one, deterministically |
| **Every nomination ends in a sale** | `nominations == sales`, so sales alone drive the pointer |
| A manager with a **full roster can no longer nominate** | Skip any manager at 15 picks when advancing |

So the strip needs no operator input in the normal case.

**Display:** at 1080p the order is a **vertical list at the top of the side rail** (§7.2) — current
nominator accented, the next few below it, managers who are full struck through since they are
permanently out of the rotation. A column of names is the shape this data actually wants, and the
rail costs the table no columns. Below 16:9 it collapses to the slim horizontal strip —
**ON THE CLOCK · ON DECK · then** — with the full order available in the roster view.

#### Deriving the pointer

```
advance(pointer):                       // called once per observed sale
  do  pointer = (pointer + 1) mod order.length
  while manager(order[pointer]).isFull  // skip full rosters
  // guard: if every manager is full, the auction is over — render "COMPLETE"
```

The pointer is maintained **incrementally by the diff engine** (§7.3), which already detects each
sale. That sidesteps the one genuinely hard problem: fullness must be evaluated *at the time of each
nomination*, and a single snapshot cannot tell you when a manager crossed 15 — only that they have.
Watching the sales happen gives it exactly, for free.

> **Confirmed in phase 3, by writing the shortcut and deleting it.** Building the rail against a
> static fixture invites deriving the pointer from the snapshot, and both obvious ways are wrong:
> `saleCount % order.length` diverges from the real position the moment anyone's roster fills, and
> replaying the order against *current* fullness over-advances, because a manager who is full now was
> not full on their earlier turns. That is the paragraph above, made concrete. `nominationWindow()`
> therefore takes the cursor as a parameter — phase 3 renders the window and its edge cases (skip,
> strike-through, one lap, nobody eligible → `DRAFT COMPLETE`), and phase 6 supplies the cursor on
> top of phase 5's chronological sale log.

**Keepers are not sales.** They are entered in the days before the draft, so the pointer must start
from the roster state at auction start, not from zero picks. The first successful poll establishes
that baseline — the projector is open before bidding starts (§5.11) — and it is the same baseline the
ticker already relies on for not treating keepers as sales.

**Surviving a mid-draft reload.** The pointer is a pure function of `(order, baseline, saleLog)`, so
persisting those three to `localStorage` on each change makes recovery exact rather than approximate.
Worth doing: it is a few lines, it costs nothing, and it also fixes the ticker's "reload loses
history" weakness noted in §7.3.

> ⚠️ **Keying by year is not enough, and assuming it was is a real bug.** An earlier revision's only
> guard was "keyed by year so a `?year=` test run cannot poison live state." But the year is the
> *same* during development, during §10's mandatory dress rehearsal, and on draft night. §5.9 says
> keepers are entered **progressively** in the days beforehand. So: rehearse on Tuesday against the
> live 2026 tab, enter six more keepers on Wednesday, open the board on Thursday — the restored
> baseline predates those keepers, the diff engine correctly classifies them as new sales, and the
> board opens the night with six fake `JUST SOLD` entries and the nomination pointer six managers
> ahead. The first name under **ON THE CLOCK**, at the most-watched moment of the night, is wrong.
>
> Note the blast radius, because it bounds how much this matters: `baseline` feeds only the pointer
> and the ticker. `SPENT`, `LEFT`, `NEEDS`, and `MAX BID` all derive from the *current* parse (§6),
> so **no wrong money can reach the wall from this**, and `Shift+N` can walk the pointer back. It is a
> credibility bug, not a correctness one — but it fires exactly when the room is paying most
> attention, so it is worth the three cheap guards below.

**Persistence rules.** Store `zwml:session:<year>` as
`{ savedAt, baselinePickCount, order, baseline, saleLog }`, rewriting `savedAt` on **every successful
poll**, not just on change — an open tab must never age into staleness while it sits idle during a
break in the auction.

On load, restore only if **both** hold; otherwise discard `baseline` and `saleLog`, keep `order`, and
re-baseline from the current poll:

1. **`savedAt` is recent** (~30 min). A genuine mid-draft reload is seconds old, so this keeps all of
   D13's value. Deliberately *not* a multi-hour TTL: projector-open time plus a four-hour draft would
   exceed it, and re-baselining at hour four of a live auction loses the sale log outright — worse
   than the bug it fixes.
2. **The restored state reconciles with the sheet.** If the current tab holds picks that
   `baseline + saleLog` cannot account for, **absorb them into the baseline silently** — emit no
   `SaleEvent`s and do not advance the pointer. This is the check that actually closes the hole,
   since it holds regardless of clock skew or how long the tab was shut.

Re-baselining before the auction starts is *exactly right* — nobody is full yet, so the pointer is
simply `sales mod 12` from there and the log rebuilds correctly. Re-baselining mid-draft is the
dangerous case, which is what rule 1's short window and the `savedAt`-per-poll refresh prevent.

**Make a stale restore visible rather than silent.** The status bar (§7.8) shows a
`resynced · N absorbed` chip for ~30 s after any discard-or-absorb, and the `D` overlay (§7.9) always
shows `baseline <local time> · N picks · M logged sales`. This is what turns "the board named the
wrong manager" into "the baseline is from last night" — without it the operator has no way to tell a
stale baseline from a bug in the rotation.

**Deliberately rejected:** holding the pointer and ticker inactive until the operator presses a
"start auction" key. It would close the hole, but it breaks §2's zero-config startup and §7.5's "needs
no operator input in the normal case," and it converts a one-keystroke-recoverable error into an
unrecoverable one — forget the key and there is no ticker and no pointer all night.

**Escape hatches, because draft night is unrepeatable:**

- `X` clears `zwml:session:*` and re-baselines from the next poll (§7.9). Not `Shift+R`: `R` toggles
  the roster view, and a slipped modifier mid-draft should not wipe state. Not a URL parameter
  either — a `?reset=1` left in the address bar would re-clear on every watchdog `location.reload()`.
- `N` advances, `Shift+N` retreats. The manual offset persists alongside the pointer.
- A **corrected or deleted pick** in the sheet shows up as a negative or batch diff. Never
  hand-patch the pointer for these — **recompute from the sale log**, which is why the log is the
  stored state rather than the pointer alone.
- If the derived nominator ever disagrees with the room, the room is right. The strip is a
  convenience, and it must be overridable in one keystroke without touching anything else.

**Endgame behavior worth getting right:** as managers fill up, the rotation shrinks. When one manager
alone has slots left, they nominate every remaining player — so ON DECK should read `—` rather than
repeating their name, which would look like a bug.

#### Where the order lives

**Four sources, checked in order. Three of them are editable without a deploy.**

```
  ?order=Jeff,Toby,…        the in-room override: no sheet, no network, no gid
  SETTINGS tab, `order` key durable and phone-editable (§9.2)
  cell A1 of the auction tab arrives free, in a fetch the app already makes
  league.nominationOrder    the committed last resort
```

| Option | Verdict |
|---|---|
| Hard-code in `league.ts` | Kept as the **bottom** of the chain. On its own it is a poor primary: a typo found at 7pm needs a rebuild **plus up to 10 min of Pages CDN propagation** (§10) |
| Cells **inside a band** of the auction tab | **Avoid.** That grid's geometry is verified cell-by-cell (§5.3); adding to it risks the thing the parser depends on |
| **Cell `A1`** of the auction tab | **Added.** `bandRows` starts at row 1, so A1 is outside every block — reading it cannot disturb the verified geometry, and it costs no second request |
| **A separate `SETTINGS` tab** | **Chosen as primary.** Editable from a phone and structurally isolated from the auction grid |

A1 was written off in an earlier revision as a "historical artifact" because it named `Rob`, who
drafted on Jason's behalf years ago. That was a fair reading of a stale cell and the wrong conclusion
to draw from it: the maintainer curates that cell, and on 2026-08-25 it read the correct twelve. A
cell that is *sometimes* stale is not unusable — it is a cheap source that needs validating, which
every source here needs anyway. **Both committed fixtures still carry the `Rob` spelling on purpose**,
so the test suite exercises the stale path rather than only the happy one.

Validation is the same at every level and is what makes the chain safe: an unknown or duplicated name
**rejects the whole order** and falls through to the next source. A partial rotation is a wrong
rotation, and a wall that quietly skips a manager is worse than one showing the committed copy.

**Validated against the roster the sheet reported, not against `league.managers`.** This is the part
that matters when the league changes. Checking against the committed list would reject a *correct*
order the moment a manager is swapped — and then fall back to the equally stale committed order, so
the board would be wrong in two places for one edit. Validating against the parsed roster means a new
manager can appear in A1, in the tab, or in a URL and simply work, with no deploy and no warning.
Typos are still caught, because they are on neither list.

The tab carries more than the order — the display knobs live there too, for the same
redeploy-avoidance reason. Its full format, key list, A1 anchor requirement and precedence rules are
specified in **§9.2**; this section covers only the `order` key.

> **On the earlier "zero redeploy" caveat — mostly retired.** Reading a tab requires its `gid`, and a
> gid only exists once the tab does, so `settingsTabGid` had to be committed *after* the tab was
> created. The tab now exists and its gid is committed (`361377598`, §9), so that one-time cost is
> paid. What made it a non-issue in the meantime is the A1 source: it needs no gid at all, so even
> with `settingsTabGid: null` the order was already editable without a deploy.

Since the order is fixed for the season, it is read **once at startup**, not every poll.

### 7.6 Best available by position

**Of interest (Q6), scoped as a later phase.** With a player ranking loaded, the board can answer
"who's the best remaining RB" — the question that most often stalls a live auction.

Source: the maintainer can **export players from Yahoo**. The existing `Top 300` tab (gid
`1445441490`, 323 rows) is *not usable as-is* — it is stale by roughly three seasons (it still lists
Austin Ekeler on LAC and Nick Chubb on CLE) and its `Value` column is sparsely filled. Its format,
`Justin Jefferson (MIN - WR)`, does parse cleanly into name / team / position, so a fresh export in
the same shape needs no new parser.

Two things this unlocks beyond a "best available" panel:

- **Position inference** for bench rows whose `Pos` cell was left blank (§5.4 step 3).
- **Name matching** to mark drafted players as gone — which requires fuzzy matching, since the sheet
  contains hand-typed abbreviations like `Fairbairn` and truncations like `Jameson Willi…`. Match on
  a normalized surname plus position, surface anything ambiguous in the debug overlay rather than
  guessing silently, and treat a failed match as "unknown," never as "still available."

**Deliberately last in the build order (§12).** It is the only feature that depends on data outside
the sheet, and being wrong about who is still available is worse than not offering the feature.

### 7.7 Visual language

- **Dark background.** Projector bulbs wash out dark-on-white and blast the room with a bright
  rectangle for four hours.
- High-contrast near-white on near-black; accent colors carry meaning only, never decoration.
- **Tabular numerals** everywhere so digits don't shimmy as values change.
- Position colors distinguishable under projector color shift and common color-vision
  deficiencies; color is always paired with a text label, never the sole signal.
- Motion minimal and purposeful: a changed value flashes once, briefly. No spinners, no looping
  animation, nothing that pulls the eye during bidding.

### 7.8 Status and trust

Persistent header indicator, small but always present:

- `● live · 2s` — green, seconds since last successful fetch.
- `● stale · 47s` — amber past ~3 poll intervals.
- `● offline · 4m` — red, with the age of the data on screen.
- `⚠ 3` — warning count, opening the debug overlay.
- `⚠ draft looks complete` — the §5.9 uncleared-tab heuristic.

Silently showing stale numbers as if fresh is the single most dangerous failure mode for this
display. The room must always be able to tell.

### 7.9 Keyboard controls

Single keys, no modifiers, so the operator never looks away:

| Key | Action |
|---|---|
| `F` | Fullscreen |
| `R` | Toggle roster view |
| `S` | Cycle sort |
| `N` / `Shift+N` | Nudge the nomination pointer forward / back — override only, it advances itself (§7.5) |
| `+` / `−` | Scale type up/down for the room at hand |
| `D` | Debug overlay: raw parse, warnings, sheet-vs-computed comparison, fetch timing, **baseline age and pick count** (§7.5) |
| `0` | Force immediate refetch |
| `X` | **Clear persisted session state and re-baseline from the next poll** (§7.5) — the recovery for a stale ticker or a wrong nominator |

**Phones and laptops (Q8) get no keyboard.** Anything reachable only by key must also be reachable
by tap: the roster view and sort get on-screen affordances in the compact layout, while `N`, `+`/`−`,
and `D` are operator-only and simply absent there.

---

## 8. Failure modes

| Failure | Behavior |
|---|---|
| **Wrong tab returned silently** (§5.2) | Anchor assertion fails → refuse to render, show explicit error. Prefer `gid=`. |
| **Uncleared 2026 tab** (§5.9) | "Draft looks complete" banner in the status bar. |
| Sheet un-shared / 401 | Full-screen setup instructions naming the exact Google sharing steps. |
| **No spreadsheet id resolved** (§9.1) | Full-screen setup card: paste the sheet URL. Accepts a URL or bare id, persists it, and starts polling — no redeploy. |
| **`SHEET_ID_B64` secret missing or stale** | Build still succeeds; board shows the setup card. Recoverable on the projector in seconds via `#sheet=`, without touching CI. |
| **`#sheet=` value is malformed or hostile** | Rejected by the id pattern; falls through to the next source. `csvUrl()` throws rather than fetching an attacker-shaped URL (§9.1). |
| Network drops | Last good frame stays up, amber → red with data age, backoff retry, auto-recovers. |
| Auction tab missing/renamed | Setup message listing the tabs actually found; `gid` is configured, so a rename is harmless. |
| **Template changed — rows inserted, bands moved** | Not expected (§5.3), but detected: label verification fails and names the exact cell (§5.4). Isolated mismatches warn; a missing `Total` or short manager list refuses to render. |
| **A cell gains an embedded newline** | Handled by the real CSV parser (§5.5). This already occurs at `A16` and is the reason naive line splitting is banned. |
| Empty bench rows / blank `Pos` cells | Normal, not an error. A pick requires player **and** price (§5.3). |
| **Manager overspends the $200 cap** | Now a genuine error in 2026 (Q4) → row flagged in warning color, negative `LEFT` shown honestly. |
| Manager name typo or new alias | Lands in a visible `⚠ Unmatched` row rather than vanishing. |
| Sheet formulas disagree with ours | We win (D6); disagreement is logged to the debug overlay. |
| Laptop sleeps / tab throttled | `visibilitychange` forces an immediate refetch. |
| Stale bundle after a deploy | See §10 — hashed assets, `vite:preloadError` self-reload, deploy early. |
| Wedged JS context | Watchdog: no successful poll for N minutes → `location.reload()`, guarded by a `sessionStorage` counter so it can't loop. **Registered on `window` in `main.tsx`, outside the React tree** — see below. |
| **An exception during render** | Error boundary holds the last good board and shows a warning chip. Without it React 19 unmounts the whole tree and the projector goes white — see below. |
| **Reload mid-draft** | `(order, baseline, saleLog)` restored from `localStorage`, so the ticker and nomination pointer survive exactly (§7.5). |
| **Session state left over from a rehearsal or a prior day** (§7.5) | Restore is refused if `savedAt` is older than ~30 min; unaccounted picks are **absorbed into the baseline, never replayed as sales**. Status bar shows `resynced · N absorbed`. `X` forces it manually. |
| **A pick is corrected or deleted in the sheet** | Diff shows a negative/batch change → recompute the pointer from the sale log rather than patching it (§7.5). |
| `SETTINGS` tab missing, short, or misspelled | Falls back to `config.nominationOrder`; an empty order hides the strip instead of blocking the board (§7.5). |
| **Every manager full** | Rotation is empty → strip renders `COMPLETE` rather than looping or dividing by zero. |

### 8.1 The blank-projector failure, and why the watchdog did not cover it

Review found that §2 and §4 promise the board will **"never blank the screen"** while nothing in this
design actually delivered that promise. Two compounding gaps:

1. **No error boundary.** Every failure mode above is a *data* failure, caught at the fetch or parse
   boundary. A **render** exception is different: in React 19 an uncaught error during render unmounts
   the entire tree, leaving a white page. One bad cell reaching one unguarded `.toFixed()` is enough.
2. **The watchdog would die with it.** Its trigger is "no successful poll for N minutes" — but if the
   polling loop lives in a React effect, the unmount that blanked the screen also cancels the timer
   that was supposed to notice. The recovery mechanism and the thing it recovers share a fate.

This is a bad failure for *this* product specifically. A wall display has no one sitting at it: there
is no cursor, no keyboard within reach, and nobody in the room is going to walk over and press F5
mid-auction. A white wall stays white until someone gives up on the board entirely.

**Required:**

- An error boundary wrapping the board, rendering the **last successfully derived snapshot** plus a
  `⚠ display error — recovering` chip, not a blank page and not a stack trace. The last-good snapshot
  is already retained for the network-drop case, so this reuses it.
- The **watchdog registered on `window` in `main.tsx`**, outside the component tree, so an unmount
  cannot cancel it. It must reload on *either* condition: no successful poll for N minutes, **or** the
  boundary having caught an error that a re-render did not clear.
- One test: throw from a cell renderer and assert the board still shows the prior figures and the
  chip. Cheap, and it is the only way this promise stays true after the first refactor.

---

## 9. Configuration

League rules live in one committed TypeScript file, no editing UI. **The spreadsheet id is not one
of them** — see §9.1.

```ts
export const league = {
  // No spreadsheetId here, by design (section 9.1). gids are safe to commit:
  // they identify a tab *within* a workbook and are useless without the id.
  auctionTabs: [{ year: 2026, gid: '1565415907' }, { year: 2025, gid: '599461641' }],
  budget: 200,
  minBid: 1,
  auctionSlots: 15,                       // 16 rows − 1 free DEF slot
  starterTemplate: ['QB','RB','RB','WR','WR','TE','K'],
  benchSlots: 8,
  positions: ['QB','RB','WR','TE','K'],   // DEF is not an auction slot and is not displayed (Q5)

  // Grid template — verified identical in the 2025 and 2026 tabs (§5.3).
  // All 0-indexed. Row offsets are relative to each band's manager-name row.
  bandRows: [1, 22, 43],                  // = sheet rows 2, 23, 44
  blockStartCols: [1, 7, 13, 19],         // B, H, N, T, stride 6
  rowOffsets: {
    header: 1, starters: [2, 8], bench: [9, 16],
    def: 17, total: 18, remaining: 19,
  },
  colOffsets: { pos: 0, player: 1, price: 2, statLabel: 3, statValue: 4 },

  // Board ORDER and spelling fixups — *not* who is in the league. The sheet decides
  // membership (§6); a name missing here still gets a row, under the sheet's spelling.
  managers: ['Kevin','Corky','Ryan','Toby','Jeff','Marc',
             'Bill','Derrick','Colin','Jason','Nick','Tony'],
  aliases: { Jeffrey: 'Jeff' },
  // Nomination order (§7.5), last resort only: ?order=, the SETTINGS tab and cell A1
  // all outrank it. Transcribed from the live A1 on 2026-08-25.
  nominationOrder: ['Jeff','Toby','Tony','Derrick','Marc','Corky',
                    'Bill','Ryan','Colin','Kevin','Nick','Jason'],
  settingsTabGid: '361377598',            // the SETTINGS tab now exists (§9.2)
  pollIntervalMs: 3000,
  enforceBudgetCap: true,                 // 2026: over $200 is an error (2025 allowed it)
  freeDefenseSlot: true,                  // DEF costs nothing and is drafted separately
}
```

Display preferences live separately from league rules, so layout tuning on draft night never risks
touching them: column priorities and measured widths in `ui/columns.ts`, aspect-ratio breakpoints in
`ui/theme.css`, and the runtime-settable knobs — scale, forced columns, rail, `$/SLOT`, order — in
`config/displaySettings.ts` (§9.2). Only the last group is editable without a deploy, which is the
whole point of it.

The template constants are **exact coordinates**, and the parser verifies every one of them against
its expected label on each poll (§5.4). If the maintainer ever restructures the tab, the repair is
an edit to this block rather than a parser change.

### 9.1 Where the spreadsheet id lives — and what that does and does not protect

**Requirement:** the spreadsheet location must not be stored in the git repository.

`config/sheetLocation.ts` resolves it at runtime, first hit wins:

| # | Source | Notes |
|---|---|---|
| 1 | `#sheet=<id-or-url>` fragment | **Recommended override.** A fragment is *never sent to any server*, so unlike `?sheet=` it cannot land in GitHub's access logs. Stripped from the address bar once a fetch succeeds. |
| 2 | `?sheet=<id-or-url>` query | Accepted for convenience; prefer the fragment. |
| 3 | Build-time default | Base64 in `VITE_SHEET_ID_B64`, injected by CI from the repository secret `SHEET_ID_B64`. **Never in the tree.** |
| 4 | `localStorage['zwml:sheetId']` | Remembered from a previous visit, so the operator types it at most once per browser — but only consulted when there is no CI default. |
| 5 | Nothing | Full-screen setup card: paste the sheet URL. Accepts a full URL or a bare id. |

Two ordering choices in that table are deliberate and were both wrong in the first draft:

- **Storage ranks *below* the build default.** The CI secret is the blessed configuration; storage is
  a leftover from whoever last used this browser. If storage won, an id pinned during a rehearsal
  would silently override a *corrected* secret, with nothing on screen to explain why — and the fix
  would need DevTools on the machine driving the projector. Nothing is lost by demoting it: if a
  build default exists, the operator never needed to type anything anyway.
- **An id is persisted only after a fetch proves it works** (`confirmSheetId()`, not
  `resolveSheetId()`). Otherwise a well-formed typo pasted into `#sheet=` sticks permanently and
  suppresses the very setup card meant to let the operator fix it. For the same reason the address
  bar is scrubbed on success, not on read — if the fetch fails, the operator still needs the URL they
  just typed.

Source 4 is what preserves the §2 constraint "zero-config startup: open URL, fullscreen, done." A
prompt-only design would have satisfied the security ask more strictly but put a text-entry step
between the operator and a working board minutes before a draft — and if the browser profile were
fresh or storage cleared, that step reappears. The secret gives both properties: clean repo, no
typing. Sources 1–3 exist as the escape hatch when the secret is missing or wrong.

**What this actually buys.** Being precise here matters, because it would be easy to over-read:

| Exposure | Prevented? |
|---|---|
| GitHub code search, repo clone, git history, forks | **Yes.** The id is never committed. This is the stated requirement, and it is fully met. |
| Someone grepping the deployed JS bundle for the id | **Mostly.** Base64 defeats a search for the literal string; it does not defeat anyone who reads the code around it. |
| DevTools network tab on the running board | **No.** The request URL is right there. Unavoidable for any browser-only design. |
| The dozen league members who already have the sheet link | **N/A.** They are supposed to have it. |

So this is **discoverability reduction, not access control** — it raises the cost of stumbling onto
the sheet from zero to deliberate, and nothing more. Base64 is obfuscation; calling it encryption
would be wrong. **The only real control over who can read the workbook is the sheet's own sharing
setting** (currently "anyone with the link"), and no code in this repo can change that. The standing
note in §3 still applies: everything in that workbook is public to anyone holding the link.

If genuine confidentiality is ever needed, the lever is a private sheet behind an Apps Script web
app, or a Cloudflare Access gate in front of the Pages site — both out of scope here, and both
weighed against the fact that this data is read aloud to the room as it is entered.

**Enforcement.** Two things keep this from decaying:

- `csvUrl()` validates the id against `^[A-Za-z0-9_-]{20,64}$` and the gid against `^[0-9]+$`, and
  throws otherwise. Those are the only interpolated values in any URL the app fetches, so a hostile
  `#sheet=../../evil` cannot escape the `/spreadsheets/d/<id>/export` path.
- `no-committed-sheet-id.test.ts` scans **every tracked *and* untracked-but-not-ignored file** for a
  sheet id and fails the build. A policy without a test is a wish; this one would otherwise die the
  first time someone hardcodes the id to debug something. It catches four forms: inside a Sheets URL,
  assigned to an id-shaped name (**quotes optional** — `.env` lines have none), **base64-encoded**,
  and base64 of a full URL. The base64 pass matters most: without it the guard was blind to exactly
  the encoding this section recommends, which was verified by probe — a committed
  `VITE_SHEET_ID_B64=<b64>` line walked straight past the first version of the test.

**Local development:** copy `.env.example` to `.env.local` (gitignored) and set
`VITE_SHEET_ID_B64=$(printf '%s' '<id>' | base64)`. Or just use `#sheet=` and let it persist.

**One-time setup on the repo:** add `SHEET_ID_B64` under Settings → Secrets and variables → Actions.
If it is missing the build still succeeds and the board shows its setup card — deliberately, so a
missing secret surfaces as a visible, fixable message rather than a red CI run hours before a draft.

### 9.2 The `SETTINGS` tab — display tuning without a deploy

**Why this exists.** The projector is not available until the day before the draft (revised Q7), so
§7.1's arithmetic cannot be confirmed while layout rework is still cheap. Every knob the on-site
check might want to turn therefore has to be reachable *without a rebuild* — because a rebuild that
late costs a Pages deploy plus up to 10 minutes of CDN propagation (§10), on the night, in front of
everyone. The same tab also carries the nomination order (§7.5), so it earns its keep either way.

**Layout: two columns, `key | value`, and position-independent.** Blank rows, reordered rows and
extra columns are all fine. Nothing in the parser depends on a row index, which is also what makes it
safe to read over `gviz` if `/export` is ever unavailable — `gviz` collapses empty rows (§5.0) and
would shift every index.

| `A` | `B` | Notes |
|---|---|---|
| `ZWML SETTINGS` | | **Required in A1.** See the anchor note below |
| `scale` | `1.15` | Root type multiplier. Clamped to 0.6–2.0, snapped to 0.05. **Read the ceiling in §7.1 first — it buys ~15%** |
| `columns` | `manager, left, needs, maxbid` | Forces an exact set, bypassing the priority system. Names are case-insensitive |
| `rail` | `on` / `off` | The nomination + sales rail. `off` returns *width* at 16:9, *height* at 4:3 |
| `perslot` | `off` | The opt-in `$/SLOT` column (§7.2). Also spelled `$/slot` |
| `order` | `Jeff > Toby > …` | Nomination order (§7.5). Comma-, newline- or `>`-separated. Names are checked against the roster **the sheet reported**, so a new manager needs no deploy |

**A1 must read `ZWML SETTINGS`, and that is a guard rather than decoration.** §5.2 verified that
`gviz`'s `&sheet=<name>` selector answers `status:"ok"` **with the wrong tab's data** when the name
does not match. Without an anchor, a renamed or misspelled tab would hand this parser the auction grid
and let it apply whatever happened to look like a key. With it, the wrong tab yields zero settings and
one loud warning, and the built-in defaults stand.

**A blank tab is silent — it is not a missing anchor.** The empty check runs *before* the anchor
check, because the tab spends real time empty: it has to exist before its gid can be committed, and it
sat empty in the live workbook for exactly that reason. Warning on every 3-second poll would put a
permanent complaint on screen about a tab nobody has filled in yet, and train whoever is watching to
ignore warnings on the one night they matter. The two states are safely distinguishable: the auction
grid is never blank, so "empty" cannot be the wrong-tab case the anchor guards against.

**Precedence — later wins:**

```
  defaults  <  SETTINGS tab  <  ?query=  <  the + / − keys
```

Each step up is a step closer to someone who can actually see the wall. The sheet beats the defaults
because it is durable, shared and editable from a phone. **The URL beats the sheet** because it needs
no sheet, no network, no gid and no deploy — if the tab is fumbled or unreachable at 7pm, a URL typed
into the address bar still fixes the display. The keys beat everything for `scale`, because they are
the operator standing in the room; `0` clears that nudge and hands control back to the sheet.

Two implementation notes that are easy to get wrong and were:

- **`localStorage` is written only on an actual keypress.** An earlier version persisted the scale on
  every render, so storage always held a value and permanently shadowed the `SETTINGS` tab — which
  would have presented as "editing the sheet does nothing", at 7pm, on the one night it matters.
- **Tolerant of junk, strict about ambiguity.** An unknown key warns and is ignored, because someone
  will leave a note in this tab and a comment must not take the board down. But an unknown *column
  name* rejects the whole `columns` setting, and an unknown or duplicated manager rejects the whole
  `order` — a partial rotation is a wrong rotation, and silently skipping a manager on the wall is
  worse than falling back to the committed copy. `MANAGER` and `MAX BID` are re-added if a forced set
  omits them; "the operator asked for it" is not sufficient reason to put a board on the wall that
  cannot answer who can bid what.

`src/config/displaySettings.ts` is deliberately pure — no fetch, no DOM, no React — so the entire
precedence chain is unit-tested with no network. Phase 4 supplies the grid; nothing above changes.

---

## 10. Repo layout, deploy, and testing

```
zwml_ui/
├─ docs/DESIGN.md
├─ docs/data-samples/           # real tab captures; the parser test fixtures
├─ index.html
├─ vite.config.ts               # base: './'
├─ .env.example                 # names VITE_SHEET_ID_B64; holds no value (§9.1)
├─ src/
│  ├─ main.tsx
│  ├─ vite-env.d.ts
│  ├─ config/{league,sheetLocation}.ts
│  ├─ data/{csv,sheetClient,tabs,gridParser}.ts
│  ├─ model/{derive,diff}.ts
│  ├─ ui/{Board,ManagerRow,Rail,Ticker,NominationList,RosterView,SetupCard,StatusBar,DebugOverlay}.tsx
│  └─ styles/
└─ .github/workflows/deploy.yml
```

### Hosting

Public repo, project site at `https://swankaws.github.io/zwml_ui/`, **GitHub Actions** publishing
source (Settings → Pages → Source → GitHub Actions — the only setting needed). Actions minutes are
free and unmetered on public repos. Workflow needs `permissions: { contents: read, pages: write,
id-token: write }`, an `environment: github-pages`, and `concurrency: { group: pages }`; current
action majors are `configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`,
`checkout@v7`, `setup-node@v7`.

- **`base: './'`** in Vite rather than `/zwml_ui/` — relative paths make the same build work on
  `localhost`, the Pages subpath, and any future custom domain with no rebuild. Leaving `base` at
  the default `/` is the single most common Pages failure: assets 404 and you get a white screen.
- Copy `dist/index.html` → `dist/404.html` as cheap insurance. No router, or a hash router — Pages
  has no rewrite rules and serves `404.html` with a real 404 status.
- **No private option exists for free.** Pages from a private repo needs Pro, and even then *the
  site is public* — GitHub states sites are publicly available even when the repo is private.
  Assume everything in the bundle is readable, which is fine here since there is no key to leak.
- **Only if we later want a real server-side secret or password gating:** Cloudflare Pages is the
  one free tier that provides both (free proxy function, `_headers` cache control, Cloudflare
  Access). ~20-minute migration, identical build output. Netlify's credit model pauses *all*
  projects when exhausted; Vercel Hobby is restricted to non-commercial use, which a league with
  buy-ins makes an unnecessary judgment call.

### The stale-bundle hazard

GitHub Pages serves **`cache-control: max-age=600` on everything and this cannot be changed** (no
`_headers` support), behind Fastly, with up to 10 minutes of propagation after a push. Combined
with full-site replacement per deploy, a browser holding a cached `index.html` can request hashed
asset filenames that no longer exist → 404 → white screen. Hashed filenames prevent stale *code*,
not this.

Mitigations, in order:

1. **Deploy 15+ minutes before the draft, hard-reload the projector browser once, then don't
   deploy again.** This alone solves it.
2. Open with a version query: `…/zwml_ui/?v=20260906a`.
3. Self-heal on asset 404 — worth the five lines, turns a white screen into an auto-recovery:
   ```js
   window.addEventListener('vite:preloadError', (e) => {
     e.preventDefault()
     if (!sessionStorage.getItem('reloadedOnce')) {
       sessionStorage.setItem('reloadedOnce', '1')
       location.reload()
     }
   })
   ```
4. Optional `version.txt` poll to allow a safe mid-draft hotfix.

**No service worker.** For a connected, ephemeral, live-polled display it is all downside: a
registered SW outlives the experiment and is the classic cause of "the projector shows yesterday's
build and nothing fixes it," while offline mode would only show a frozen board anyway. If one ever
gets registered, ship a one-time unregister-and-clear-caches kill switch.

### Testing

- `gridParser.ts` and `derive.ts` are pure and get real unit tests against **fixtures captured from
  the live sheet**, already saved in `docs/data-samples/`:

  | Fixture | Exercises |
  |---|---|
  | `2026-auction.csv` (63 rows, `/export`) | **Real partial state** — empty starter rows that keep their `Pos` label, empty bench rows with no label at all, `$200` cap, 3 managers with keepers and 9 at zero |
  | `2025-auction.csv` (63 rows, `/export`) | Completed draft, all 15 slots filled per manager, `"Bill "` trailing space, overspent managers, uncapped-year `Remaining` |
  | `auction-display.csv` (36 rows) | Cross-check target (§5.6) |
  | `top300.csv` (323 rows) | Ranking-parse shape only — content is stale, see §7.6 |

  > **All fixtures are `/export` captures** (2026-08-24, re-captured after §5.0). The one gviz
  > capture is kept as `2026-auction-gviz-collapsed.csv` — 43 rows instead of 63 — purely as a
  > regression fixture for the fallback path and as evidence for §5.0. **Never test the primary
  > parser against it**; it is the exact shape that produced rev 2's wrong conclusions.

  > **Both auction fixtures carry a stale `A1` naming `Rob`, and that is now load-bearing.** The live
  > cell was corrected to `Jason` the day after capture, so re-capturing would leave the order
  > validator with only its happy path tested. The captures pin the case that has to degrade
  > correctly: reject the whole order, warn, fall through (§7.5).

- **Additional hand-built fixtures required:** a fully empty tab (day-one state), a
  single-manager-complete tab, a tab with a deliberately corrupted price and an unknown manager
  name, and a **deliberately restructured tab** (one row inserted) to prove the label verification
  of §5.4 catches it loudly instead of rendering shifted garbage.
- The **partial fixture is the most important test in the suite**, because a partially filled roster
  is the state the display actually runs in for most of the draft.
- Cross-check parse output against the `AUCTION DISPLAY` tab during development (§5.6).
- `?mock=1` renders from a fixture with no network, for offline UI work and demos.
- **Layout is verified by measurement, not by looking** — `npm run verify:layout`. Unit tests run in
  jsdom, which has no layout engine, so nothing in the suite above can see a cropped row or a
  truncated cell. `tools/measure.mjs` drives headless Chrome over the DevTools Protocol (zero
  dependencies — CDP over Node 22's global `WebSocket`), sets an exact viewport with
  `Emulation.setDeviceMetricsOverride`, and reads the real DOM back: row count, whether the last row
  ends inside the viewport, ellipsised cells, rail clipping, header overflow, rail/table overlap,
  document overflow, console errors, and the computed type size of the columns that matter.
  `tools/verify-layout.mjs` runs it across **eleven cases** — 1080p mid-draft / draft-complete /
  order-unset, 1024 × 768 ×2, 1280 × 1024, 390 × 844, 1440 × 900, plus the three §9.2 escape hatches
  — and exits non-zero on any failure.

  **The escape-hatch cases are in the matrix on purpose.** `?scale=1.15`, `?rail=off` with a forced
  column set, and a scaled 4:3 only earn their keep if they work on the night, unrehearsed, on the
  first try — and the projector is not available until the day before, so there is no second chance to
  discover that they clip. The `scale=1.15` case in particular gates a *claim*: it is the documented
  ceiling in §7.1, and pinning it means a later change to header height or row chrome cannot quietly
  invalidate the number the doc tells the operator to trust. It has already earned that: shrinking the
  header moved the real ceiling from 1.10 to 1.15.

  Two probes worth calling out, because both exist to see through a *successful* degradation:

  - **`h1Truncated`.** Checking `.header` for overflow is not enough — the h1's own
    `text-overflow: ellipsis` absorbs the overflow, so the strip never reports as overflowing. This
    single check found title truncation at four of the eight resolutions, latent since phase 1 (§7.1).
  - **`rowsOverflowPx`.** `rowsClipped` answers "does it clip", which is what the gate needs, but not
    "how close is it" — which is the question behind every documented ceiling. Measuring against the
    viewport does not work: `.rows` is `overflow: hidden` with `minmax(0, 1fr)` tracks, so it always
    fills its box exactly and the overflow is entirely internal. Note the same property means
    **`docOverflow.y` cannot see a vertical clip at all** (`body` is `overflow: hidden`);
    `lastRowBottom` and these two are the only guards there.

  This paid for itself immediately and repeatedly. Screenshots showed the 4:3 layout was broken but
  not why; the harness reported `.app` measuring **1303 px inside a 1024 px viewport**, because a
  `display: grid` with no `grid-template-columns` gets one `auto` (= max-content) track and
  `body { overflow: hidden }` then cropped the right-hand end of every row in silence. It went on to
  catch: `grid-auto-rows: 1fr` flooring at min-content and cropping the twelfth manager; a
  `font-size` override that did nothing because it sat above the rule it meant to override (media
  queries carry no extra specificity, so only source order decides); `LEFT` rendering `$2…`; the rail
  cropping a player name mid-word; the 1440 × 900 column shortfall above; and the header truncating its
  own title at four resolutions. **Every one of those is invisible to a unit test and easy to miss on a
  screenshot** — the title one was invisible on a screenshot too, because an ellipsis looks deliberate.

  It has also caught the *same* specificity mistake twice, in opposite directions. The second time was
  self-inflicted while fixing the title: adding a base `.header { font-size }` rule *below* the 4:3
  media block silently killed that block's `0.72em` override, so the phone header rendered at full size
  and row height fell 44 → 36 px with the rows overflowing. The gate caught it in the same run that
  confirmed the title fix. **Adding a base rule can break a media query** — the arrow points both ways,
  and neither direction is visible in the diff.

- **Dress rehearsal is mandatory:** real projector, real laptop, real network, before draft night —
  including pulling the network cable to watch the staleness indicator do its job. Prevent OS
  interference (`caffeinate -dis` on macOS, notifications off, kiosk/fullscreen). Keep the sheet
  itself open in a second tab as the fallback display.

---

## 11. Open questions

### Resolved

| # | Question | Answer |
|---|---|---|
| Q1 | Is `2026 Auction` an uncleared copy? | Yes, deliberately duplicated; now partially cleared. Keepers being populated, will be complete before draft night. (§5.9) |
| Q2 | Roster template for 2026 | **Confirmed:** 15 auction slots + 1 free defense. |
| Q3 | Manager identity | **Jason** is the manager; **Rob** was drafting on his behalf that year. `Jeffrey` → `Jeff` alias stands. `A1` named `Rob` when the fixtures were captured; the maintainer corrected it to `Jason` on 2026-08-25, and A1 is now a live order source that validates rather than a cell the parser ignores (§7.5). |
| Q4 | Over-$200 spends | Legal in **2025 only**; `$200` is a hard cap for 2026 and the sheet is fixed. Overspend is now a genuine error state → flag it. |
| Q7 | Projector | **1920 × 1080 (16:9)** (corrected in rev 5 from 1024 × 768), with multi-resolution support required. Primary design target; note 16:9 is *shorter*, which drove the side-rail layout (§7.1). **Not available for testing until ~2026-08-28, the day before the draft** — which is why every legibility knob is settable from the `SETTINGS` tab rather than the source (§9.2), and why the measured `scale` ceiling is documented rather than left to be discovered (§7.1). |
| — | Where does the spreadsheet id live? | **Not in the repo.** Runtime resolution with a CI-secret default; base64 is obfuscation only (D14, §9.1). |
| Q5 | Show Defensive / Divisional Draft? | **No — ignore both.** They happen before the auction and are not touched during it (§7.4). |
| Q6 | Use a player ranking for "best available"? | **Yes, of interest.** Maintainer can export from Yahoo; the existing `Top 300` tab is ~3 seasons stale and unusable as-is (§7.6). Last in the build order. |
| Q8 | Phones and laptops, or projector only? | **All three, projector first.** A compact layout is a real secondary deliverable (§7.1, §7.9). |
| Q9 | Are bench position mixes constrained? | **Any combination.** Some positional caps exist but are **not in the sheet**, so position counts are never flagged as invalid (§6). |
| Q10 | Show the nomination order? | **Yes** (§7.5). |
| Q11 | Do nominations rotate strictly? | **Yes** — strictly through a fixed order, but a manager whose **roster is full can no longer nominate** and is skipped. |
| Q12 | Does every nomination end in a sale? | **Yes.** So `nominations == sales` and the pointer is fully derivable — no operator input needed (§7.5). |
| Q13 | Where does the order live? | **Fixed for the season.** Four sources, checked in order: `?order=`, the `SETTINGS` tab, cell `A1` of the auction tab, then `league.ts`. Three of the four are editable without a deploy, and each validates against the roster the sheet reported (§7.5). |
| Q14 | What **is** the 2026 nomination order? | **`Jeff > Toby > Tony > Derrick > Marc > Corky > Bill > Ryan > Colin > Kevin > Nick > Jason`** — given by the maintainer and matching the live `A1` on 2026-08-25. Committed to `league.nominationOrder` *and* already live from A1, so it renders with no further action. |
| — | Sheet vs. own data store | Keep the sheet (D7, §5.10). |
| — | Change log feasibility | Free via Apps Script `onEdit`; deferred to phase 8 (D8, §5.11). |
| — | Is the grid geometry stable? | **Yes — fixed and uniform.** An earlier revision wrongly claimed otherwise; that was a `gviz` artifact (§5.0, §5.3). |

### Open

| # | Question | Blocks |
|---|---|---|
| **Q15** | **Is `Nick` being replaced for 2026, and by whom?** The maintainer's stated order named a twelfth manager who is not `Nick`, but the live sheet says `Nick` in *both* places that matter — cell `A1` and the band-3 name cell (read 2026-08-25). One of the two is out of date and only the maintainer knows which. | Nothing. This is why membership is sheet-derived (§6) and why the order validates against the parsed roster rather than `league.managers` (§7.5): whichever name lands in the sheet gets a row and can appear in the order, with no deploy. The committed copy tracks the sheet, so it says `Nick` |

Nothing blocks implementation. Every design decision is resolved; Q15 is a data question whose two
possible answers are already both handled.

---

## 12. Build order

Each phase ends with something demonstrable.

1. ~~**Recapture fixtures via `/export`.**~~ **Done** — all fixtures re-captured 2026-08-24; repo
   scaffolded with `config/league.ts`, `data/csv.ts`, the Pages workflow, and 24 passing tests that
   lock in the §5.3 geometry against both fixtures.
2. ~~**Parser + model with tests.**~~ **Done** — `data/normalize.ts`, `data/gridParser.ts`, and
   `model/derive.ts`, 158 tests passing. The design's own claims are now assertions rather than prose:
   **zero template violations across all 24 blocks in both fixtures**; all 12 managers agree with the
   sheet on `spent`, `remaining`, `needs`, and `maxBid` on the 2026 tab; `spent` agrees for all 12 on
   2025 with exactly the six known `remaining` artifacts; and `leagueSpent` for 2025 comes to
   **$2,411**, independently matching the `AUCTION DISPLAY` tab's own total from a completely separate
   set of formulas (§5.6). The name-then-price race of §5.3 and the two §6 header bugs each have a
   dedicated test. One §5.7 error was found and corrected in the process (Nick's `$6` is correct; only
   Marc's is off).
3. **Static board at 1920 × 1080.** Full table from the partial fixture, no network. Build the
   **table + rail** shell and the column-priority system here, not later — both shape the markup.
   Verify at 1024 × 768 too, so the fallback is exercised from day one rather than discovered broken.
   **Ends with a legibility spike on the real projector** — see below.

   **Built** — `theme.css`, `App`, `Header`, `Board`, `Rail`, `nominations.ts`, and the column
   priority system, rendering from `src/dev/fixtureState.ts` (`?fixture=2025` for the completed board,
   `?demoOrder=1` for a stand-in nomination order). **208 tests passing and all eight layout cases
   green** at 1920 × 1080, 1024 × 768, 1280 × 1024, 1440 × 900 and 390 × 844. On-screen corroboration
   of the model, independent of the unit tests: the 2025 fixture renders `CHASING $0` and `$/SLOT —`
   rather than `$Infinity`, and flags exactly the five §5.7 overspenders. Seven layout defects found
   and fixed by measurement — see §10's testing notes and §7.2's width table.

   ⏳ **Still open: the projector evening.** Everything above verifies *pixels*; §7.1's claim is about
   *physical glyph size at a viewing distance*, and no harness can check that. This is the calendar
   dependency in the plan — it needs the room, not the desk.

   **Revised Q7: the projector is not available until roughly the day before the draft** (2026-08-28),
   which removes the whole point of moving this spike forward. The mitigation is to make the outcome
   *not require code*: `scale`, `columns`, `rail`, `perslot` and `order` are all now settable from the
   `SETTINGS` tab or the query string (§9.2), and the three highest-value combinations are gated by
   `verify:layout` so they are known to work unrehearsed. 243 tests and eleven layout cases green.

   **Configurable names, added on request.** "The names should be configurable" turned out to reach
   past the order into membership: the first cut gated the board on `league.managers`, so a swapped
   manager would have rendered **eleven rows with nothing to say a twelfth person existed**, and an
   order naming them would have been rejected wholesale and fallen back to the stale committed copy.
   Fixed in three places — membership derives from the sheet (§6), order validation takes the parsed
   roster instead of the committed list (§7.5), and cell `A1` became a live order source so the
   rotation was already editable without a deploy before the `SETTINGS` tab had a gid. Ten tests,
   including the swapped-roster case end to end.

   That converts a structural risk into a tuning risk, but does not erase it, and the honest limit is
   worth stating plainly: **`scale` buys about 15% and no more** (measured table in §7.1), because
   twelve rows in 1080 px is the binding constraint. If the type turns out to be too small by more than
   that, the remaining levers are physical — a larger image or a shorter viewing distance — or
   structural, i.e. the rework this phase was moved forward to avoid. Two things can be done from the
   desk before the 28th to shrink that possibility: compute the required image width from §7.1's
   linear relation once the room's longest viewing distance is known, and rehearse on a laptop at a
   proportionally scaled distance (equal angular size), which needs no projector at all.

   Deferred out of this phase deliberately: deriving the nomination **cursor** from the sheet. Two
   plausible derivations are both wrong — `saleCount % order.length` diverges from the real position
   the moment anyone's roster fills, and replaying the order against *current* fullness over-advances,
   because a manager who is full now was not full for their earlier turns. It needs the chronological
   sale sequence, which phase 5's diff engine produces, so §7.5's cursor belongs to phase 6.
   `nominationWindow()` takes the cursor as a parameter and is fully tested against it now.

   > ⚠️ **Moved forward from phase 7, per review.** Every type size in §7.1 is arithmetic, not a
   > measurement, and phase 7 was the *only* point where that assumption got tested — at the end,
   > against a hard date, with the whole layout already built on top of it. If the rehearsal says the
   > type is too small, the fix is not always a `+`/`−` nudge: it can mean dropping a column, cutting
   > the rail, or showing ten rows instead of twelve. That is structural, and structural rework is
   > exactly what you cannot absorb in the last phase.
   >
   > So: as soon as a static board renders, put it on the actual projector at the actual throw
   > distance and read it from the back of the room. One evening, no dependencies — phase 3 needs no
   > network, no live sheet, and no secret. It either confirms §7.1 or it changes the layout while
   > changing the layout is still cheap. Phase 7 then verifies rather than discovers.
4. **Live polling.** `sheetClient` on top of `sheetLocation` (§9.1) — including the setup card, since
   until the CI secret exists that card is the only way to point the app at a sheet. **This is where
   the `SETTINGS` tab gets its fetch**: `displaySettings.ts` and the full precedence chain are built
   and tested (§9.2), and `main.tsx` already wires the query-string layer, so all that remains is
   reading the tab and passing its grid to `parseSettingsGrid` **with the parsed roster**, as
   `main.tsx` already does for the query layer. `settingsTabGid` is committed (`361377598`) and the tab
   exists, so §7.5's caveat no longer gates this. Also drop `src/dev/fixtureState.ts` from the entry
   point — including its `resolveOrder`, whose A1 fallback chain moves to the live path. Change
   detection, status bar, error resilience, **the error boundary and the `window`-registered watchdog
   together** (§8.1 — the boundary without the out-of-tree watchdog leaves the blank-projector case
   half-covered). Then **leave it running overnight against the live sheet**: §2 claims "runs
   unattended ~4 hours" and nothing else in this plan tests it. ~4,800 polls surfaces timer drift,
   listener leaks, and unbounded growth for the price of walking away from a laptop.
5. **Diff engine + ticker.**
6. **Roster view + keyboard controls + nomination list.** Automatic (§7.5); it rides on phase 5's
   diff engine, so build it here rather than earlier. Include the `localStorage` persistence of
   `(order, baseline, saleLog)` — it is what makes a mid-draft reload survivable, and retrofitting
   state persistence later is always worse. **Build the staleness guards in the same pass, not as a
   follow-up** (§7.5): `savedAt` refreshed per poll, the ~30 min restore window, absorb-don't-replay
   reconciliation, the `X` reset, and the baseline readout. Two unit tests, both cheap: seed a session
   whose baseline is the 9-pick `2026-auction.csv` stamped two days old, feed a fuller-keeper fixture,
   and assert **zero** `SaleEvent`s and zero pointer advances; then repeat with `savedAt` seconds old
   and assert the sales *do* come through. Without these the rehearsal in phase 7 actively plants the
   bug it is supposed to catch.
7. **Deploy to Pages** and rehearse on real hardware. Add the `SHEET_ID_B64` secret; **measure actual
   type legibility from the back of the room** and tune with `+`/`−` — §7.1's sizes are arithmetic,
   not measurements. *Hard deadline: comfortably before draft night, per the stale-bundle mitigation
   above.*
8. **Compact layout for phones and laptops** (Q8) — same components, compact column set, tap
   affordances replacing keys.
9. *Later:* best-available-by-position from a fresh Yahoo export (§7.6), market-pace stats, position
   scarcity, sold animations, and the optional Apps Script change log (§5.11).

---

## 13. Appendix — deliberately out of scope

- **Service worker / offline caching** — §10. Adds a painful failure mode for no real gain.
- **Writing back to the sheet** — strictly read-only means the app can never corrupt the league's
  system of record.
- **A backend** — the moment one exists it costs money and can be down.
- **Fixing the sheet's formulas** — tempting, but it is the league's document and other people
  rely on it. We recompute in the app instead (D6) and surface disagreements in the debug overlay.
