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
  RETARGET_TOLERANCE_MS,
  NUDGE_ALARM,
  NUDGE_HEARTBEAT
} from "./lib/alarms.js";
import { nextFireAt, scheduledDue } from "./pure/schedule.js";
import { dayRemainder, nudgeMessage } from "./pure/verdicts.js";
import { notify, clearNotification } from "./lib/notify.js";
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
// The scheduled round's own once-a-day latch, separate from lastRoutineDay: a
// scheduled round that ran sets BOTH, but a startup round that already ran
// today must not stop the schedule's latch from being written, or every
// heartbeat would keep re-asking "did I handle today?" forever.
const LAST_SCHEDULED_DAY = "lastScheduledDay";
// Today's read, as the readers store it. The nudge judges "what is still open"
// from this — the same document every other verdict reads.
const LAST_STATS = "lastStats";

// The evening nudge's own latch and race-guard, mirroring the scheduled
// round's above and for the same reasons — and deliberately separate from
// them: the nudge must fire on a day the routine already ran (that is the
// point — it is the day the user might still have work left), so it cannot
// share lastScheduledDay.
const LAST_NUDGE_DAY = "lastNudgeDay";
// The notification's stable id. Stable so a repeat replaces rather than stacks,
// and so a button click can be routed back here.
const NUDGE_NOTIFICATION_ID = "eveningNudge";
let nudgeRunning = false;

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
  await ensureNudge();
  await runNudgeIfDue();
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
  await ensureNudge();
  await runNudgeIfDue();
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
  } else if (alarm.name === NUDGE_HEARTBEAT) {
    await runNudgeIfDue();
  } else if (alarm.name === NUDGE_ALARM) {
    // Same check-then-arm order as the scheduled run's punctual fire, for the
    // same reason: the notification work must not be the thing that leaves no
    // alarm behind.
    await ensureNudge();
    await runNudgeIfDue();
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

// Arm the evening nudge to match the stored setting — the same two-alarm shape
// as ensureScheduledRun above, and for the same reason: the one-shot is the
// on-the-minute convenience, the heartbeat is the net. Idempotent.
async function ensureNudge() {
  const settings = await getSettings();
  const punctual = await chrome.alarms.get(NUDGE_ALARM);
  const heartbeat = await chrome.alarms.get(NUDGE_HEARTBEAT);

  if (!settings.eveningNudgeEnabled) {
    if (punctual) await chrome.alarms.clear(NUDGE_ALARM);
    if (heartbeat) await chrome.alarms.clear(NUDGE_HEARTBEAT);
    // The banner itself goes too: a notification left standing for a feature
    // the user just switched off (or for a moment now in the past) is the
    // extension talking after being told to stop.
    clearNotification(NUDGE_NOTIFICATION_ID);
    return;
  }

  if (!heartbeat) {
    chrome.alarms.create(NUDGE_HEARTBEAT, {
      periodInMinutes: HEARTBEAT_PERIOD_MIN,
      delayInMinutes: HEARTBEAT_PERIOD_MIN
    });
  }

  const at = nextFireAt(settings.eveningNudgeTime, new Date());
  if (!at) {
    if (punctual) await chrome.alarms.clear(NUDGE_ALARM);
    return;
  }
  if (!punctual || Math.abs(punctual.scheduledTime - at.getTime()) > RETARGET_TOLERANCE_MS) {
    chrome.alarms.create(NUDGE_ALARM, { when: at.getTime() });
  }
}

// The nudge's funnel — every trigger (punctual, heartbeat, worker wake) flows
// through it, exactly like the scheduled round's. What differs is the payload:
// this one reads today's numbers and asks the pure dayRemainder() what is
// still open, rather than starting anything.
//
// The latch rules are the interesting part, because a nudge is judged by what
// it does NOT say as much as by what it does:
//
//   something is open   notify, then latch the day.
//   everything is done  say nothing, but latch anyway — the day IS handled,
//                       and re-asking every 5 minutes until midnight would be
//                       pure waste.
//   the read is unknown (no read yet, or yesterday's)  say nothing and do NOT
//                       latch. A nudge built on yesterday's numbers would send
//                       the user to redo finished work, and silence costs
//                       nothing when a later wake may have today's read.
//   a round is running   say nothing and do NOT latch — the routine will
//                       finish most of the list, and the next tick judges the
//                       result rather than the stale picture.
async function runNudgeIfDue() {
  const settings = await getSettings();
  const { [LAST_NUDGE_DAY]: lastHandledDay } = await chrome.storage.local.get(LAST_NUDGE_DAY);
  const now = new Date();

  const decision = scheduledDue({
    enabled: settings.eveningNudgeEnabled,
    scheduledTime: settings.eveningNudgeTime,
    lastHandledDay: lastHandledDay ?? null,
    now
  });
  if (!decision.due) return;

  if (nudgeRunning) return;
  nudgeRunning = true;
  try {
    const state = await readRunState();
    if (state.batch != null || state.routine != null || state.activity != null) return;

    const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
    const remainder = dayRemainder(stats, now);
    if (!remainder) return; // unknown, not "empty" — leave the day unlatched

    await chrome.storage.local.set({ [LAST_NUDGE_DAY]: decision.day });
    if (!remainder.left.length) return;

    notify("Still open today", nudgeMessage(remainder.left), {
      id: NUDGE_NOTIFICATION_ID,
      buttons: [{ title: "Run it" }, { title: "Later" }]
    });
  } finally {
    nudgeRunning = false;
  }
}

// The nudge's buttons: "Run it" starts the routine on the spot (the press IS
// the confirmation, the same contract as the popup's Run button), "Later" just
// takes the banner away. A click on the body is treated as "Later" too — a
// dismissed notification should never come back.
if (chrome.notifications && chrome.notifications.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId !== NUDGE_NOTIFICATION_ID) return;
    clearNotification(NUDGE_NOTIFICATION_ID);
    if (buttonIndex === 0) runStartupSequence({ manual: true });
  });
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId !== NUDGE_NOTIFICATION_ID) return;
    clearNotification(NUDGE_NOTIFICATION_ID);
  });
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
    case "RUN_FULL_ROUTINE":
      // The Run view's big button (ADR-020): the whole startup sequence on
      // demand, with the launch gates (master switch, once-per-day, the
      // confirm dialog) opted out — the press IS the confirmation. Long-
      // running like the daily set: fire-and-forget, the status pill and
      // the Activity rows report as it goes.
      runStartupSequence({ manual: true });
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
    case "SYNC_NUDGE":
      // The Settings view's nudge toggle or time field — the same contract as
      // SYNC_SCHEDULED_RUN above: re-arm from the settings the popup just
      // wrote, then ask whether the new (possibly already-past) time is owed
      // right now. Setting the time to 20:00 at 21:00 should nudge today.
      await ensureNudge();
      await runNudgeIfDue();
      return { ok: true };
    default:
      return { ok: false, error: "unknown message type" };
  }
}
