// The plan preview's pure half: today's stats + the step order in, one
// verdict per step out. The popup calls this with the lastStats it already
// holds, so the plan the user reads is computed by the same verdict code the
// routine itself runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routinePlan } from "../pure/plan.js";

const NOW = new Date(2026, 8, 6, 18, 0, 0); // 2026-09-06 6pm local
const FRESH = { at: NOW.getTime() };

test("a fresh read gives every step a verdict in the order given", () => {
  const plan = routinePlan(FRESH, ["claim", "search", "dailySet"], NOW);
  assert.deepEqual(plan.map(step => step.id), ["claim", "search", "dailySet"]);
  assert.ok(plan.every(step => step.willRun === true && step.reason === null));
});

test("a done step carries the skip verdict's own wording", () => {
  const stats = {
    ...FRESH,
    searchPoints: "60/60",
    readyToClaim: "0",
    activities: { dailySet: "3/3" }
  };
  const plan = routinePlan(stats, ["claim", "search", "dailySet", "keepEarning"], NOW);
  const byId = Object.fromEntries(plan.map(step => [step.id, step]));
  assert.equal(byId.claim.willRun, false);
  assert.equal(byId.claim.reason, "nothing to claim (0 pending)");
  assert.equal(byId.search.willRun, false);
  assert.equal(byId.search.reason, "already 60/60");
  assert.equal(byId.dailySet.willRun, false);
  assert.equal(byId.dailySet.reason, "already 3/3");
  // No done-check: always runs.
  assert.equal(byId.keepEarning.willRun, true);
  assert.equal(byId.keepEarning.reason, null);
});

test("a stale read never skips — every unknown runs", () => {
  const yesterday = new Date(2026, 8, 5, 23, 0, 0);
  const stats = { at: yesterday.getTime(), searchPoints: "60/60" };
  const plan = routinePlan(stats, ["claim", "search"], NOW);
  assert.ok(plan.every(step => step.willRun === true && step.reason === null));
});

test("no read at all is the same stale case", () => {
  const plan = routinePlan(null, ["claim", "search"], NOW);
  assert.ok(plan.every(step => step.willRun === true));
});

test("a non-array order reads as empty, not a crash", () => {
  assert.deepEqual(routinePlan(FRESH, null, NOW), []);
  assert.deepEqual(routinePlan(FRESH, "claim", NOW), []);
});

test("unknown step ids pass through with willRun (no done-check)", () => {
  const plan = routinePlan(FRESH, ["claim", "mystery"], NOW);
  assert.deepEqual(plan[1], { id: "mystery", willRun: true, reason: null });
});
