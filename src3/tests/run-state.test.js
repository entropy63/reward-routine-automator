// The one-document run state: shape, serialization, stop, consume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installChrome } from "./helpers.js";

installChrome();

const {
  readRunState,
  updateRunState,
  currentStopEpoch,
  stopAllActivity,
  isStaleBatch,
  beginActivity,
  endActivity,
  consumeRoutine
} = await import("../lib/run-state.js");

test("an empty store reads as the empty document", async () => {
  const state = await readRunState();
  assert.equal(state.v, 1);
  assert.equal(state.stopEpoch, 0);
  assert.equal(state.activity, null);
  assert.equal(state.batch, null);
  assert.equal(state.rightSizeRun, null);
  assert.equal(state.routine, null);
  assert.deepEqual(state.captures, { capturing: [], opened: {} });
});

test("a corrupt document reads as the empty document, field by field", async () => {
  await chrome.storage.local.set({
    runState: { v: "garbage", stopEpoch: "x", batch: 7, routine: [], captures: "no" }
  });
  const state = await readRunState();
  assert.equal(state.stopEpoch, 0);
  assert.equal(state.batch, null);
  assert.equal(state.routine, null);
  assert.deepEqual(state.captures, { capturing: [], opened: {} });
});

test("updateRunState serializes concurrent writes — no lost update", async () => {
  await chrome.storage.local.remove("runState");
  // 25 concurrent epoch bumps must all land.
  await Promise.all(Array.from({ length: 25 }, () => stopAllActivity()));
  assert.equal(await currentStopEpoch(), 25);
});

test("stopAllActivity takes down everything run-shaped in one write", async () => {
  await updateRunState(state => {
    state.batch = { runId: 4, remaining: 10, tabId: 99, nextRunAt: Date.now() };
    state.rightSizeRun = { round: 2, pair: [40, 60], freshAt: Date.now() };
    state.routine = {
      startDay: "2026-09-06",
      pendingSteps: ["claim"],
      pendingTabs: [1, 2],
      skipped: []
    };
    state.captures = { capturing: ["search"], opened: { search: [7] } };
  });

  const before = await currentStopEpoch();
  await stopAllActivity();

  const state = await readRunState();
  assert.equal(state.stopEpoch, before + 1);
  assert.equal(state.batch, null);
  assert.equal(state.rightSizeRun, null);
  assert.equal(state.routine, null);
  assert.deepEqual(state.captures, { capturing: [], opened: {} });
});

test("isStaleBatch: only a live batch with the same runId is current", async () => {
  await chrome.storage.local.remove("runState");
  await updateRunState(state => {
    state.batch = { runId: 9, remaining: 3, tabId: 1, nextRunAt: null };
  });
  assert.equal(await isStaleBatch(9), false);
  assert.equal(await isStaleBatch(8), true);
  await stopAllActivity();
  assert.equal(await isStaleBatch(9), true); // stopped, not just superseded
});

test("a manual activity neither clobbers a batch nor is cleared by another's end", async () => {
  await chrome.storage.local.remove("runState");
  await updateRunState(state => {
    state.batch = { runId: 1, remaining: 5, tabId: 1, nextRunAt: null };
  });

  // The batch owns the document — a manual activity stays off it.
  await beginActivity("manual run");
  assert.equal((await readRunState()).activity, null);

  // ...and without a batch, the activity lands and only its own end clears it.
  await stopAllActivity();
  const epoch = await beginActivity("manual run");
  assert.equal(typeof epoch, "number");
  assert.equal((await readRunState()).activity.label, "manual run");
  await endActivity("somebody else");
  assert.equal((await readRunState()).activity.label, "manual run");
  await endActivity("manual run");
  assert.equal((await readRunState()).activity, null);
});

test("consumeRoutine returns the routine once and clears it", async () => {
  await chrome.storage.local.remove("runState");
  await updateRunState(state => {
    state.routine = {
      startDay: "2026-09-06",
      pendingSteps: [],
      pendingTabs: [5, 6],
      skipped: [{ id: "search", reason: "already 60/60" }]
    };
  });

  const consumed = await consumeRoutine();
  assert.equal(consumed.startDay, "2026-09-06");
  assert.deepEqual(consumed.pendingTabs, [5, 6]);

  assert.equal(await consumeRoutine(), null); // a stop sees this shape
  assert.equal((await readRunState()).routine, null);
});
