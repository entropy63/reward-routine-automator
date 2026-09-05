# Reward Routine Automator

A Chrome extension (Manifest V3) that runs the daily Microsoft Bing Rewards
routine for you — so the points arrive without the fifteen minutes of
tab-churning, every single day.

It is a single-user tool: one machine, one signed-in Bing Rewards account.
It is not a distribution product — no store listing, no multi-account
support, no onboarding.

## What it does

When Chrome starts (and on demand from the popup), the extension runs the
daily earning routine:

- **Stats read** — opens the Rewards dashboard and the Earn page, reads
  today's numbers: available points, ready-to-claim, search progress
  (e.g. `40/60`), the four activity streaks, and the Overwatch-coin reward
  options (watched only — it never redeems).
- **Claim** — presses the claim button when points are pending.
- **Daily set** — opens the day's incomplete tiles on the dashboard.
- **Keep earning** — opens the day's activities on the Earn page, skipping
  tiles already completed or marked "Reward up only".
- **Web searches** — the workhorse. See the two modes below.
- **Image search** — one random image (picsum → thecatapi → a locally drawn
  canvas fallback) fed through Bing's visual-search dialog.
- **Finish page** — a summary tab listing what's left to do yourself
  (streaks in red) and what was skipped as already done (dimmed).

### The search batch: manual or automatic

In the popup's Search gear panel, pick one:

- **Manual** — run exactly the number of searches you set. No checks.
- **Automatic** *(default)* — check how many points the day still needs,
  run only the searches still needed (3 points per search, never past the
  cap), re-check after the batch, and run more if some searches didn't
  count — up to three batches, stopping early the moment the points stop
  moving.

## Skip-when-done

The routine never repeats work today's dashboard read says is already
complete: search points at the cap, nothing pending to claim, daily set
3/3, visual search 1/1. Each skipped step is named in the Activity log —
and a manual button press always runs, whatever the numbers say.

## Human-like by design

Searches are typed character-by-character with per-keystroke jitter and
random 5–15 s gaps between queries; queries come from a five-source chain
(Bing suggestions, Google Trends, Wikipedia, random facts, an offline
generator) with repeats avoided. Tabs stay open a grace period (default
8 s) before closing so the visits register. This pacing exists to look
like a person — it is a product decision, not detection evasion, and
nothing beyond ordinary pacing is attempted.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `src/` folder.

The extension needs you signed in to bing.com in that Chrome profile —
it automates the rewards you already have; it never signs in or creates
accounts.

## Requirements

- Chrome (Chromium-based browsers with MV3 support work too — tested in
  Chromium; the popup's visuals target Chrome).
- A signed-in Bing Rewards account.
- No build step: `src/` is plain JavaScript and CSS, loaded directly.

## Permissions, in brief

| Permission | Why |
|---|---|
| `tabs` | open/reuse/close the tabs each step uses |
| `storage` | settings (synced) and runtime state (local) |
| `scripting` | inject the search typing and tile clickers into bing.com tabs |
| `alarms` | watchdog that revives the worker mid-batch |

Host access is limited to `*.bing.com` (the automation target) and the
four query/image sources (`trends.google.com`, `en.wikipedia.org`,
`uselessfacts.jsph.pl`, `picsum.photos` / `thecatapi.com`). No
`<all_urls>`, no cookies, no webRequest, no data ever leaves those hosts
or your browser: there is no server, no analytics, no account anywhere.

## Source layout

```
src/
├─ manifest.json          MV3 manifest — permissions and entry points
├─ background.js          the service worker: the routine, the batch, the reads
├─ popup.html/.js/.css    the control popup (run now, stats, activity log)
├─ popup-boot.js          pre-paint theme boot (no flash on open)
├─ confirm.html/.js/.css  the optional ask-before-running dialog
├─ routine-done.html/.js/.css  the finish page the routine opens
└─ icons/                 toolbar/action icons (generated, see scripts)
```

## Current version

**2.1.15** (see `src/manifest.json`). This repository contains only the
extension source; the development notes, architecture records (ADRs), the
test suite, and the changelog live outside it.
