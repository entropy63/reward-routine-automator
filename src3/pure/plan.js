// The plan preview — "what would the routine do if it ran right now?".
// Pure: today's stats + the step order in, one verdict per step out. The
// popup calls this with the lastStats it already holds, so the plan the user
// reads is computed by the SAME verdict code the routine itself runs — not a
// re-implementation that can drift from it. The routine's effectful half
// (routineStepSkipped in steps/routine.js) adds only the storage read; the
// today-gate and the per-step checks are shared, here.
//
// Two views of the same verdicts:
//   routinePlan()  id + would-run + why-not — the compact preview
//   preflight()    the same, plus WHAT each step would open — the dry run the
//                  "Run the routine" button shows before anything happens

import { statsAreCurrent, stepSkipReason, rightSizedCount } from "./verdicts.js";

// One entry per step id in the order given:
//   { id, willRun, reason }   reason is the skip verdict's wording (why it
//                             would NOT run), null when it would
// A stale, missing or unreadable read never skips — every unknown runs, the
// same only-wrong-answer-is-skipping-something-not-done direction as the
// routine. keepEarning's verdict needs the Earn read's {open, total} counts,
// so a read taken before that section answered reports willRun — an unknown,
// not a claim that there is work.
export function routinePlan(stats, order, now = new Date()) {
  const fresh = statsAreCurrent(stats, now);
  return (Array.isArray(order) ? order : []).map(id => {
    const reason = fresh ? stepSkipReason(id, stats) : null;
    return { id, willRun: !reason, reason };
  });
}

// What each step actually OPENS when it runs — the second half of the dry run.
// `settings` is the stored settings blob (or null); a step reads only the keys
// it needs, and a missing key falls back to the same default the step itself
// uses, so an unread settings blob degrades to "one tab, the usual thing"
// rather than to a blank line.
const OPEN_LINES = {
  stats: () => ["The Rewards dashboard and the Earn page (read-only)"],
  claim: () => ["rewards.microsoft.com — the claim flow"],
  dailySet: settings => {
    const max = Number(settings && settings.dailySetMaxTiles);
    return [
      max > 0
        ? `rewards.microsoft.com — up to ${max} Daily Set ${max === 1 ? "tile" : "tiles"}`
        : "rewards.microsoft.com — every Daily Set tile"
    ];
  },
  keepEarning: settings => {
    const max = Number(settings && settings.keepEarningMaxTiles);
    return [
      max > 0
        ? `rewards.microsoft.com — up to ${max} Earn ${max === 1 ? "tile" : "tiles"}`
        : "rewards.microsoft.com — every open Earn tile"
    ];
  },
  search: (settings, stats, now) => {
    const configured = Number(settings && settings.searchesPerBatch) || 30;
    // The same right-sizing the routine's batch uses, through the same pure
    // function — so the dry run's count is the count the run will do, not a
    // second guess at it.
    const auto = !settings || settings.rightSizeSearchBatch !== false;
    const { count, trimmed } = auto
      ? rightSizedCount(stats, configured, now)
      : { count: configured, trimmed: false };
    const line = `${count} ${count === 1 ? "search" : "searches"} over ${
      settings ? `${settings.minDelaySec}–${settings.maxDelaySec}s` : "the configured delay"
    }`;
    return [trimmed ? `${line} (right-sized to the day's remainder)` : line];
  },
  imageSearch: () => ["A random image search for the visual-search point"]
};

// The dry run: one row per step, each carrying what it would open. Built on
// routinePlan() so the would-run verdict and the reason are literally the same
// values the compact preview shows — the two views cannot disagree, and
// neither can disagree with the routine.
//
// `opens` is empty for a step that would be skipped: there is nothing to open,
// and saying so twice would be noise.
export function preflight(stats, order, settings = null, now = new Date()) {
  return routinePlan(stats, order, now).map(entry => {
    const build = OPEN_LINES[entry.id];
    const opens = entry.willRun && build ? build(settings, stats, now) : [];
    return { ...entry, opens };
  });
}
