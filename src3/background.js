// The worker entry point — listeners and message routing, nothing else.
// Every piece of behavior lives in a module with one job:
//
//   lib/run-state.js     the one-document run state (stop, batch, routine)
//   lib/tabs.js          tab capture, reuse, close, and the clear sweep
//   lib/{keepalive,alarms}.js   the MV3 worker-lifecycle machinery
//   pure/*               the verdicts, imported directly by their drivers
//   queries/*            the query sources and the prefetched chain
//   steps/search.js      the search batch + verification loop
//   steps/routine.js     the startup sequence and its tail
//   readers/*            the dashboard reads (stats, redeem, claim, sections)
//   injections/*         the page-side halves, ported verbatim from src/
//   images/*             the random-image visual search
//
// Registered as a module service worker ("type": "module", Chrome 91+), so
// the whole worker is real ES imports — no bundler, no globals-as-modules.

import { stopAllActivity, readRunState } from "./lib/run-state.js";
import { DEFAULT_SETTINGS, getSettings } from "./lib/settings.js";
import {
  cancelBeats,
  SEARCH_ALARM,
  REDEEM_WATCH_ALARM,
  REDEEM_WATCH_PERIOD_MIN,
  SCHEDULED_RUN_ALARM
} from "./lib/alarms.js";
import { nextFireAt } from "./pure/schedule.js";
import { recordOpenedTab, clearAllTabs } from "./lib/tabs.js";
import { setLastTabAction } from "./lib/log.js";
import { tick, startSearchBatch } from "./steps/search.js";
import {
  runStartupSequence,
  answerRoutineConfirm,
  routineConfirmWindowRemoved,
  routineSummaryQuery,
  routineSkippedQuery
} from "./steps/routine.js";
import { refreshStats } from "./readers/stats.js";
import { checkRedeemAvailability, redeemOverwatchCoins } from "./readers/redeem.js";
import { runManualClaim } from "./readers/claim.js";
import {
  openDailySetOnRewardsDashboard,
  openKeepEarningActivities
} from "./readers/rewards-section.js";
import { claimCoupons } from "./readers/coupons.js";
import { runRandomImageSearch } from "./images/image-search.js";

const LAST_ROUTINE_DAY = "lastRoutineDay";

// Install/update: seed the settings defaults (a stored settings blob wins,
// key by key) and clear anything run-shaped the previous version left —
// which is the whole run-state document, in ONE remove. Nothing that must
// survive (lastRoutineDay, the log rows, the query history) lives in it.
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);

  await chrome.storage.sync.set({
    settings: { ...DEFAULT_SETTINGS, ...(existing.settings || {}) }
  });
  await chrome.storage.local.remove("runState");
  await syncRedeemWatch();
  await syncScheduledRun();
});

// The startup sequence: whatever order settings.startupOrder holds.
chrome.runtime.onStartup.addListener(async () => {
  // Both schedules persist across browser restarts, but a browser closed
  // mid-toggle (or an alarm Chrome dropped) gets re-synced here — the stored
  // settings are the truth either way.
  await syncRedeemWatch();
  await syncScheduledRun();
  await runStartupSequence();
});

// Revive an interrupted batch (also fires on the normal schedule); the
// restock watcher and the scheduled run ride the same event with their own
// alarm names.
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === SEARCH_ALARM) {
    tick();
  } else if (alarm.name === REDEEM_WATCH_ALARM) {
    checkRedeemAvailability();
  } else if (alarm.name === SCHEDULED_RUN_ALARM) {
    // Reschedule tomorrow BEFORE running: the routine can hold the worker
    // for minutes and an eviction mid-run would otherwise lose the next
    // slot. The run's own once-per-day gate decides whether today actually
    // needs it — and if Chrome was closed at the fire time, the missed alarm
    // fires on the next browser start, so the schedule catches up instead
    // of skipping a day.
    await syncScheduledRun();
    await runStartupSequence();
  }
});

// Schedule or cancel the restock watch to match the stored setting. One
// place, three callers (install, startup, the popup's toggle) — so the
// alarm can never disagree with the setting for long.
async function syncRedeemWatch() {
  const settings = await getSettings();
  if (settings.restockWatcherEnabled) {
    chrome.alarms.create(REDEEM_WATCH_ALARM, {
      periodInMinutes: REDEEM_WATCH_PERIOD_MIN
    });
  } else {
    chrome.alarms.clear(REDEEM_WATCH_ALARM);
  }
}

// Schedule or cancel the daily run to match the stored setting — a one-shot
// alarm at the NEXT fire moment (the handler chains the following day). An
// unparseable time clears the alarm: a corrupt setting must read as "no
// schedule", never fire at a surprising hour.
async function syncScheduledRun() {
  const settings = await getSettings();
  const next = settings.scheduledRunEnabled
    ? nextFireAt(settings.scheduledRunTime, new Date())
    : null;
  if (next) {
    chrome.alarms.create(SCHEDULED_RUN_ALARM, { when: next.getTime() });
  } else {
    chrome.alarms.clear(SCHEDULED_RUN_ALARM);
  }
}

// Tab capture: tabs opened while a step is capturing belong to that step.
chrome.tabs.onCreated.addListener(tab => {
  if (tab && tab.id != null) {
    recordOpenedTab(tab.id).catch(e => console.warn("Tab capture failed:", e));
  }
});

// The routine's confirm dialog closing without an answer. The buttons
// resolve through handleMessage below; this is the other way the prompt can
// end. Guarded like the prompt itself — a Chrome without the windows API
// must still run.
if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener(routineConfirmWindowRemoved);
}

// ---------- Message routing ----------
//
// The popup's buttons (Stage 3 ports the popup itself; the message contract
// is fixed here). Every handler is one call into a module — this function's
// only job is dispatch.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true; // the reply is async
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "START_SEARCH_BATCH":
      await startSearchBatch();
      return { ok: true };
    case "RUN_DAILY_SET":
      // Long-running; don't hold the popup's callback open for it.
      openDailySetOnRewardsDashboard();
      return { ok: true };
    case "RUN_KEEP_EARNING":
      openKeepEarningActivities();
      return { ok: true };
    case "RUN_CLAIM":
      // Long-running; don't hold the popup's callback open for it.
      runManualClaim();
      return { ok: true };
    case "REFRESH_STATS":
      // Same fire-and-forget reasoning as the daily set: worst case the read
      // waits out a slow dashboard for ~30s, longer than the popup's response
      // channel should be held open. The popup learns the outcome from
      // lastStats instead.
      refreshStats();
      return { ok: true };
    case "REFRESH_REDEEM":
      // Same fire-and-forget reasoning as REFRESH_STATS above: the watch can
      // wait out a slow redeem page for well over the popup's patience. The
      // popup learns the outcome from lastRedeem instead.
      checkRedeemAvailability();
      return { ok: true };
    case "REDEEM_OVERWATCH":
      // The popup's Redeem button: a user-initiated spend, so unlike the
      // watch above this is NOT background — the tab opens foreground where
      // the user watches their own transaction. Fire-and-forget like the
      // other manual runs: the outcome is the page the user is looking at.
      redeemOverwatchCoins(message.url, message.label);
      return { ok: true };
    case "CLAIM_COUPONS":
      // Experimental (Settings → Experimental features): the popup's
      // Coupons button. Foreground for the same reason as the redeem button
      // — the coupon panel is the user's own to watch — and fire-and-forget
      // the same way: the outcome is the page the user is looking at.
      claimCoupons();
      return { ok: true };
    case "RUN_IMAGE_SEARCH":
      runRandomImageSearch();
      return { ok: true };
    case "STOP_BATCH":
      // Cancel the schedule first so no late beat races the stop write; the
      // write then takes down the batch, the routine, the verification loop,
      // and the capture bookkeeping together. Stopping is not finishing: the
      // tabs stay open, and lastRoutineDay is never written by a stop.
      cancelBeats();
      await stopAllActivity();
      return { ok: true };
    case "OPEN_ROUTINE_DONE":
      // Developer Option only (2026-09-04): the popup's routine-done opener —
      // same page, same summary, as the genuine endRoutine call, so the
      // preview is the real thing. The extra dev=1 flag turns on the page's
      // own preview bar (one button per render condition); endRoutine never
      // sets it, so a real finish still opens the honest page. Fire-and-
      // forget: the outcome is the page itself.
      try {
        const summary = await routineSummaryQuery();
        // Whatever skip list is still stored joins the preview (a finished
        // routine's list was consumed by its own endRoutine — usually empty
        // here, and honest when it isn't).
        const state = await readRunState();
        const params = new URLSearchParams({ dev: "1" });
        if (summary) params.set("q", summary);
        const skippedQuery = routineSkippedQuery(state.routine && state.routine.skipped);
        if (skippedQuery) params.set("s", skippedQuery);
        await chrome.tabs.create({
          url: `routine-done.html?${params.toString()}`,
          active: true
        });
      } catch (e) {
        console.warn("Could not open the routine-done page:", e);
      }
      return { ok: true };
    case "CLEAR_ALL_TABS":
      return await clearAllTabs(message.windowId);
    case "RESET_ROUTINE_DAY":
      // Developer Option: clears the once-per-day done-mark, so the next
      // browser launch runs the startup routine again, as if it had never run
      // today. Only the done-mark goes: the state of a routine running right
      // now is not this button's business (and that routine's own endRoutine
      // will re-mark its day when it finishes — it did run).
      await chrome.storage.local.remove(LAST_ROUTINE_DAY);
      await setLastTabAction("Dev — routine will run on the next browser start", true);
      return { ok: true };
    case "routineConfirmAnswer":
      // The routine's confirm dialog reporting its buttons.
      answerRoutineConfirm(message.proceed);
      return { ok: true };
    case "SET_RESTOCK_WATCH":
      // The Redeem card's restock toggle: reschedule (or cancel) the periodic
      // watch from the setting the popup just wrote. The watch itself is the
      // existing redeem reader — guarded against overlap, tabs closed by the
      // reader — and its flips land in the banners the popup already renders.
      await syncRedeemWatch();
      return { ok: true };
    case "SYNC_SCHEDULED_RUN":
      // The Settings view's schedule toggle or time field: reschedule the
      // one-shot from the settings the popup just wrote. Awaited on the
      // popup side so this read cannot race that write.
      await syncScheduledRun();
      return { ok: true };
    default:
      return { ok: false, error: "unknown message type" };
  }
}
