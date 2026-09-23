// The scheduled daily run's clock math (ADR-019). Pure: a "HH:MM" string and
// a moment in, and out comes either the next fire moment (nextFireAt, the
// punctual alarm's target) or whether today's round is owed right now
// (scheduledDue, the check every wake runs). The effects live in
// background.js. Pure on purpose: the tests import it directly and pin the
// day boundaries.

import { localDayKey } from "../lib/day.js";

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "HH:MM" (24-hour local) → minutes since midnight, or null when the string
// is not a valid time. Strict on purpose: a hand-edited or corrupt setting
// must read as "no schedule", not fire at a surprising hour.
export function parseTimeOfDay(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(TIME_OF_DAY);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// The next moment the schedule fires, strictly after `now`: today at the
// configured time when that is still ahead, otherwise tomorrow at the same
// time (a time that has passed today has its next occurrence tomorrow —
// "equal to now" counts as passed, so the alarm is never created in the
// past). null when the time is unparseable. The rollover is calendar-local:
// a DST shift moves the wall-clock with the calendar, which is what a "run
// at 9:00" promise means.
export function nextFireAt(timeOfDay, now = new Date()) {
  const minutes = parseTimeOfDay(timeOfDay);
  if (minutes == null) return null;

  const fire = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  );
  if (fire.getTime() <= now.getTime()) fire.setDate(fire.getDate() + 1);
  return fire;
}

// Is today's scheduled round due RIGHT NOW? The old design leaned on a one-shot
// `when` alarm delivering ~24h later — and Chrome NEVER delivers a past-due
// alarm, so a browser closed (or a PC asleep) at the moment silently lost the
// day: the next start's nextFireAt() simply computed tomorrow, and today was
// gone. This replaces that fragile delivery assumption with a time-based check
// any wake can evaluate: a periodic heartbeat (plus every worker wake, plus the
// punctual one-shot) asks this function, and it fires the moment the clock is
// at or past today's time and today hasn't been handled yet. No missed-alarm
// bookkeeping — the wall clock is the source of truth, not alarm delivery.
//
// `lastHandledDay` is the once-a-day latch (localDayKey of the last round
// already handled today, fired or visibly skipped), so repeated heartbeats
// after the moment don't re-run the round.
export function scheduledDue({ enabled, scheduledTime, lastHandledDay, now = new Date() }) {
  if (!enabled) return { due: false, reason: "disabled" };
  const minutes = parseTimeOfDay(scheduledTime);
  // An unparseable time is a broken clock, never a fire loop.
  if (minutes == null) return { due: false, reason: "bad-time" };

  const today = localDayKey(now);
  // Already run (or skipped) today — the once-a-day latch.
  if (lastHandledDay === today) return { due: false, reason: "done-today" };

  const moment = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  );
  // Not there yet today — the alarm/heartbeat will ask again after the moment.
  if (now.getTime() < moment.getTime()) return { due: false, reason: "early" };
  return { due: true, day: today };
}
