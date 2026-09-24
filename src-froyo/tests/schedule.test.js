// The scheduled daily run's clock math (ADR-019): a "HH:MM" string and a
// moment in, the next fire moment out (nextFireAt) or whether today's round is
// owed right now (scheduledDue). Pure, so the tests pin the day boundaries
// directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimeOfDay, nextFireAt, scheduledDue } from "../pure/schedule.js";

test("parseTimeOfDay accepts strict HH:MM, 24-hour", () => {
  assert.equal(parseTimeOfDay("09:00"), 9 * 60);
  assert.equal(parseTimeOfDay("23:59"), 23 * 60 + 59);
  assert.equal(parseTimeOfDay("00:00"), 0);
  assert.equal(parseTimeOfDay("  07:15 "), 7 * 60 + 15); // surrounding space ok
});

test("parseTimeOfDay rejects anything not a valid time", () => {
  assert.equal(parseTimeOfDay("24:00"), null); // hour out of range
  assert.equal(parseTimeOfDay("12:60"), null); // minute out of range
  assert.equal(parseTimeOfDay("9:00"), null); // no leading zero
  assert.equal(parseTimeOfDay("9 am"), null);
  assert.equal(parseTimeOfDay(""), null);
  assert.equal(parseTimeOfDay(null), null);
  assert.equal(parseTimeOfDay(540), null);
  assert.equal(parseTimeOfDay("09:00:00"), null);
});

test("nextFireAt lands later today when the time is still ahead", () => {
  const now = new Date(2026, 8, 6, 8, 0, 0); // 2026-09-06 8am
  const fire = nextFireAt("09:00", now);
  assert.equal(fire.getTime(), new Date(2026, 8, 6, 9, 0, 0, 0).getTime());
});

test("nextFireAt rolls to tomorrow once the time has passed", () => {
  const now = new Date(2026, 8, 6, 10, 30, 0);
  const fire = nextFireAt("09:00", now);
  assert.equal(fire.getTime(), new Date(2026, 8, 7, 9, 0, 0, 0).getTime());
});

test("nextFireAt counts 'equal to now' as passed — never fires in the past", () => {
  const now = new Date(2026, 8, 6, 9, 0, 0, 0);
  const fire = nextFireAt("09:00", now);
  assert.equal(fire.getTime(), new Date(2026, 8, 7, 9, 0, 0, 0).getTime());
});

test("nextFireAt rolls the month like a calendar, not a 24h interval", () => {
  const now = new Date(2026, 8, 30, 23, 0, 0); // 2026-09-30, late
  const fire = nextFireAt("09:00", now);
  assert.equal(fire.getTime(), new Date(2026, 9, 1, 9, 0, 0, 0).getTime());
});

test("nextFireAt is null for an unparseable time", () => {
  assert.equal(nextFireAt("nope", new Date()), null);
  assert.equal(nextFireAt(null, new Date()), null);
});

// ---------- scheduledDue: the wall-clock check every wake runs ----------
//
// The regression this pins: the old design trusted a one-shot alarm to deliver
// ~24h later. Chrome NEVER delivers a past-due alarm, so a browser closed at
// the moment lost the day outright. scheduledDue asks the CLOCK instead, so a
// wake at any hour after the configured time still sees the day as owed.

test("scheduledDue is due the moment the clock reaches today's time", () => {
  const at = new Date(2026, 8, 6, 9, 0, 0, 0);
  assert.deepEqual(
    scheduledDue({
      enabled: true,
      scheduledTime: "09:00",
      lastHandledDay: null,
      now: at
    }),
    { due: true, day: "2026-09-06" }
  );
});

test("scheduledDue is still due HOURS later — the missed-fire case", () => {
  // The browser was closed at 09:00 and opened at 14:37. The alarm for today
  // was never delivered (Chrome drops past-due alarms); the clock still says
  // the round is owed, which is the whole fix.
  assert.deepEqual(
    scheduledDue({
      enabled: true,
      scheduledTime: "09:00",
      lastHandledDay: null,
      now: new Date(2026, 8, 6, 14, 37, 0)
    }),
    { due: true, day: "2026-09-06" }
  );
});

test("scheduledDue is not due before the time", () => {
  assert.deepEqual(
    scheduledDue({
      enabled: true,
      scheduledTime: "09:00",
      lastHandledDay: null,
      now: new Date(2026, 8, 6, 8, 59, 59)
    }),
    { due: false, reason: "early" }
  );
});

test("scheduledDue's once-a-day latch holds for the rest of that day only", () => {
  const base = { enabled: true, scheduledTime: "09:00" };
  // Handled today → the heartbeat asking again every 5 minutes gets "no".
  assert.deepEqual(
    scheduledDue({ ...base, lastHandledDay: "2026-09-06", now: new Date(2026, 8, 6, 9, 0, 5) }),
    { due: false, reason: "done-today" }
  );
  // Yesterday's latch does not cover today.
  assert.equal(
    scheduledDue({ ...base, lastHandledDay: "2026-09-05", now: new Date(2026, 8, 6, 9, 0, 5) })
      .due,
    true
  );
});

test("scheduledDue is inert when the schedule is off or the time is broken", () => {
  const now = new Date(2026, 8, 6, 12, 0, 0);
  assert.deepEqual(
    scheduledDue({ enabled: false, scheduledTime: "09:00", lastHandledDay: null, now }),
    { due: false, reason: "disabled" }
  );
  // A corrupt setting must read as "no schedule", never a fire loop.
  assert.deepEqual(
    scheduledDue({ enabled: true, scheduledTime: "25:99", lastHandledDay: null, now }),
    { due: false, reason: "bad-time" }
  );
  assert.deepEqual(
    scheduledDue({ enabled: true, scheduledTime: null, lastHandledDay: null, now }),
    { due: false, reason: "bad-time" }
  );
});

test("scheduledDue's day key is the LOCAL day, matching localDayKey", () => {
  // 00:05 local: still "today", so a 00:00 schedule is owed and yesterday's
  // latch (a different key) does not block it.
  const justPastMidnight = new Date(2026, 8, 7, 0, 5, 0);
  assert.deepEqual(
    scheduledDue({
      enabled: true,
      scheduledTime: "00:00",
      lastHandledDay: "2026-09-06",
      now: justPastMidnight
    }),
    { due: true, day: "2026-09-07" }
  );
});
