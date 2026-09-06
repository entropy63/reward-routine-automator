// Batch scheduling: a setTimeout for the real wait, plus a chrome.alarms
// backstop for the case where the service worker gets evicted anyway
// (ADR-001). Alarms cannot fire sooner than 30s, so the alarm is padded
// past the timer and always fires late — whichever of the two wakes the
// worker first runs the beat; the tick itself waits out any remainder
// against the persisted nextRunAt, so an early alarm (worker revived by
// anything else) never speeds the searches up.
//
// The two handles live only as long as the service worker. If it is evicted
// mid-batch the alarm revives it and the batch resumes from the persisted
// run state, so nothing here needs to survive a restart.

import { stopKeepAlive } from "./keepalive.js";

export const SEARCH_ALARM = "searchTick";
const WATCHDOG_PAD_MS = 15000; // alarm fires after the timer, as a backstop
const MIN_ALARM_MINUTES = 0.5; // chrome.alarms' own floor

// The restock watcher (3.1): a plain repeating alarm — no timer, no pad; the
// reader it wakes is idempotent and self-guarding (READ_RUN_GUARDS refuses
// an overlapping burst), so a late or doubled fire costs nothing.
export const REDEEM_WATCH_ALARM = "redeemWatch";
export const REDEEM_WATCH_PERIOD_MIN = 120;

let beatTimer = null;

// Schedules one beat of the search loop. The fire callback is handed in by
// the caller (steps/search.js registers its tick) so this module stays a
// dumb clock with no knowledge of what a tick does.
export function scheduleBeat(delayMs, fire) {
  const wait = Math.max(0, delayMs);

  if (beatTimer !== null) clearTimeout(beatTimer);
  beatTimer = setTimeout(() => {
    beatTimer = null;
    fire();
  }, wait);

  chrome.alarms.create(SEARCH_ALARM, {
    delayInMinutes: Math.max(MIN_ALARM_MINUTES, (wait + WATCHDOG_PAD_MS) / 60000)
  });
}

export function cancelBeats() {
  if (beatTimer !== null) {
    clearTimeout(beatTimer);
    beatTimer = null;
  }
  chrome.alarms.clear(SEARCH_ALARM);
  // Drops the batch's keep-alive — but a tab-close grace period holding one
  // must run to completion, hence the refusal inside.
  stopKeepAlive();
}
