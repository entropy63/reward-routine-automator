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

// The restock watcher: a plain repeating alarm — no timer, no pad; the
// reader it wakes is idempotent and self-guarding (READ_RUN_GUARDS refuses
// an overlapping burst), so a late or doubled fire costs nothing.
export const REDEEM_WATCH_ALARM = "redeemWatch";
export const REDEEM_WATCH_PERIOD_MIN = 120;

// The scheduled daily run (ADR-019). TWO alarms, on purpose:
//
//   SCHEDULED_RUN_ALARM  a one-shot at the next fire moment, so an idle-but-
//                        awake worker fires ON the minute rather than waiting
//                        for the next heartbeat tick.
//   SCHEDULED_HEARTBEAT  a periodic tick that keeps waking the worker to
//                        re-ask the pure scheduledDue() check.
//
// The heartbeat is what makes "left it for a day" work. The original design
// trusted the one-shot alone and assumed a missed fire would catch up on the
// next browser start — it does not: Chrome NEVER delivers a past-due alarm, so
// a browser closed (or a PC asleep) at the moment dropped the day silently.
// With a heartbeat, no single delivery has to land at the right instant — a
// missed tick only delays the round to the next one.
export const SCHEDULED_RUN_ALARM = "scheduledRun";
export const SCHEDULED_HEARTBEAT = "scheduledHeartbeat";
// Every 5 minutes: fine enough that a round starts within ~5 min of its time
// in the worst case (worker evicted, no punctual delivery), cheap enough to be
// invisible. MV3's alarm floor is 30s; this is well clear of it.
export const HEARTBEAT_PERIOD_MIN = 5;
// A standing punctual alarm within this of the freshly computed target counts
// as on-target — sub-minute jitter in the wake-time computation must not churn
// the alarm on every worker wake.
export const RETARGET_TOLERANCE_MS = 60000;

// The evening nudge (5.1.0) — the same TWO-alarm shape, on its own pair so the
// two features arm and disarm independently: turning the scheduled run off must
// not silence the nudge, and vice versa. The nudge is a notification rather
// than a tab-opening round, but a nudge the user never receives because Chrome
// dropped a past-due one-shot would be exactly the bug the scheduled run had,
// so it reuses the fixed clock instead of a fresh one-shot.
export const NUDGE_ALARM = "eveningNudge";
export const NUDGE_HEARTBEAT = "nudgeHeartbeat";

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
