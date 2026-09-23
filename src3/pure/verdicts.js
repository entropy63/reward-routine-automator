// The verdicts — every judgment the worker makes about "is this already
// done?", "how big is the batch?", and "did the batch reach the cap?".
// Pure: string/number in, decision out, no chrome.* anywhere. The effectful
// halves (which storage to read, what to report, which batch to start) live
// in the steps and read these. This is the module the src1 extraction
// harnesses existed to test; here it is imported directly.

import { localDayKey } from "../lib/day.js";

// The trailing "X/Y" pair of a stat value. Both stored shapes end with it
// ("3/3" from the old tiles, "Day 4 of 7 · 3/3" from the streak cards);
// returns [done, total] or null when the value carries no pair.
export function progressPair(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

// A streak-shaped value that is complete ("3/3", "Day 4 of 7 · 1/1")
// returns the value itself (it becomes the reason's wording); null for
// anything partial, day-only or unreadable.
export function streakDone(value) {
  const pair = progressPair(value);
  return pair && pair[0] >= pair[1] ? String(value).trim() : null;
}

// A read answers for today only: every one of these values resets at
// midnight, so yesterday's "done" says nothing about today. `now` is a
// parameter, not a call, so tests can pin the day boundary.
export function statsAreCurrent(stats, now = new Date()) {
  return !!stats && typeof stats.at === "number" && localDayKey(new Date(stats.at)) === localDayKey(now);
}

// Which steps have a done-check at all. The Bing-app check-in has no entry:
// the extension cannot do it from a browser, so there is nothing to skip.
export const STEP_DONE_CHECKS = {
  // The web-search batch earns the daily search-points cap, read from the
  // Today's points breakdown ("60/60").
  search: stats => {
    const done = streakDone(stats.searchPoints);
    return done && `already ${done}`;
  },
  // "Ready to claim: 0" — the claim flow would only report "nothing to
  // claim", so the routine never opens the tab.
  claim: stats => {
    const raw =
      typeof stats.readyToClaim === "string"
        ? stats.readyToClaim.replace(/,/g, "").trim()
        : "";
    return /^\d+$/.test(raw) && Number(raw) === 0
      ? "nothing to claim (0 pending)"
      : null;
  },
  dailySet: stats => {
    const done = streakDone((stats.activities || {}).dailySet);
    return done && `already ${done}`;
  },
  // The Earn read counts the section's still-open tiles ({open, total}).
  // Skip only when a section that answered shows every tile spent — an
  // unread (null) or empty section never skips, the same
  // only-wrong-answer-is-skipping-something-not-done rule as the rest.
  keepEarning: stats => {
    const counts = stats.keepEarning;
    if (!counts || typeof counts.total !== "number" || counts.total <= 0) return null;
    return counts.open > 0 ? null : `all ${counts.total} activities done`;
  },
  // The image search earns the visual-search streak's one point.
  imageSearch: stats => {
    const done = streakDone((stats.activities || {}).visualSearch);
    return done && `already ${done}`;
  }
};

// The routine's skip verdict for a step, given today's read: a reason string
// when the numbers already show it done, null when it should run. A stale,
// missing or unreadable value never skips — the only wrong answer here is
// skipping something not actually done, so every unknown runs. (Whether a
// given read IS today's is the caller's storage business: statsAreCurrent.)
export function stepSkipReason(id, stats) {
  const check = STEP_DONE_CHECKS[id];
  if (!check) return null;
  return check(stats) || null;
}

// Points one web search earns on the account this automates (level 2:
// 3 points x 20 searches = the "60/60" cap the Today's-points card shows).
export const POINTS_PER_SEARCH = 3;

// The batch the day actually needs: with right-sizing on and today's read
// showing a partial search-points pair ("40/60"), only the remainder is
// searched — ceil(20 / 3) = 7 searches reach the cap; the configured batch
// would waste the rest. Returns { count, pair, trimmed } where pair is the
// [current, max] read (null when unreadable — verification can't judge what
// was never readable) and trimmed says whether the pair actually cut the
// count (the note only fires on a trim). Every unknown — no read, a stale
// (yesterday's) read, no pair in the value, the cap already met — runs the
// full configured batch. The 60/60 case especially: the routine's
// skip-when-done keeps the routine from ever starting a batch there, and a
// MANUAL run must always do the thing it was pressed for.
//
// `stats` may be null or stale; the today-gate is part of the verdict.
export function rightSizedCount(stats, perBatch, now = new Date(), pointsPerSearch = POINTS_PER_SEARCH) {
  const fallback = { count: perBatch, pair: null, trimmed: false };
  if (!statsAreCurrent(stats, now)) return fallback;

  const pair = progressPair(stats.searchPoints);
  if (!pair) return fallback;

  const remaining = pair[1] - pair[0];
  if (remaining <= 0) return fallback;

  const needed = Math.ceil(remaining / pointsPerSearch);
  if (needed >= perBatch) return { count: perBatch, pair, trimmed: false };

  return { count: needed, pair, trimmed: true };
}

// The post-batch verdict of the verification loop (ADR-016 §8), given the
// run's own starting pair and the pair the fresh read reached. Pure; the
// driver in steps/search.js performs the effects.
//
//   "done, cap reached"          the loop's goal — stop, report success
//   "done, max rounds"           still short after maxRounds batches — stop
//   "done, not counting"         points did not move since this loop's batch
//                                 started; more searches cannot fix that
//   "continue" (with .more)      short of the cap but the points moved —
//                                 run what's still needed
//   "done" bare                  the read is unreadable now — nothing to judge
export function judgeSettlement(run, nowPair, maxRounds = 3, pointsPerSearch = POINTS_PER_SEARCH) {
  if (!nowPair) return { verdict: "done" };

  if (nowPair[0] >= nowPair[1]) {
    return {
      verdict: "done",
      reason: "cap",
      note: `Search — ${nowPair[0]}/${nowPair[1]} points, the cap is reached`,
      ok: true
    };
  }

  if (run.round >= maxRounds) {
    return {
      verdict: "done",
      reason: "maxRounds",
      note: `Search — stopped at ${nowPair[0]}/${nowPair[1]} points after ${run.round} batches`,
      ok: null
    };
  }

  if (nowPair[0] <= run.pair[0]) {
    // Not one point since this loop's batch started: the searches are not
    // counting (app-only credit, a rate change, the dashboard's own lag), and
    // another batch would only repeat that.
    return {
      verdict: "done",
      reason: "notCounting",
      note: `Search — searches stopped counting at ${nowPair[0]}/${nowPair[1]} points`,
      ok: false
    };
  }

  // Short of the cap, but the points moved.
  const more = Math.ceil((nowPair[1] - nowPair[0]) / pointsPerSearch);
  return {
    verdict: "continue",
    more,
    note: `Search — ${nowPair[0]}/${nowPair[1]} points after the batch, ${more} more ${more === 1 ? "search" : "searches"}`,
    ok: null
  };
}
