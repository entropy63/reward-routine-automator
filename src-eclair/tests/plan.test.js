// The plan preview's pure half: today's stats + the step order in, one
// verdict per step out. The popup calls this with the lastStats it already
// holds, so the plan the user reads is computed by the same verdict code the
// routine itself runs. preflight() is the same verdicts plus what each step
// would open — the dry run behind build 3's "Run the routine" button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { routinePlan, preflight } from "../pure/plan.js";

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
  // No done-check fires on a read that never answered: runs, as an unknown.
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

// ---------- preflight: the dry run ----------

test("preflight carries the routinePlan verdicts through unchanged", () => {
  const stats = { ...FRESH, searchPoints: "60/60", readyToClaim: "0" };
  const order = ["claim", "search", "dailySet", "imageSearch"];
  const rows = preflight(stats, order, null, NOW);
  // The dry run must not be a second opinion: same ids, same verdicts, same
  // wording, in the same order.
  assert.deepEqual(
    rows.map(r => ({ id: r.id, willRun: r.willRun, reason: r.reason })),
    routinePlan(stats, order, NOW)
  );
});

test("preflight says what each running step would open", () => {
  const rows = preflight(FRESH, ["claim", "dailySet", "keepEarning", "imageSearch"], null, NOW);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(byId.claim.opens, ["rewards.microsoft.com — the claim flow"]);
  assert.match(byId.dailySet.opens[0], /every Daily Set tile/);
  assert.match(byId.keepEarning.opens[0], /every open Earn tile/);
  assert.match(byId.imageSearch.opens[0], /random image search/);
});

test("a skipped step opens nothing — there is nothing to promise", () => {
  const stats = { ...FRESH, searchPoints: "60/60" };
  const rows = preflight(stats, ["search", "claim"], null, NOW);
  assert.equal(rows[0].willRun, false);
  assert.deepEqual(rows[0].opens, []);
  assert.equal(rows[1].willRun, true);
  assert.ok(rows[1].opens.length > 0);
});

test("preflight's search line is the batch the run would actually do", () => {
  // Right-sizing on (the default): 60/60 is already met, so the configured
  // batch runs — but the cap-met case is also the skip case, so use a partial
  // read to see the trim: 40/60 leaves 20 points, 20/3 → 7 searches.
  const stats = { ...FRESH, searchPoints: "40/60" };
  const rows = preflight(
    stats,
    ["search"],
    { searchesPerBatch: 30, rightSizeSearchBatch: true, minDelaySec: 5, maxDelaySec: 15 },
    NOW
  );
  assert.match(rows[0].opens[0], /^7 searches over 5–15s \(right-sized to the day's remainder\)$/);
});

test("preflight's search line is the configured batch when right-sizing is off", () => {
  const stats = { ...FRESH, searchPoints: "40/60" };
  const rows = preflight(
    stats,
    ["search"],
    { searchesPerBatch: 12, rightSizeSearchBatch: false, minDelaySec: 4, maxDelaySec: 9 },
    NOW
  );
  assert.equal(rows[0].opens[0], "12 searches over 4–9s");
});

test("preflight's tile limits follow the settings, with 0 meaning 'all of them'", () => {
  const capped = preflight(FRESH, ["dailySet", "keepEarning"], { dailySetMaxTiles: 1, keepEarningMaxTiles: 4 }, NOW);
  assert.match(capped[0].opens[0], /up to 1 Daily Set tile$/);
  assert.match(capped[1].opens[0], /up to 4 Earn tiles$/);
  const open = preflight(FRESH, ["dailySet", "keepEarning"], { dailySetMaxTiles: 0, keepEarningMaxTiles: 0 }, NOW);
  assert.match(open[0].opens[0], /every Daily Set tile/);
  assert.match(open[1].opens[0], /every open Earn tile/);
});

test("preflight degrades to a sane line, never a blank one, with no settings", () => {
  const rows = preflight(FRESH, ["search", "dailySet"], null, NOW);
  assert.ok(rows.every(r => r.opens.length > 0 && r.opens[0].length > 0));
  assert.match(rows[0].opens[0], /searches over the configured delay/);
});

test("preflight keeps the routinePlan shapes for stale and missing reads", () => {
  assert.ok(preflight(null, ["search", "claim"], null, NOW).every(r => r.willRun === true));
  assert.deepEqual(preflight(FRESH, null, null, NOW), []);
  const rows = preflight(FRESH, ["mystery"], null, NOW);
  assert.deepEqual(rows, [{ id: "mystery", willRun: true, reason: null, opens: [] }]);
});
