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
  and what was skipped as already done (dimmed).
- **Skip-when-done** — the routine never repeats work today's read says is
  already complete: search points at the cap, nothing pending to claim, daily
  set 3/3, visual search 1/1. Each skipped step is named in the activity log,
  and a manual button press always runs, whatever the numbers say.
- **On demand** — run the whole routine, or a single step, from the popup at
  any time, with a live activity log and a running status line.

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
