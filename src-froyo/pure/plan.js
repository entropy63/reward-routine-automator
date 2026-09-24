// The plan preview — "what would the routine do if it ran right now?".
// Pure: today's stats + the step order in, one verdict per step out. The
// popup calls this with the lastStats it already holds, so the plan the user
// reads is computed by the SAME verdict code the routine itself runs — not a
// re-implementation that can drift from it. The routine's effectful half
// (routineStepSkipped in steps/routine.js) adds only the storage read; the
// today-gate and the per-step checks are shared, here.

import { statsAreCurrent, stepSkipReason } from "./verdicts.js";

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
