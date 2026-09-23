// Batch scheduling: a setTimeout for the real wait, plus a chrome.alarms
// backstop for the case where the service worker gets evicted anyway
// (ADR-001). Alarms cannot fire sooner than 30s, so the alarm is padded past
// the timer and always fires late — whichever of the two wakes the worker
// first runs the beat; the tick itself waits out any remainder against the
// persisted nextRunAt, so an early alarm never speeds the searches up.
//
// The handle lives only as long as the service worker. If it is evicted
// mid-batch the alarm revives it and the batch resumes from the persisted run
// state, so nothing here needs to survive a restart.
//
// The alarm is PERIODIC, not one-shot: while a batch is live the watchdog keeps
// re-firing (every WATCHDOG_PERIOD_MINUTES) until cancelBeats() clears it on
// finish or stop. A one-shot alarm that fired into a tick the re-entrancy guard
// skipped — because an earlier tick had wedged on a never-settling await — was
// consumed with no replacement, and the batch stalled mid-way with nothing
// scheduled ("sometimes the search stuck at half the searches"). Re-firing
// means a dropped or swallowed beat is retried on the next period, not lost.

import { stopKeepAlive } from './keepalive.ts'

export const SEARCH_ALARM = 'searchTick'
const WATCHDOG_PAD_MS = 15000 // alarm fires after the timer, as a backstop
const MIN_ALARM_MINUTES = 0.5 // chrome.alarms' own floor
const WATCHDOG_PERIOD_MINUTES = 1 // the watchdog re-fires at this cadence until cleared

let beatTimer: ReturnType<typeof setTimeout> | null = null

// Schedules one beat of the search loop. The fire callback is handed in by the
// caller (routine/search.ts registers its tick) so this module stays a dumb
// clock with no knowledge of what a tick does.
export function scheduleBeat(delayMs: number, fire: () => void): void {
  const wait = Math.max(0, delayMs)

  if (beatTimer !== null) clearTimeout(beatTimer)
  beatTimer = setTimeout(() => {
    beatTimer = null
    fire()
  }, wait)

  chrome.alarms.create(SEARCH_ALARM, {
    delayInMinutes: Math.max(MIN_ALARM_MINUTES, (wait + WATCHDOG_PAD_MS) / 60000),
    // Repeat, don't fire once: a one-shot alarm that arrived while a tick was
    // wedged (skipped by the re-entrancy guard) or that landed on a dropped
    // beat would be consumed with nothing to replace it, stranding the batch
    // mid-way. The period keeps re-firing until cancelBeats() clears it.
    periodInMinutes: WATCHDOG_PERIOD_MINUTES,
  })
}

export function cancelBeats(): void {
  if (beatTimer !== null) {
    clearTimeout(beatTimer)
    beatTimer = null
  }
  chrome.alarms.clear(SEARCH_ALARM)
  // Drops the batch's keep-alive — but a tab-close grace period holding one
  // must run to completion, hence the refusal inside.
  stopKeepAlive()
}
