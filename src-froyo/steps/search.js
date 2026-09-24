// The web-search batch: start, tick, finish, and the right-sizing
// verification loop (ADR-016). All run-state lives in the one document
// (lib/run-state.js); the verdicts are pure (pure/verdicts.js) and this
// module is their driver — it performs the effects the verdicts describe.

import { readRunState, updateRunState, currentStopEpoch, isStaleBatch } from "../lib/run-state.js";
import { getSettings } from "../lib/settings.js";
import { startKeepAlive, holdKeepAlive, releaseKeepAlive } from "../lib/keepalive.js";
import { scheduleBeat, cancelBeats } from "../lib/alarms.js";
import { randomDelayMillis, sleep } from "../lib/delays.js";
import {
  beginTabCapture,
  endTabCapture,
  claimTab,
  ensureBingTab,
  waitForTabComplete,
  closeCapturedTabs
} from "../lib/tabs.js";
import { setLastTabAction } from "../lib/log.js";
import { rightSizedCount, judgeSettlement, progressPair, POINTS_PER_SEARCH } from "../pure/verdicts.js";
import { awaitedQuery, startQueryPrefetch } from "../queries/chain.js";
import { performHumanTypedSearchOnBing } from "../injections/typed-search.js";
import { refreshStats } from "./reads.js";
import { runPendingStartupSteps } from "./routine.js";

const LAST_STATS = "lastStats";

// The verification loop's bounds: at most this many batches per loop, and a
// settle wait before the post-batch read — Bing credits a search within
// seconds, and reading immediately would misjudge the last one as not
// counted.
const RIGHT_SIZE_MAX_ROUNDS = 3;
const RIGHT_SIZE_SETTLE_MS = 10000;
// A read this old is not "the read that started this loop" — round 2+ skips
// the pre-batch read only while its own starting read is seconds fresh.
const FRESH_AT_WINDOW_MS = 120000;

// Start a new batch of web searches.
export async function startSearchBatch() {
  cancelBeats(); // a second Start must not leave two loops running

  // Stop checkpoint, covering both callers: a stop landing between the
  // routine's own checkpoint (or the popup's click) and the batch write below
  // would otherwise resurrect a batch the user just stopped. The epoch is
  // stable across the setup awaits unless a stop actually happened.
  const myEpoch = await currentStopEpoch();

  const settings = await getSettings();
  const previous = await readRunState();
  const perBatch = Math.max(1, Math.floor(settings.searchesPerBatch) || 1);

  // Right-sizing: a FRESH read first — the user's spec is "check how many
  // points there are before it starts the batch", not "trust whatever the
  // last read happened to leave". Rounds 2+ of the verification loop skip
  // it: the read that started them is seconds old (freshAt).
  const priorRun = previous.rightSizeRun;
  const continuingRun =
    priorRun && Number.isFinite(priorRun.freshAt) && Date.now() - priorRun.freshAt < FRESH_AT_WINDOW_MS
      ? priorRun
      : null;

  let sized = { count: perBatch, pair: null, trimmed: false };
  if (settings.rightSizeSearchBatch) {
    if (!continuingRun) {
      await refreshStats();
      // A stop during the read must not go on to open a batch.
      if ((await currentStopEpoch()) !== myEpoch) {
        console.log("Search batch: stopped during the pre-batch read.");
        return;
      }
    }
    const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
    sized = rightSizedCount(stats, perBatch);
  }

  const { count: batchCount, pair, trimmed } = sized;
  if (trimmed) {
    // The search step owns no Activity row, so its news rides the Tabs row —
    // the same row its skip note lands in.
    await setLastTabAction(
      `Search — right-sized to ${batchCount} of ${perBatch} searches (${pair[0]}/${pair[1]} points)`,
      null
    );
  }

  await beginTabCapture("search");
  const tabId = await ensureBingTab(previous.batch ? previous.batch.tabId : null);
  await claimTab("search", tabId);

  if ((await currentStopEpoch()) !== myEpoch) {
    // Stopped during the setup awaits. Release the capture but leave the tabs
    // open — stopping is not finishing — and never mark the batch running.
    await endTabCapture("search");
    console.log("Search batch: stopped while starting; no searches will run.");
    return;
  }

  // The loop's state: written whenever the batch started from a readable
  // partial pair (trimmed or not — "some searches do not count" needs
  // verifying either way), cleared when sizing is off or the read couldn't
  // produce a pair. The batch field IS the "running" marker — batch != null.
  // Writing it also clears any manual activity: the batch owns the document
  // now, exactly the v1 "label: null" marker, made structural.
  await updateRunState(state => {
    state.activity = null;
    state.rightSizeRun =
      settings.rightSizeSearchBatch && pair
        ? { round: continuingRun ? continuingRun.round : 1, pair }
        : null;
    state.batch = {
      runId: (previous.batch ? previous.batch.runId : 0) + 1,
      remaining: batchCount,
      tabId,
      nextRunAt: Date.now()
    };
  });

  startKeepAlive();
  startQueryPrefetch(); // the first search types without waiting on the chain
  tick(); // deliberately not awaited: the batch outlives this call
}

// One beat of the loop: run one search, schedule the next.
let tickInFlight = false;

// Re-entrancy guard: skip a tick that arrives while one is still running.
// Safe to skip — the in-flight tick's own tail calls scheduleBeat, so the
// batch is never left without a next beat.
export async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const state = await readRunState();
    const batch = state.batch;

    if (!batch) {
      cancelBeats();
      return;
    }

    if (batch.remaining <= 0) {
      await finishBatch();
      return;
    }

    // The watchdog alarm may arrive before the intended moment.
    const remainingWait = (batch.nextRunAt || 0) - Date.now();
    if (remainingWait > 500) {
      startKeepAlive();
      scheduleBeat(remainingWait, tick);
      return;
    }

    const runId = batch.runId;
    startKeepAlive();

    let tabId = batch.tabId;
    try {
      await chrome.tabs.get(tabId);
    } catch (e) {
      const tab = await chrome.tabs.create({ url: "https://www.bing.com/" });
      tabId = tab.id;
      await claimTab("search", tabId);
      // Guarded so a batch stopped while the replacement tab was opening is
      // not resurrected by this write.
      await updateRunState(s => {
        if (s.batch && s.batch.runId === runId) s.batch.tabId = tabId;
      });
    }

    // The previous search navigated this tab; the box isn't there until it loads.
    await waitForTabComplete(tabId);
    if (await isStaleBatch(runId)) return;

    const { query, api } = await awaitedQuery();
    await chrome.storage.local.set({ lastQuery: { api, text: query } });

    let busyMs = 0;
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: performHumanTypedSearchOnBing,
        args: [query]
      });
      busyMs = Number(injection && injection.result) || 0;
    } catch (e) {
      console.warn("Search injection failed:", e);
    }

    // The typing is done and the tab is navigating; the NEXT query's
    // fetch chain (storage + up to four network calls) fills the idle
    // delay window instead of gating the next keystroke.
    startQueryPrefetch();

    if (await isStaleBatch(runId)) return;

    const current = await readRunState();
    if (!current.batch || current.batch.runId !== runId) return;
    const remaining = Math.max(0, current.batch.remaining - 1);

    if (remaining <= 0) {
      await finishBatch();
      return;
    }

    const settings = await getSettings();
    const delay = busyMs + randomDelayMillis(settings.minDelaySec, settings.maxDelaySec);

    await updateRunState(s => {
      if (s.batch && s.batch.runId === runId) {
        s.batch.remaining = remaining;
        s.batch.nextRunAt = Date.now() + delay;
      }
    });
    scheduleBeat(delay, tick);
  } finally {
    tickInFlight = false;
  }
}

// The post-batch half of right-sizing: re-read the points the batch actually
// reached and, if the cap is still short but the points MOVED, start another
// right-sized batch (some searches not counting is exactly the case the
// pre-batch arithmetic can't see). Returns "continue" when it started one —
// the caller must then not run the normal batch-end path, because that
// batch's own finishBatch owns it now.
//
// The loop ends at the cap, at no movement between reads, or at
// RIGHT_SIZE_MAX_ROUNDS; every ending clears rightSizeRun so a later batch
// starts a loop of its own. The judgment itself is judgeSettlement
// (pure/verdicts.js); this is its effectful driver.
async function settleRightSizedRun() {
  const settings = await getSettings();
  if (!settings.rightSizeSearchBatch) return "done";

  const state = await readRunState();
  const run = state.rightSizeRun;
  if (!run || !Array.isArray(run.pair)) return "done";

  const myEpoch = await currentStopEpoch();

  await sleep(RIGHT_SIZE_SETTLE_MS);
  if ((await currentStopEpoch()) !== myEpoch) return "stopped";

  await refreshStats();
  if ((await currentStopEpoch()) !== myEpoch) return "stopped";

  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  const nowPair = stats ? progressPair(stats.searchPoints) : null;
  // The loop state is consumed here whatever the verdict — the rounds below
  // write their own, and a "done" leaves the field clear for a later batch.
  await updateRunState(s => {
    s.rightSizeRun = null;
  });

  const decision = judgeSettlement(run, nowPair, RIGHT_SIZE_MAX_ROUNDS, POINTS_PER_SEARCH);
  if (decision.note) await setLastTabAction(decision.note, decision.ok);
  if (decision.verdict !== "continue") return "done";

  // Short of the cap, but the points moved: run what's still needed. The
  // round-N tabs are dealt with exactly as any finished search step's are
  // (perStep closes them; routine mode stashes them for the end sweep), and
  // freshAt tells startSearchBatch its read is seconds old.
  await closeCapturedTabs("search", "closeTabsAfterSearch");
  await updateRunState(s => {
    s.rightSizeRun = { round: run.round + 1, pair: nowPair, freshAt: Date.now() };
  });
  await startSearchBatch();
  return "continue";
}

async function finishBatch() {
  cancelBeats();

  // cancelBeats() just dropped the keep-alive, and the verification below
  // (a settle wait plus a dashboard read) runs long enough that the worker
  // could be evicted mid-flight — the loop would die with the batch's state
  // still "running" (batch != null in the document).
  holdKeepAlive();
  try {
    // The verification loop: a right-sized batch re-reads what it reached and
    // may start another. On "continue" this finishBatch is done — the new
    // batch's own finishBatch runs the normal end path.
    const verdict = await settleRightSizedRun().catch(e => {
      console.warn("Search verification failed:", e);
      return "done";
    });
    if (verdict === "continue") return;

    await updateRunState(state => {
      state.batch = null;
      state.rightSizeRun = null;
      state.activity = null;
    });

    // The remaining startup steps run long enough that the worker could be
    // evicted mid-flight.
    await closeCapturedTabs("search", "closeTabsAfterSearch");
    await runPendingStartupSteps();
  } finally {
    releaseKeepAlive();
  }
}
