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
//   steps/reads.js       the Stage-2 dashboard-reader seam
//
// Registered as a module service worker ("type": "module", Chrome 91+), so
// the whole worker is real ES imports — no bundler, no globals-as-modules.

import { stopAllActivity } from "./lib/run-state.js";
import { DEFAULT_SETTINGS } from "./lib/settings.js";
import { cancelBeats, SEARCH_ALARM } from "./lib/alarms.js";
import { recordOpenedTab, clearAllTabs } from "./lib/tabs.js";
import { setLastTabAction } from "./lib/log.js";
import { tick, startSearchBatch } from "./steps/search.js";
import {
  runStartupSequence,
  answerRoutineConfirm,
  routineConfirmWindowRemoved
} from "./steps/routine.js";

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
});

// The startup sequence: whatever order settings.startupOrder holds.
chrome.runtime.onStartup.addListener(async () => {
  await runStartupSequence();
});

// Revive an interrupted batch (also fires on the normal schedule).
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SEARCH_ALARM) tick();
});

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
    case "STOP_BATCH":
      // Cancel the schedule first so no late beat races the stop write; the
      // write then takes down the batch, the routine, the verification loop,
      // and the capture bookkeeping together. Stopping is not finishing: the
      // tabs stay open, and lastRoutineDay is never written by a stop.
      cancelBeats();
      await stopAllActivity();
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
    default:
      return { ok: false, error: "unknown message type" };
  }
}
