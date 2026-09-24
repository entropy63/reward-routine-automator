// The streak guard — build 3's "Before the day ends" block. Pure: today's read
// and a moment in, and out comes what is still open plus how long is left to
// close it.
//
// It asks the SAME done-checks the routine asks (stepSkipReason, imported from
// verdicts.js) rather than re-deriving "is this done?" from the raw values, so
// the guard and the routine can never disagree: every row it names is a step
// the routine would still run. That is what makes its "there is still time"
// honest — it is not a second opinion, it is the same opinion, said earlier.

import { stepSkipReason, statsAreCurrent } from "./verdicts.js";

// The daily-resetting streaks, and only those. Two deliberate omissions:
//
//   claim      unclaimed points are not a streak. Nothing breaks at midnight
//              if they sit there, so warning about them would be a false alarm.
//   bingApp    the app check-in cannot be automated from a browser. Warning
//              about it would name something the user cannot fix from here,
//              which is worse than saying nothing.
//
// `detail` is the number the row shows beside its label — the read's own
// wording where there is one ("3/3"), the remaining count for the Earn tiles
// (an object, not a string), and null when the read did not answer (the row
// still shows: an unread is an unknown, and an unknown is not a "done").
const STREAK_ROWS = [
  {
    id: "search",
    label: "Search points",
    detail: stats => stats.searchPoints || null
  },
  {
    id: "dailySet",
    label: "Daily Set",
    detail: stats => (stats.activities || {}).dailySet || null
  },
  {
    id: "imageSearch",
    label: "Visual search",
    detail: stats => (stats.activities || {}).visualSearch || null
  },
  {
    id: "keepEarning",
    label: "Keep earning",
    detail: stats => {
      const counts = stats.keepEarning;
      if (!counts || typeof counts.total !== "number" || counts.total <= 0) return null;
      return `${counts.open} of ${counts.total} left`;
    }
  }
];

// Whole minutes until the next local midnight, never negative. Local on
// purpose: the streaks reset on the dashboard's own day boundary, which is the
// user's day, not UTC's.
export function minutesUntilMidnight(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 60000));
}

// The guard's verdict: { atRisk: [{ id, label, detail }], minutesLeft }, or
// null when there is nothing to say.
//
// null is returned for a stale read rather than an empty list: yesterday's
// numbers cannot say what is still open today, and a guard that guessed would
// send the user to redo work they already did. The caller renders the block
// only on a non-null answer with a non-empty atRisk, so "nothing at risk" and
// "nothing known" both stay silent — by different routes, which is the point.
export function streakRisk(stats, now = new Date()) {
  if (!statsAreCurrent(stats, now)) return null;

  const atRisk = [];
  for (const row of STREAK_ROWS) {
    // The routine's own verdict: a reason means done, so nothing is at risk.
    if (stepSkipReason(row.id, stats) != null) continue;
    atRisk.push({ id: row.id, label: row.label, detail: row.detail(stats) });
  }

  return { atRisk, minutesLeft: minutesUntilMidnight(now) };
}

// "3h 20m left" / "45m left" / "under a minute left" — the guard's own clock
// wording, kept here so the popup and any future surface phrase it the same.
export function remainingWording(minutesLeft) {
  if (minutesLeft < 1) return "under a minute left";
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  if (!hours) return `${minutes}m left`;
  if (!minutes) return `${hours}h left`;
  return `${hours}h ${minutes}m left`;
}
