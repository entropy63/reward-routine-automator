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
  SCHEDULED_RUN_ALARM,
  SCHEDULED_HEARTBEAT,
  HEARTBEAT_PERIOD_MIN,
  RETARGET_TOLERANCE_MS
} from "./lib/alarms.js";
import { nextFireAt, scheduledDue } from "./pure/schedule.js";
import { recordOpenedTab, clearAllTabs } from "./lib/tabs.js";
import { setLastTabAction } from "./lib/log.js";
import { tick, startSearchBatch } from "./steps/search.js";
import {
  runStartupSequence,
  enabledStartupOrder,
  answerRoutineConfirm,
  routineConfirmWindowRemoved,
  routineSummaryQuery,
  routineSkippedQuery
} from "./steps/routine.js";
import { preflight } from "./pure/plan.js";
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
const LAST_STATS = "lastStats";
// The scheduled round's own once-a-day latch, separate from lastRoutineDay: a
// scheduled round that ran sets BOTH, but a startup round that already ran
// today must not stop the schedule's latch from being written, or every
// heartbeat would keep re-asking "did I handle today?" forever.
const LAST_SCHEDULED_DAY = "lastScheduledDay";

// A synchronous re-entrancy guard for the scheduled round. The punctual alarm
// and a heartbeat tick can both pass the due-check in the same instant (both
// wake the worker, both read the same not-yet-handled day before either writes
// it). This closes that race WITHOUT a storage round-trip: it flips before the
// first `await`, so the second caller sees it set and bails. Module-level = one
// worker, one guard.
let scheduledRunning = false;

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
  // Arm first, then ask: a browser that was closed through the scheduled
  // moment must run the owed round on this very install/update path.
  await ensureScheduledRun();
  await runScheduledIfDue("wake");
});

// The startup sequence: whatever order settings.startupOrder holds.
chrome.runtime.onStartup.addListener(async () => {
  // Both schedules persist across browser restarts, but a browser closed
  // mid-toggle (or an alarm Chrome dropped) gets re-synced here — the stored
  // settings are the truth either way.
  await syncRedeemWatch();
  // Arm first, then ask. This is the path that recovers a day the browser was
  // closed through: no alarm was ever delivered, but the wall clock says the
  // round is owed, so it runs now.
  await ensureScheduledRun();
  await runScheduledIfDue("wake");
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
  } else if (alarm.name === SCHEDULED_HEARTBEAT) {
    // The reliability net: re-ask the due-check. Carries no target of its own,
    // so it never re-points the punctual alarm — only the settings path does.
    await runScheduledIfDue("heartbeat");
  } else if (alarm.name === SCHEDULED_RUN_ALARM) {
    // The punctual fire. Re-point at tomorrow BEFORE running: the routine can
    // hold the worker for minutes, and an eviction mid-run would otherwise
    // leave no punctual alarm behind (the heartbeat would still catch up, but
    // a lost slot costs the on-the-minute firing).
    await ensureScheduledRun();
    await runScheduledIfDue("punctual");
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

// Arm the scheduled run to match the stored setting. Idempotent — safe (and
// intended) on every worker wake and every settings change.
//
// The one-shot alone is NOT the schedule: it is only the on-the-minute
// convenience. The heartbeat is the net that survives a browser which was
// closed or asleep at the moment (Chrome never delivers a past-due alarm), so
// both are armed whenever the schedule is on.
async function ensureScheduledRun() {
  const settings = await getSettings();
  const punctual = await chrome.alarms.get(SCHEDULED_RUN_ALARM);
  const heartbeat = await chrome.alarms.get(SCHEDULED_HEARTBEAT);

  if (!settings.scheduledRunEnabled) {
    if (punctual) await chrome.alarms.clear(SCHEDULED_RUN_ALARM);
    if (heartbeat) await chrome.alarms.clear(SCHEDULED_HEARTBEAT);
    return;
  }

  // The heartbeat runs whenever the schedule is on, regardless of how the time
  // parses — it is the net that re-asks the due-check. Created only when
  // missing, so an in-flight period isn't reset on every wake.
  if (!heartbeat) {
    chrome.alarms.create(SCHEDULED_HEARTBEAT, {
      periodInMinutes: HEARTBEAT_PERIOD_MIN,
      // First tick one period out; the wake-path due-check already covers
      // "due right now", so the heartbeat needn't fire immediately.
      delayInMinutes: HEARTBEAT_PERIOD_MIN
    });
  }

  const at = settings.scheduledRunEnabled
    ? nextFireAt(settings.scheduledRunTime, new Date())
    : null;
  if (!at) {
    // An unparseable time clears the punctual alarm (a corrupt setting must
    // read as "no schedule", never fire at a surprising hour). The heartbeat
    // stays — it is harmless, since scheduledDue() answers "bad-time".
    if (punctual) await chrome.alarms.clear(SCHEDULED_RUN_ALARM);
    return;
  }
  if (!punctual || Math.abs(punctual.scheduledTime - at.getTime()) > RETARGET_TOLERANCE_MS) {
    chrome.alarms.create(SCHEDULED_RUN_ALARM, { when: at.getTime() });
  }
}

// The single funnel EVERY trigger flows through — the punctual alarm, each
// heartbeat tick, and every worker wake. The pure scheduledDue() check decides;
// this only handles the effects (the busy-guard, the once-a-day latch, the
// visible note) and the re-entrancy race.
async function runScheduledIfDue(source) {
  const settings = await getSettings();
  const { [LAST_SCHEDULED_DAY]: lastHandledDay } = await chrome.storage.local.get(
    LAST_SCHEDULED_DAY
  );
  const decision = scheduledDue({
    enabled: settings.scheduledRunEnabled,
    scheduledTime: settings.scheduledRunTime,
    lastHandledDay: lastHandledDay ?? null,
    now: new Date()
  });

  if (!decision.due) {
    // A punctual alarm landing on an already-handled day is the ordinary "the
    // heartbeat or a wake already ran it" case — worth ONE visible row so the
    // user sees the schedule is alive, but only from the punctual source (a
    // heartbeat saying it every 5 minutes would be log spam).
    if (decision.reason === "done-today" && source === "punctual") {
      await setLastTabAction("Scheduled — the routine already ran today, skipped", true);
    }
    return;
  }

  // Re-entrancy: flip the guard BEFORE the first await after the decision, so a
  // second trigger racing this same instant sees it and bails. Everything past
  // here runs exactly once for the day.
  if (scheduledRunning) return;
  scheduledRunning = true;
  try {
    const state = await readRunState();
    const busy = state.batch != null || state.routine != null || state.activity != null;
    if (busy) {
      // Do NOT latch the day: a round that couldn't start because something
      // else was running should be retried by the next heartbeat, not lost.
      await setLastTabAction("Scheduled — something else was running, will retry shortly", true);
      return;
    }

    // Latch the day BEFORE running: if the routine below crashes, the day must
    // not re-fire on the next heartbeat — a visible failure is recoverable, a
    // twice-run routine is not. (The busy path above deliberately does NOT
    // reach this line, so it stays retryable.)
    await chrome.storage.local.set({ [LAST_SCHEDULED_DAY]: decision.day });

    // The once-per-day gate lives inside runStartupSequence, applied exactly as
    // a browser start applies it; the 15s confirm window deliberately does NOT
    // apply here — a time the user set IS the intent, and an unattended window
    // would auto-cancel every scheduled round.
    await setLastTabAction(
      `Scheduled — starting the routine (${settings.scheduledRunTime})`,
      true
    );
    await runStartupSequence({ scheduled: true });
  } finally {
    scheduledRunning = false;
  }
}

// The dry run's rows: today's read + the enabled step order + the settings the
// steps read their own numbers from. One place, so the popup's panel and the
// confirm dialog render the identical list.
async function buildPreflight() {
  const settings = await getSettings();
  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  return preflight(stats, enabledStartupOrder(settings), settings);
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
      // The Settings view's schedule toggle or time field: re-arm both alarms
      // from the settings the popup just wrote, then ask whether the new
      // (possibly already-past) time owes a round right now — setting the time
      // to 09:00 at 11:00 should run today, not silently wait for tomorrow.
      // Awaited on the popup side so this read cannot race that write.
      await ensureScheduledRun();
      await runScheduledIfDue("wake");
      return { ok: true };
    case "GET_PREFLIGHT":
      // The dry run, computed worker-side: the popup and the confirm dialog
      // both ask for it, and neither should re-derive the verdicts. The step
      // list comes from enabledStartupOrder() — the routine's own queue
      // function — and the verdicts from the same pure preflight() the popup's
      // plan preview is built on, so "Will open" cannot promise something the
      // run would not do.
      return { ok: true, rows: await buildPreflight() };
    case "RUN_FULL_ROUTINE":
      // The pre-flight's Go button (build 3). Manual, so it bypasses the three
      // LAUNCH gates — the button press is the consent — while every per-step
      // skip-when-done verdict still applies. Fire-and-forget: the run holds
      // the worker for minutes, far longer than the popup's response channel
      // should stay open, and the outcome is visible in the popup's own cards.
      runStartupSequence({ manual: true });
      return { ok: true };
    default:
      return { ok: false, error: "unknown message type" };
  }
}
