# Reward Routine Automator

## Description

A Manifest V3 Chrome extension that runs the daily Microsoft Bing Rewards
routine for you — the searches, the daily set, the keep-earning activities and
the claims — so the points arrive without the daily tab-churning.

Search typing is human-paced by design: character-by-character with
per-keystroke jitter, random gaps between queries, and a grace period before
tabs close so the visits register. That pacing exists to look like a person
using their own account — it is a product decision, not detection evasion, and
nothing beyond ordinary pacing is attempted.

It is a single-user tool: one machine, one signed-in Bing Rewards account. No
server, no analytics, no store listing, and nothing ever leaves the hosts the
routine touches.

The repository holds five builds of the same extension. They share the routine
and differ in module style and UI:

| # | Name | Folder | Language |
|---|---|---|---|
| 1 | Reward Routine Automator | `src/` | plain JS, classic service worker |
| 2 | the pounce | `src2/` | plain JS, ESM |
| 3 | the purr | `src3/` | plain JS, ESM |
| 4 | the meow | `src4/` | plain JS, ESM |
| 5 | the zoomies | `src5/` | React + TypeScript + Vite |

## Features

The routine is in all five builds; the later builds add to it rather than
replace it. Where a feature arrived in a later build it is marked, so
**(builds 3–5)** means that build and the ones after it, and **(build 5)**
means "the zoomies" alone.

### The routine

- **Stats read** — opens the Rewards dashboard and the Earn page and reads
  today's numbers: available points, ready-to-claim, search progress
  (e.g. `40/60`), the activity streaks, and the reward options (watched only —
  it never redeems).
- **Claim** — presses the claim button when points are pending.
- **Daily set** — opens the day's incomplete tiles on the dashboard.
- **Keep earning** — opens the day's activities on the Earn page, skipping
  tiles already completed or marked "Reward up only".
- **Web searches** — the workhorse, in two modes. **Manual** runs exactly the
  number you set. **Automatic** checks how many points the day still needs,
  runs only the searches still needed (3 points each, never past the cap),
  re-checks after the batch, and runs more while the points keep moving — up to
  three batches.
- **Image search** — one random image (picsum → thecatapi → a locally drawn
  canvas fallback) fed through Bing's visual-search dialog.
- **Finish page** — a summary of what's left to do yourself (streaks in red)
  and what was skipped as already done (dimmed). Builds 1–4 open it as its own
  page; build 5 blurs it over the dashboard.
- **Skip-when-done** — the routine never repeats work today's read says is
  already complete: search points at the cap, nothing pending to claim, daily
  set 3/3, visual search 1/1. Each skipped step is named in the activity log,
  and a manual button press always runs, whatever the numbers say.
- **On demand** — run the whole routine, or a single step, from the popup at
  any time, with a live activity log and a running status line.
- **Dry-run pre-flight** — *(build 3)*. *Run the routine* shows what the run
  would actually do before it does it: every step listed as *will open* (with
  the tabs it will open, and how many searches automatic mode needs) or *will
  skip*, with the verdict's own wording. The startup confirm dialog shows the
  same list, and Cancel opens nothing. It is built on the routine's own plan
  code, so the preview cannot disagree with the run.
- **The prowl** — *(build 5)*. Background search rounds of 2–5 searches on a
  timer of its own, inside a wait window you set (15–45 minutes by default), so
  points keep arriving between routines. On by default; one switch turns it
  off, and the window is yours to widen or narrow.
- **Scheduled daily run** — *(builds 3–5)*. Fires the routine at a time you
  pick, once a day. The wall clock is the trigger, not an alarm: a browser that
  was closed or asleep when the moment passed still runs the owed round on its
  next wake, so the day is never silently lost.
- **Evening nudge** — *(build 4)*. A notification at a time you pick naming what
  is still open today, with **Run it** and **Later** buttons on the banner
  itself — Run it starts the routine on the spot. It stays quiet on a day with
  nothing left, and it rides the same wall-clock machinery as the scheduled run,
  so it cannot be missed either.
- **Search liveness watchdog** — a periodic check that notices a batch has
  stalled and restarts it, instead of leaving it stuck part-way through.

### Searches in detail

- **Human pacing** — typing goes character by character with per-keystroke
  jitter, and a random gap (5–15 seconds by default) sits between searches.
- **Query sources** — an ordered list of where the search terms come from
  (Bing autosuggest, Google Trends, Wikipedia, useless facts, and a local
  fallback); drag them into the order you prefer.
- **Batch size** — how many searches a batch runs, plus *right-size*, which
  trims the batch to the points the day still needs rather than the raw count.

### Points and progress

- **Today** — *(builds 3–5)*. Available points with a count-up, how fresh the
  number is, ready-to-claim, the daily streak and the stamp bonus, search
  progress, today's activity streaks, and an "if the routine ran now" plan.
- **Streak guard** — *(build 3)*. A "before the day ends" block naming each
  unfinished streak and the hours left until midnight, shown only when a streak
  is genuinely at risk. It asks the routine's own done-checks, so it warns about
  exactly the work the routine would still do.
- **Last 7 days** — *(builds 4–5)*. A sparkline of recent points, with the
  points goal beside it and the recent points-per-day trend.
- **Points goal** — *(builds 4–5)*. Set a target and the Today view tracks it:
  the bar, the days left, and the trend you are on.
- **Goal alert** — *(build 4)*. A notification when the goal comes within the
  lead time you set, and another when it lands, with the real numbers. It fires
  on the crossing, not on every read, and switching it off takes the banner
  down with it.
- **Points history** — *(build 5)*. A chart of the balance over time, on the
  dashboard.
- **Membership medal** — *(build 5)*. Your Rewards tier, shown beside the
  balance.
- **Streaks** — *(build 5)*. Today's streaks as their own dashboard tile.

### Redeem, coupons and orders

- **Redeem** — reads the reward options and never redeems them. The button
  says what it will do: *Redeem* when the points are there, *View page* when
  they are not.
- **Overwatch coins** — a coin-amount picker built from the last read, priced
  in points (10 points per coin), with sold-out amounts disabled.
- **Coupons** — claims the free coupons on offer.
- **Order history** — *(build 5)*. Every order with its date and its code, a
  Copy button per code, an incremental sync that only re-reads new orders, and
  a rescan that re-reads every one.
- **Stock news** — *(build 5)*. A note whenever a coin amount flips between
  reads — restocked, or sold out.

### The dashboard — *(build 5)*

A second surface that keeps the day on screen: balance, points history,
streaks, run controls, the next routine, Overwatch coins, stock news, order
history and the activity log.

- **Layout editor** — drag a tile by its header, resize it by the grip. The
  grip snaps to the sizes that tile was designed for, so every size you can
  reach is a size the tile is built to show — no squeezed or clipped states.
- **Default layout** — one button restores the shipped arrangement.
- **Per-section reset** — with developer options on, clear one section's
  stored data without disturbing the rest.

### Tabs and cleanup

- **Close modes** — close each step's tabs as that step finishes, or sweep
  them all at the end of the routine.
- **Per-step close toggles** — decide separately for a manual run, claim,
  daily set, keep earning, web search and image search.
- **Grace delay** — tabs stay open a few seconds after the work so the visit
  registers.
- **Never close pinned tabs** — a tab you pinned is left alone.
- **Clear all tabs** — one button sweeps the routine's tabs away.

### Automation and startup

- **Run on startup** — the routine runs when the browser launches.
- **Once per day** — it will not run twice in a day.
- **Confirm first** — a countdown prompt before the routine starts, so a
  launch you did not want automated can be turned down.
- **Per-step switches and order** — turn any of the six steps off, and drag
  the list to set the sequence they run in.

### Look and feel

- **8 themes** — Catppuccin, Geist, Primer, Nord, Dracula, Tokyo, Gruvbox and
  Rosé — with light, dark or follow-system, an explicit accent color, and a
  backdrop brightness control.
- **28 animated backdrops** — from aurora and fireflies to cursor-chasing
  glows, particles that flee the pointer and a node web that links to it, down
  to flat.
- **Glass tiles** — a blur slider for the cards over the backdrop.
- **Low power mode** — *(build 5)*. One switch stills everything that moves
  and freezes the backdrops.
- **The troll** — *(build 5)*. Controls dodge the cursor as you reach for
  them. Off by default; turning it on is a deliberate choice.

### The popup

- **Four views** — Today, Run, Redeem and Activity. Reorder the tabs, hide the
  ones you do not use, and set the popup's height.
- **Live status** — a running line naming the step in progress.
- **Activity log** — what each step did, filterable down to failures only,
  with a Copy button for pasting into a bug report.
- **Developer options** — an API probe showing what the Rewards endpoints
  return, and a gate for experimental features.

## How to install

### From a release

1. Download a `.zip` from the
   [Releases](https://github.com/entropy63/reward-routine-automator/releases)
   page and unzip it. Each release carries both builds.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder — the one that
   contains `manifest.json` at its top level.

### From source

Builds 1–4 are plain JavaScript and CSS with **no build step** — point **Load
unpacked** straight at `src/`, `src2/`, `src3/` or `src4/`.

Build 5 ("the zoomies") is React + TypeScript + Vite, so build it first:

```sh
npm --prefix src5 ci
npm --prefix src5 run build
```

then load `src5/dist`.

### Either way

You must be signed in to bing.com in that browser profile — the extension
automates the rewards you already have. It never signs in or creates accounts.
