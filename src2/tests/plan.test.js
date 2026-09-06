// routinePlan — the plan preview's verdicts. Pure: today's stats + the step
// order in, one verdict per step out. No chrome stub needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routinePlan } from "../pure/plan.js";

const NOW = new Date("2026-09-06T12:00:00");
const freshStats = extra => ({
  at: NOW.getTime(),
  searchPoints: "60/60",
  readyToClaim: "0",
  activities: { dailySet: "3/3", visualSearch: "Day 4 of 7 · 1/1" },
  ...extra
});
const ORDER = ["stats", "claim", "dailySet", "keepEarning", "search", "imageSearch"];

test("a fresh, everything-done read marks every checkable step done", () => {
  const plan = routinePlan(freshStats(), ORDER, NOW);
  const byId = Object.fromEntries(plan.map(s => [s.id, s]));

  assert.equal(byId.search.willRun, false);
  assert.equal(byId.search.reason, "already 60/60");
  assert.equal(byId.claim.willRun, false);
  assert.equal(byId.claim.reason, "nothing to claim (0 pending)");
  assert.equal(byId.dailySet.willRun, false);
  assert.equal(byId.dailySet.reason, "already 3/3");
  assert.equal(byId.imageSearch.willRun, false);
  assert.equal(byId.imageSearch.reason, "already Day 4 of 7 · 1/1");
});

test("steps with no done-check always run, whatever the read says", () => {
  // keepEarning's activities vary by the day; stats is the read itself.
  const plan = routinePlan(freshStats(), ORDER, NOW);
  const byId = Object.fromEntries(plan.map(s => [s.id, s]));
  assert.equal(byId.keepEarning.willRun, true);
  assert.equal(byId.keepEarning.reason, null);
  assert.equal(byId.stats.willRun, true);
  assert.equal(byId.stats.reason, null);
});

test("a stale read never skips — every unknown runs, like the routine", () => {
  const yesterday = new Date("2026-09-05T12:00:00");
  const plan = routinePlan(freshStats({ at: yesterday.getTime() }), ORDER, NOW);
  assert.ok(plan.length > 0);
  for (const step of plan) {
    assert.equal(step.willRun, true, step.id);
    assert.equal(step.reason, null, step.id);
  }
});

test("no read at all is the same honest unknown", () => {
  for (const step of routinePlan(null, ORDER, NOW)) {
    assert.equal(step.willRun, true);
    assert.equal(step.reason, null);
  }
});

test("the plan follows the order given, one entry per step", () => {
  const plan = routinePlan(freshStats(), ["imageSearch", "search"], NOW);
  assert.deepEqual(plan.map(s => s.id), ["imageSearch", "search"]);
});

test("a partial day runs the partial steps and names the done ones", () => {
  const plan = routinePlan(
    freshStats({ searchPoints: "40/60", activities: { dailySet: "1/3", visualSearch: "0/1" } }),
    ORDER,
    NOW
  );
  const byId = Object.fromEntries(plan.map(s => [s.id, s]));
  assert.equal(byId.search.willRun, true); // 40/60 — not done
  assert.equal(byId.dailySet.willRun, true); // 1/3 — not done
  assert.equal(byId.imageSearch.willRun, true); // 0/1 — not done
  assert.equal(byId.claim.willRun, false); // still nothing pending
});
