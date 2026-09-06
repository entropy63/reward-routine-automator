// Order normalization: the shared repair for stale, hand-edited, or
// older-version saved orders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotMissingDefaults } from "../pure/orders.js";
import { normalizeStartupOrder, DEFAULT_STARTUP_ORDER } from "../steps/routine.js";
import { normalizeQuerySourceOrder, DEFAULT_QUERY_SOURCE_ORDER } from "../queries/sources.js";

test("slotMissingDefaults drops unknown ids and duplicates", () => {
  assert.deepEqual(
    slotMissingDefaults(["b", "b", "zzz", "a"], ["a", "b", "c"]),
    ["b", "a", "c"]
  );
});

test("slotMissingDefaults slots a missing id at its default position", () => {
  // "a" missing from the saved order lands first, not tacked on the end.
  assert.deepEqual(slotMissingDefaults(["c", "b"], ["a", "b", "c"]), ["a", "c", "b"]);
});

test("slotMissingDefaults survives null and empty", () => {
  assert.deepEqual(slotMissingDefaults(null, ["a", "b"]), ["a", "b"]);
  assert.deepEqual(slotMissingDefaults([], ["a", "b"]), ["a", "b"]);
});

test("the startup order keeps every known step exactly once", () => {
  assert.deepEqual(normalizeStartupOrder(null), DEFAULT_STARTUP_ORDER);
  const shuffled = ["imageSearch", "search", "stats", "bogus", "search"];
  const normalized = normalizeStartupOrder(shuffled);
  assert.equal(normalized.length, DEFAULT_STARTUP_ORDER.length);
  assert.equal(new Set(normalized).size, normalized.length);
  // The saved relative order survives.
  assert.ok(normalized.indexOf("imageSearch") < normalized.indexOf("search"));
  // A step the saved order predated (claim, dailySet, keepEarning) is
  // slotted back at its default position.
  assert.equal(normalized.indexOf("claim"), DEFAULT_STARTUP_ORDER.indexOf("claim"));
});

test("the query source order keeps every known source exactly once", () => {
  assert.deepEqual(normalizeQuerySourceOrder(null), DEFAULT_QUERY_SOURCE_ORDER);
  const normalized = normalizeQuerySourceOrder(["local", "wikipedia"]);
  assert.equal(normalized.length, DEFAULT_QUERY_SOURCE_ORDER.length);
  assert.equal(new Set(normalized).size, normalized.length);
  // The saved pair's relative order survives...
  assert.ok(normalized.indexOf("local") < normalized.indexOf("wikipedia"));
  // ...and the sources the saved order predated are slotted back at their
  // default positions — ahead of "local", which the default order keeps last.
  assert.equal(normalized.indexOf("bingAutosuggest"), 0);
});
