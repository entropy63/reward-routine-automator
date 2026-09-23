// The verdicts, imported directly — the module the src1 extraction
// harnesses existed to fake, tested as plain functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  progressPair,
  streakDone,
  statsAreCurrent,
  stepSkipReason,
  rightSizedCount,
  judgeSettlement
} from "../pure/verdicts.js";
import { localDayKey } from "../lib/day.js";

test("progressPair reads the trailing X/Y of both stored shapes", () => {
  assert.deepEqual(progressPair("3/3"), [3, 3]);
  assert.deepEqual(progressPair("Day 4 of 7 · 1/1"), [1, 1]);
  assert.deepEqual(progressPair("  40 / 60 "), [40, 60]);
});

test("progressPair rejects anything without a trailing pair", () => {
  assert.equal(progressPair("Day 4 of 7"), null);
  assert.equal(progressPair(""), null);
  assert.equal(progressPair(null), null);
  assert.equal(progressPair(42), null);
});

test("streakDone returns the wording only when the streak is complete", () => {
  assert.equal(streakDone("3/3"), "3/3");
  assert.equal(streakDone("Day 4 of 7 · 1/1"), "Day 4 of 7 · 1/1");
  assert.equal(streakDone("2/3"), null);
  assert.equal(streakDone("0/1"), null);
});

test("statsAreCurrent answers for today only", () => {
  const now = new Date(2026, 8, 6, 18, 0, 0); // 2026-09-06 6pm local
  const today = new Date(2026, 8, 6, 0, 30, 0);
  const yesterday = new Date(2026, 8, 5, 23, 59, 59);
  assert.equal(statsAreCurrent({ at: today.getTime() }, now), true);
  assert.equal(statsAreCurrent({ at: yesterday.getTime() }, now), false);
  assert.equal(statsAreCurrent({}, now), false);
  assert.equal(statsAreCurrent(null, now), false);
});

test("stepSkipReason names the done wording per step", () => {
  assert.equal(stepSkipReason("search", { searchPoints: "60/60" }), "already 60/60");
  assert.equal(stepSkipReason("search", { searchPoints: "40/60" }), null);
  assert.equal(stepSkipReason("claim", { readyToClaim: "0" }), "nothing to claim (0 pending)");
  assert.equal(stepSkipReason("claim", { readyToClaim: "1,200" }), null);
  assert.equal(
    stepSkipReason("dailySet", { activities: { dailySet: "3/3" } }),
    "already 3/3"
  );
  assert.equal(
    stepSkipReason("imageSearch", { activities: { visualSearch: "1/1" } }),
    "already 1/1"
  );
  // A step with no done-check (stats) never skips.
  assert.equal(stepSkipReason("stats", { searchPoints: "60/60" }), null);
});

test("the keep-earning verdict skips only a fully spent, answered section", () => {
  // all spent → skip, with the count in the reason
  assert.equal(
    stepSkipReason("keepEarning", { keepEarning: { open: 0, total: 4 } }),
    "all 4 activities done"
  );
  // still-open tiles → run
  assert.equal(stepSkipReason("keepEarning", { keepEarning: { open: 1, total: 4 } }), null);
  // unread section → unknown, never a skip
  assert.equal(stepSkipReason("keepEarning", {}), null);
  assert.equal(stepSkipReason("keepEarning", { keepEarning: null }), null);
  // a section that answered with nothing usable is not "done" either
  assert.equal(stepSkipReason("keepEarning", { keepEarning: { open: 0, total: 0 } }), null);
});

test("rightSizedCount trims to the day's remainder from today's read", () => {
  const now = new Date(2026, 8, 6, 12, 0, 0);
  const stats = { at: now.getTime(), searchPoints: "40/60" };
  // 20 points left / 3 per search = 7 searches, not 30.
  assert.deepEqual(rightSizedCount(stats, 30, now), {
    count: 7,
    pair: [40, 60],
    trimmed: true
  });
});

test("rightSizedCount runs the full batch on every unknown", () => {
  const now = new Date(2026, 8, 6, 12, 0, 0);
  const fallback = { count: 30, pair: null, trimmed: false };
  // No read at all.
  assert.deepEqual(rightSizedCount(null, 30, now), fallback);
  // Yesterday's read.
  assert.deepEqual(
    rightSizedCount({ at: now.getTime() - 86400000, searchPoints: "40/60" }, 30, now),
    fallback
  );
  // No pair in the value.
  assert.deepEqual(rightSizedCount({ at: now.getTime(), searchPoints: "" }, 30, now), fallback);
  // The cap is already met — a manual run must always do the thing it was
  // pressed for.
  assert.deepEqual(
    rightSizedCount({ at: now.getTime(), searchPoints: "60/60" }, 30, now),
    fallback
  );
  // The remainder needs more than the configured batch.
  assert.deepEqual(
    rightSizedCount({ at: now.getTime(), searchPoints: "0/120" }, 30, now),
    { count: 30, pair: [0, 120], trimmed: false }
  );
});

test("judgeSettlement ends the loop at the cap, with success wording", () => {
  const run = { round: 1, pair: [40, 60] };
  const decision = judgeSettlement(run, [60, 60]);
  assert.equal(decision.verdict, "done");
  assert.equal(decision.reason, "cap");
  assert.equal(decision.ok, true);
  assert.match(decision.note, /60\/60 points, the cap is reached/);
});

test("judgeSettlement stops at max rounds while short of the cap", () => {
  const decision = judgeSettlement({ round: 3, pair: [40, 60] }, [50, 60]);
  assert.equal(decision.verdict, "done");
  assert.equal(decision.reason, "maxRounds");
  assert.equal(decision.ok, null);
});

test("judgeSettlement stops when the points did not move", () => {
  const decision = judgeSettlement({ round: 1, pair: [40, 60] }, [40, 60]);
  assert.equal(decision.verdict, "done");
  assert.equal(decision.reason, "notCounting");
  assert.equal(decision.ok, false);
});

test("judgeSettlement continues while short but moving, with the count", () => {
  const decision = judgeSettlement({ round: 1, pair: [40, 60] }, [54, 60]);
  assert.equal(decision.verdict, "continue");
  assert.equal(decision.more, 2); // 6 points / 3 per search
  assert.equal(decision.ok, null);
  assert.match(decision.note, /2 more searches/);
});

test("judgeSettlement says nothing more when the re-read is unreadable", () => {
  const decision = judgeSettlement({ round: 1, pair: [40, 60] }, null);
  assert.deepEqual(decision, { verdict: "done" });
});
