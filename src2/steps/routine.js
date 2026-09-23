// The startup routine: the ordered step sequence, its skip-when-done
// verdicts, the post-search tail, and the end-of-routine sweep. The
// routine's own state (start day, pending tail, stashed tabs, skip list) is
// one field of the run-state document rather than four storage keys — a stop
// clears all of it in the single stop write, and endRoutine consumes it
// atomically via consumeRoutine().

import { localDayKey } from "../lib/day.js";
import { getSettings, DEFAULT_SETTINGS } from "../lib/settings.js";
import { readRunState, updateRunState, currentStopEpoch, consumeRoutine } from "../lib/run-state.js";
import { holdKeepAlive, releaseKeepAlive } from "../lib/keepalive.js";
import { sleep } from "../lib/delays.js";
import { closeTabs } from "../lib/tabs.js";
import { setLastTabAction, setLastRewards, reportImageSearch } from "../lib/log.js";
import { slotMissingDefaults } from "../pure/orders.js";
import { STEP_DONE_CHECKS, statsAreCurrent, stepSkipReason } from "../pure/verdicts.js";
import { refreshStats, checkRedeemAvailability } from "./reads.js";
import { startSearchBatch } from "./search.js";
import { runStartupClaim } from "../readers/claim.js";
import {
  openDailySetOnRewardsDashboard,
  openKeepEarningActivities
} from "../readers/rewards-section.js";
import { runRandomImageSearch } from "../images/image-search.js";

const LAST_ROUTINE_DAY = "lastRoutineDay";
const LAST_STATS = "lastStats";
// How long the routine's cancel-before-start dialog waits for an answer
// before silence counts as consent.
const ROUTINE_CONFIRM_TIMEOUT_MS = 15000;
// The routine's finish page (Stage 3 ports the page itself): endRoutine()
// opens it with the streak summary in the ?q= query instead of leaving a
// blank tab behind.
const ROUTINE_DONE_URL = "routine-done.html";

// ---------- The step registry ----------

// The startup steps, keyed by the ids stored in settings.startupOrder.
// popup.html mirrors these ids in each row's data-step attribute.
const STARTUP_STEPS = {
  // First key on purpose: normalizeStartupOrder() slots a step missing from a
  // saved order at its default index, so existing users get the stats read
  // slotted first, matching the new default order — it must reflect the day
  // before the steps churn the dashboard.
  stats: {
    enabledKey: "statsStartupEnabled",
    run: () => runStartupReads()
  },
  claim: {
    enabledKey: "claimStartupEnabled",
    run: () => runStartupClaim()
  },
  dailySet: {
    enabledKey: "dailySetStartupEnabled",
    run: () => openDailySetOnRewardsDashboard()
  },
  keepEarning: {
    enabledKey: "keepEarningStartupEnabled",
    run: () => openKeepEarningActivities()
  },
  search: {
    enabledKey: "searchStartupEnabled",
    run: () => startSearchBatch()
  },
  imageSearch: {
    enabledKey: "imageSearchStartupEnabled",
    run: () => runRandomImageSearch()
  }
};

export const DEFAULT_STARTUP_ORDER = Object.keys(STARTUP_STEPS);

// Tolerates a stale or hand-edited value: unknown ids and duplicates go, and
// anything missing is slotted into its default position. Mirrored in popup.js.
export function normalizeStartupOrder(order) {
  return slotMissingDefaults(order, DEFAULT_STARTUP_ORDER);
}

// The routine's opening reads, as one step: the Rewards stats (dashboard +
// Earn pages, merged) and the redeem watch. Grouped because the popup's
// Refresh button asks for the same two reads together, and neither throws —
// a page that won't load costs the sequence one console.warn, not the
// routine. As a step it can be turned off (statsStartupEnabled) and dragged
// around like any other; the default order keeps it first so the numbers
// still reflect the day before the steps churn the dashboard.
async function runStartupReads() {
  await refreshStats();
  await checkRedeemAvailability();
}

// ---------- Skip-when-done ----------

// The routine's skip verdict for a step: a reason string when today's read
// already shows it done, null when it should run. The verdicts themselves
// are pure (pure/verdicts.js); this adds the one effect they refuse to have
// — reading today's stats.
async function routineStepSkipped(id) {
  if (!STEP_DONE_CHECKS[id]) return null;

  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  if (!statsAreCurrent(stats)) return null;

  return stepSkipReason(id, stats);
}

// A skipped step says so in the Activity section, in its own row where it
// has one. The search step owns no row (its rows show the last query, which
// a skip must not fabricate), so its note lands in the Tabs row — the
// routine's news row, which already carries the end-of-routine sweep line.
async function reportSkippedStep(id, reason) {
  const labels = {
    search: "Search",
    claim: "Claim",
    dailySet: "Daily set",
    keepEarning: "Keep earning",
    imageSearch: "Image search"
  };
  const detail = `${labels[id] || id} — skipped, ${reason}`;
  if (id === "claim" || id === "dailySet" || id === "keepEarning") {
    await setLastRewards(detail, null);
  } else if (id === "imageSearch") {
    await reportImageSearch(`skipped, ${reason}`, null);
  } else {
    await setLastTabAction(detail, null);
  }
  // The finish page names what was skipped: the record rides in the run-state
  // document because the post-search tail finishes in a later worker
  // instance, and endRoutine() consumes it when the page opens.
  await updateRunState(state => {
    if (state.routine) state.routine.skipped.push({ id, reason });
  });
}

// ---------- The confirm dialog ----------

// Resolver of the routine's cancel-before-start dialog: the answer message
// and the awaiting confirmRoutineStart() are separate functions, so the live
// prompt's outcome crosses through here. Null while no prompt is waiting —
// which is what makes a stale click after the timeout a no-op.
let routineConfirmResolver = null;
// Window id of that dialog, so windows.onRemoved (wired in background.js)
// can tell it from any other window.
let routineConfirmWindowId = null;

// The routine's cancel-before-start dialog. Resolves true when the routine
// may run ("Start now", the timeout, or no windows API to ask with) and
// false when the user cancelled. The wait lives inside the async onStartup
// handler, within the worker's 30s idle window — same pattern as the
// grace-period sleeps in closeCapturedTabs().
export function confirmRoutineStart() {
  // Very old Chrome: no API to ask with, so the routine is never blocked on it.
  if (!(chrome.windows && chrome.windows.create)) {
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    let settled = false;

    const settle = proceed => {
      if (settled) return;
      settled = true;
      routineConfirmResolver = null;
      // Taking the dialog down fires onRemoved too; the nulled resolver above
      // is what makes that a no-op. The remove() itself can reject if the
      // window is already gone — fine either way.
      if (routineConfirmWindowId != null) {
        chrome.windows.remove(routineConfirmWindowId).catch(() => {});
        routineConfirmWindowId = null;
      }
      resolve(proceed);
    };

    // Handed to the answer message and the onRemoved listener; nulled by
    // settle() after use, so a click arriving after the outcome is a no-op.
    routineConfirmResolver = settle;

    // The 15s window: silence means the user is away, and this is an
    // automator — proceed rather than dropping the routine on the floor.
    setTimeout(() => settle(true), ROUTINE_CONFIRM_TIMEOUT_MS);

    chrome.windows
      .create({
        url: "confirm.html",
        type: "popup",
        width: 420,
        height: 220,
        focused: true
      })
      .then(win => {
        // The prompt never went up — the routine must not hang waiting on an
        // answer nobody can give.
        if (!win) {
          console.warn("Startup: confirm dialog could not be shown.");
          settle(true);
          return;
        }
        routineConfirmWindowId = win.id;
      })
      .catch(e => {
        console.warn("Startup: confirm dialog could not be shown:", e);
        settle(true);
      });
  });
}

// The dialog's buttons reporting in (handleMessage "routineConfirmAnswer").
// A stale message after the prompt settled finds a nulled resolver and is a
// no-op.
export function answerRoutineConfirm(proceed) {
  if (routineConfirmResolver) routineConfirmResolver(proceed === true);
}

// The dialog's window closing without an answer (windows.onRemoved, wired in
// background.js). Dismissing the dialog is an explicit gesture, so closing
// the window counts as Cancel — only the 15s timeout (user away) proceeds on
// its own.
export function routineConfirmWindowRemoved(windowId) {
  if (windowId !== routineConfirmWindowId || !routineConfirmResolver) return;
  routineConfirmResolver(false);
}

// ---------- The finish page's queries ----------

// The finish page's streak summary, built from the last stats read: which
// activities read as not-done, as "key:label;key:label" (the query the page
// parses). A display string's trailing progress pair is the verdict — the
// same parse the popup's Bing-app banner uses, so the page and the banner
// can never disagree about whether a streak is done. A null or unparseable
// value never enters the query: the page should say "every streak is
// complete" only when a read actually answered, not because a value went
// missing. Returns "" when every answered streak is done — a query-less page
// is the plain "The daily routine finished."
export async function routineSummaryQuery() {
  return chrome.storage.local.get(LAST_STATS).then(({ [LAST_STATS]: stats }) => {
    const activities = (stats && stats.activities) || {};
    const parts = [];
    for (const key of ["bingSearch", "dailySet", "bingApp", "visualSearch"]) {
      const value = activities[key];
      const match = String(value == null ? "" : value).match(/(\d+)\s*\/\s*(\d+)\s*$/);
      if (!match) continue; // not answered — no verdict to report
      const done = Number(match[1]) >= Number(match[2]) && Number(match[2]) > 0;
      if (!done) parts.push(`${key}:${value}`);
    }
    return parts.join(";");
  });
}

// The finish page's skip list: which steps the routine skipped as already
// done, as "id:reason;id:reason" (the ?s= query the page parses — the same
// compact shape the streak summary's ?q= uses). Reasons come from the
// routine's own verdicts, which carry no ";" or ":"; an entry that somehow
// does is dropped rather than mis-parsed.
export function routineSkippedQuery(skipped) {
  return (Array.isArray(skipped) ? skipped : [])
    .filter(
      entry =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.reason === "string" &&
        entry.id &&
        entry.reason &&
        !entry.id.includes(":") &&
        !entry.reason.includes(":") &&
        !entry.reason.includes(";")
    )
    .map(entry => `${entry.id}:${entry.reason}`)
    .join(";");
}

// ---------- The sequence ----------

export async function runStartupSequence() {
  const settings = await getSettings();

  // A stop during an earlier step must also cancel the steps not started yet:
  // stopAllActivity() bumps the epoch, and a mismatch means "stopped".
  const myEpoch = await currentStopEpoch();

  // A sequence interrupted by the last shutdown must not resume now that a
  // fresh one is starting, and tab ids from the last session are meaningless.
  // The start day goes too: whatever it held belongs to the dead sequence.
  // One write: the routine field and the capture bookkeeping are both inside
  // the document.
  await updateRunState(state => {
    state.routine = null;
    state.captures = { capturing: [], opened: {} };
  });

  if (!settings.startupEnabled) return;

  // Once per day: if the routine already completed today, don't redo it on a
  // second browser launch. The stale-state cleanup above has already run by
  // here, which is what we want either way — the skip is the whole routine.
  // (LAST_ROUTINE_DAY stays a key of its own, outside the document: it is
  // the whole point that it survives stops, updates and evictions.)
  if (settings.startupOncePerDay) {
    const { [LAST_ROUTINE_DAY]: lastDay } = await chrome.storage.local.get(
      LAST_ROUTINE_DAY
    );
    if (lastDay === localDayKey()) {
      console.log("Startup: routine already ran today — skipping.");
      return;
    }
  }

  // Last gate: with "Ask before running" on, the user gets a 15s window to
  // cancel before a single tab opens. It sits after the once-per-day skip on
  // purpose — there is nothing to ask about when the routine would not run
  // anyway — and before the routine field is set, so a cancel leaves nothing
  // routine-shaped behind.
  if (settings.confirmBeforeRoutine && !(await confirmRoutineStart())) {
    // Cancel: same shape as the once-per-day skip above — stale state away,
    // nothing routine-shaped left. lastRoutineDay is NOT written: today does
    // not count as done, so the next launch retries the routine.
    await updateRunState(state => {
      state.routine = null;
      state.captures = { capturing: [], opened: {} };
    });
    console.log("Startup: routine cancelled at the confirm dialog.");
    return;
  }

  const queue = normalizeStartupOrder(settings.startupOrder).filter(
    id => settings[STARTUP_STEPS[id].enabledKey]
  );

  // Marks every step below as part of the routine, so in routine mode their
  // tabs are stashed for endRoutine() instead of closed per step. The start
  // day is captured here so endRoutine() can credit THAT day, even if the
  // sequence finishes after midnight in a later worker instance.
  await updateRunState(state => {
    state.routine = { startDay: localDayKey(), pendingSteps: [], pendingTabs: [], skipped: [] };
  });

  // A fresh read before the steps: the skip-when-done verdicts below must
  // judge the dashboard as it is NOW, not as an older same-day read left it —
  // a morning's "0 pending" must not skip an evening claim that has points
  // waiting. The stats step IS that read when it leads the queue (the default
  // order); when it is turned off or moved later, the read runs here instead,
  // so every verdict is made on current numbers either way. No
  // verdict-carrying step in the queue → no extra read.
  if (queue[0] !== "stats" && queue.some(id => STEP_DONE_CHECKS[id])) {
    await refreshStats();
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];

    // Stop checkpoint: a bumped epoch means the remaining steps, this one
    // included, are cancelled.
    if ((await currentStopEpoch()) !== myEpoch) break;

    // Skip-when-done: a step whose today's read already shows complete never
    // runs — no search batch at 60/60, no claim at 0 pending. Checked before
    // the search branch on purpose: a skipped search means the rest of the
    // sequence simply continues inline, with no batch to hand the tail to.
    const skipReason = await routineStepSkipped(id);
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`);
      await reportSkippedStep(id, skipReason);
      continue;
    }

    // The batch runs for minutes after startSearchBatch() resolves, so the rest
    // of the sequence is handed to finishBatch() instead of racing it. The
    // routine stays live — endRoutine() is runPendingStartupSteps' business.
    if (id === "search") {
      const rest = queue.slice(i + 1);
      try {
        if (rest.length) {
          await updateRunState(state => {
            if (state.routine) state.routine.pendingSteps = rest;
          });
        }
        await startSearchBatch();
        return;
      } catch (e) {
        console.warn("Startup: web search batch failed to start:", e);
        await updateRunState(state => {
          if (state.routine) state.routine.pendingSteps = [];
        });
        continue; // nothing to wait for; keep going inline
      }
    }

    try {
      await STARTUP_STEPS[id].run();
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e);
    }
  }

  // The sequence ran to its end inline — no search batch to wait for. A no-op
  // after a stop: the stop write already nulled the routine, so the stashed
  // tabs are never swept.
  await endRoutine();
}

// The tail of the startup sequence, once the web search batch has finished.
export async function runPendingStartupSteps() {
  const state = await readRunState();
  // Also reached when the batch was the last step: the queue is empty but the
  // routine is still live, and the stashed tabs still need their sweep.
  if (!state.routine) return;
  const queue = state.routine.pendingSteps;
  if (!queue.length) {
    await endRoutine();
    return;
  }

  // Same stop checkpoint as the main sequence. Captured BEFORE the queue is
  // claimed below: a stop landing between the claim and the capture would
  // otherwise slip past this checkpoint, and the whole tail would run after
  // the stop it was supposed to see.
  const myEpoch = await currentStopEpoch();

  // Claim the queue before running it: a step that starts another batch must
  // not be able to trigger this a second time.
  await updateRunState(s => {
    if (s.routine) s.routine.pendingSteps = [];
  });

  // The tail re-reads before judging the claim: the search batch just spent
  // minutes earning points, and "ready to claim" is the one verdict-carrying
  // number those searches can move — an answer captured before the batch must
  // not skip a claim the batch itself earned. The other verdicts (daily set,
  // visual search) are untouched by web searches, and a stats step leading
  // this tail queue is itself the read.
  if (queue.includes("claim") && queue[0] !== "stats") {
    await refreshStats();
  }

  for (const id of queue) {
    if ((await currentStopEpoch()) !== myEpoch) break;

    const step = STARTUP_STEPS[id];
    if (!step || id === "search") continue;

    // Same skip-when-done verdict as the main loop — the post-search tail
    // holds steps too, and a fresh claim/daily-set/image-search answer in
    // today's read skips them here exactly as it would have inline.
    const skipReason = await routineStepSkipped(id);
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`);
      await reportSkippedStep(id, skipReason);
      continue;
    }

    try {
      await step.run();
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e);
    }
  }

  // A no-op after a stop: the stop write already nulled the routine, so the
  // stashed tabs stay open with everything else.
  await endRoutine();
}

// The end of a startup sequence. In routine mode this is the one moment the
// stashed tabs are all closed at once; a no-op when no routine ran, so callers
// don't need to care which mode they're in. A routine that genuinely finished
// also marks the day it started as done for the once-per-day gate.
export async function endRoutine() {
  // Read the routine and clear it as ONE step — a stop landing between the
  // read and the clear would otherwise let a stopped routine sweep its
  // stashed tabs.
  const consumed = await consumeRoutine();
  if (!consumed) return;

  // Only a live routine gets this far, i.e. a routine truly finished (inline
  // end or post-search-batch tail — both land here). A stopped routine never
  // does: the stop write already nulled it, so the no-op return above is what
  // a stop sees, and the day stays unmarked. The START day is what gets
  // marked, not the finish day: a routine that crosses midnight belongs to
  // the day it began, or the new day would be silently marked done without
  // ever getting its routine.
  await chrome.storage.local.set({
    [LAST_ROUTINE_DAY]: consumed.startDay || localDayKey()
  });

  const skippedQuery = routineSkippedQuery(consumed.skipped);
  const ids = consumed.pendingTabs.filter(id => typeof id === "number");

  // The finish page: after the sweep below the user would be left staring at
  // whatever the routine's tabs last showed — so a summary tab opens instead,
  // saying the routine is done and listing the streaks they have to finish
  // themselves (the Bing-app check-in, usually) and the steps it skipped as
  // already done. Foreground and never auto-closed: the user is the only one
  // who takes it down, and the Clear-tabs action exempts its URL. (The page
  // itself is Stage 3's port; the URL and query contract are fixed here.)
  try {
    const summary = await routineSummaryQuery();
    const params = new URLSearchParams();
    if (summary) params.set("q", summary);
    if (skippedQuery) params.set("s", skippedQuery);
    await chrome.tabs.create({
      url: `${ROUTINE_DONE_URL}${params.toString() ? `?${params.toString()}` : ""}`,
      active: true
    });
  } catch (e) {
    // The summary is a nicety, never a failure of the routine itself.
    console.warn("Routine: could not open the finish page:", e);
  }

  if (!ids.length) return;

  // Stop checkpoint for the sweep below. Captured here rather than at the
  // top: by this point the routine genuinely finished, so a stop that landed
  // earlier was already caught by the consume guard above.
  const myEpoch = await currentStopEpoch();

  const settings = await getSettings();
  const graceMs = Math.max(0, Number(settings.tabCloseDelaySec) || 0) * 1000;

  // Same shape as closeCapturedTabs: credit the visits, keep the worker alive.
  holdKeepAlive();
  try {
    if (graceMs) await sleep(graceMs);
    // A stop during the grace period must leave the stashed tabs open —
    // stopping is not finishing, exactly like the per-step close above.
    if ((await currentStopEpoch()) !== myEpoch) {
      console.log("Routine tab sweep skipped: stopped during the grace period.");
      return;
    }
    const closed = await closeTabs(ids, settings.keepPinnedTabs);
    if (closed) {
      console.log(`Closed ${closed} tab(s) after the routine.`);
      await setLastTabAction(`Closed ${closed} tab(s) after the routine`, true);
    }
  } finally {
    releaseKeepAlive();
  }
}
