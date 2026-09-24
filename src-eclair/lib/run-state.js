// The run state — ONE storage.local document instead of the twelve keys the
// v1 worker grew (status, pendingStartupSteps, routineActive, routineDay,
// routinePendingTabs, routineSkipped, searchRightSizeRun, activityToken,
// openedTabs, capturingSteps, …). Every one of those keys needed its own
// line in stopAllActivity's and onInstalled's cleanup lists, and a missed
// line was a real bug class (ADR-017). Here a stop is ONE write — null the
// document — and a fresh install is ONE remove.
//
// What deliberately does NOT live here: anything that must SURVIVE a stop,
// an update, or an eviction — lastRoutineDay (the once-per-day mark),
// lastStats (the read the verdicts judge), the activity-log rows, the query
// history. Those keep their own keys; this document is exactly "what is
// running RIGHT NOW".
//
// Shape (v1):
//   {
//     v: 1,
//     stopEpoch: 0,              // generation counter for Stop
//     activity: null | { label },          // a running non-batch activity
//     batch: null | { runId, remaining, tabId, nextRunAt },
//     rightSizeRun: null | { round, pair, freshAt },   // the verify loop,
//                                           // spans batches so it sits at
//                                           // top level, not inside batch
//     routine: null | { startDay, pendingSteps, pendingTabs, skipped },
//     captures: { capturing: [], opened: { [stepId]: number[] } }
//   }
//
// The batch-owned-status marker is structural now: v1 used status.label ===
// null to mean "the batch owns the status"; here it is simply batch != null.

const RUN_STATE = "runState";

const EMPTY_RUN_STATE = {
  v: 1,
  stopEpoch: 0,
  activity: null,
  batch: null,
  rightSizeRun: null,
  routine: null,
  captures: { capturing: [], opened: {} }
};

function normalizeCaptures(captures) {
  if (!captures || typeof captures !== "object") {
    return { capturing: [], opened: {} };
  }
  const opened = {};
  const source = captures.opened && typeof captures.opened === "object" ? captures.opened : {};
  for (const [stepId, ids] of Object.entries(source)) {
    if (Array.isArray(ids)) opened[stepId] = ids.filter(id => typeof id === "number");
  }
  return {
    capturing: Array.isArray(captures.capturing)
      ? captures.capturing.filter(id => typeof id === "string")
      : [],
    opened
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Tolerant of a corrupt or half-written document: every field falls back to
// its empty shape rather than poisoning the callers with garbage.
export async function readRunState() {
  const { [RUN_STATE]: stored } = await chrome.storage.local.get(RUN_STATE);
  if (!isPlainObject(stored)) return structuredClone(EMPTY_RUN_STATE);
  return {
    v: 1,
    stopEpoch: Number(stored.stopEpoch) || 0,
    activity: isPlainObject(stored.activity) ? { ...stored.activity } : null,
    batch: isPlainObject(stored.batch)
      ? {
          runId: Number(stored.batch.runId) || 0,
          remaining: Number(stored.batch.remaining) || 0,
          tabId: typeof stored.batch.tabId === "number" ? stored.batch.tabId : null,
          nextRunAt: Number.isFinite(stored.batch.nextRunAt) ? stored.batch.nextRunAt : null
        }
      : null,
    rightSizeRun:
      isPlainObject(stored.rightSizeRun) && Array.isArray(stored.rightSizeRun.pair)
        ? { ...stored.rightSizeRun }
        : null,
    routine: isPlainObject(stored.routine)
      ? {
          startDay: String(stored.routine.startDay || ""),
          pendingSteps: Array.isArray(stored.routine.pendingSteps)
            ? stored.routine.pendingSteps.filter(id => typeof id === "string")
            : [],
          pendingTabs: Array.isArray(stored.routine.pendingTabs)
            ? stored.routine.pendingTabs.filter(id => typeof id === "number")
            : [],
          skipped: Array.isArray(stored.routine.skipped) ? [...stored.routine.skipped] : []
        }
      : null,
    captures: normalizeCaptures(stored.captures)
  };
}

// Read-modify-write on a shared document, so the writes queue instead of
// racing (the v1 tabBookkeeping pattern, generalized to the whole document —
// tabs.onCreated capture fires concurrently with step runners mutating their
// own fields). The mutator edits a private draft; a rejection downstream of
// one task must not break the chain for the next.
let writeChain = Promise.resolve();

export function updateRunState(mutate) {
  const run = writeChain.then(async () => {
    const draft = await readRunState();
    await mutate(draft);
    await chrome.storage.local.set({ [RUN_STATE]: draft });
    return draft;
  });
  writeChain = run.catch(() => {});
  return run;
}

// ---------- Stop machinery ----------
//
// Runners capture the epoch when they start; stopAllActivity() bumps it, so
// an epoch that no longer matches means "you were stopped". Reading the
// epoch is the checkpoint; comparing is the runner's business.

export async function currentStopEpoch() {
  return (await readRunState()).stopEpoch;
}

// Stop whatever is running: the search batch, a manual run, or the startup
// routine. ONE write takes down the batch, the routine, the verification
// loop, and the tab-capture bookkeeping together — there is no fifth key
// someone could forget. The epoch bump comes first so every runner abandons
// at its next checkpoint. Stopping is not finishing: the tabs stay open
// (nothing here touches them), and lastRoutineDay is never written by a
// stop, so the next launch retries the routine.
export function stopAllActivity() {
  return updateRunState(state => {
    state.stopEpoch++;
    state.activity = null;
    state.batch = null;
    state.rightSizeRun = null;
    state.routine = null;
    state.captures = { capturing: [], opened: {} };
  });
}

// A batch that was stopped or superseded must not keep running.
export async function isStaleBatch(runId) {
  const state = await readRunState();
  return !state.batch || state.batch.runId !== runId;
}

// ---------- Manual (non-batch) activities ----------
//
// The popup's Stop button covers manual runs too. A running search batch
// owns the document's batch field, so a concurrent manual activity must
// neither clobber it on the way in nor clear it on the way out.

export async function beginActivity(label) {
  let epoch = 0;
  await updateRunState(state => {
    if (!state.batch) state.activity = { label };
    epoch = state.stopEpoch;
  });
  return epoch;
}

export async function endActivity(label) {
  // Strict label match: a null activity means the batch owns the document,
  // and clearing it on a manual run's way out would kill the batch's tick().
  await updateRunState(state => {
    if (state.activity && state.activity.label === label) state.activity = null;
  });
}

// ---------- The routine's consume-and-clear seam ----------
//
// endRoutine needs "read the routine, clear it, keep going with what you
// read" as ONE step — a stop landing between the read and the clear would
// otherwise let a stopped routine sweep its stashed tabs. Returns the
// consumed routine, or null when none is live (the no-op every caller wants
// after a stop: stopAllActivity already nulled it).
export async function consumeRoutine() {
  let consumed = null;
  await updateRunState(state => {
    if (state.routine) {
      consumed = state.routine;
      state.routine = null;
    }
  });
  return consumed;
}
