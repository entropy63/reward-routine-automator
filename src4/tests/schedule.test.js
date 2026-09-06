// The scheduled daily run's clock math (ADR-019): a "HH:MM" string and a
// moment in, the next fire moment out. Pure, so the tests pin the day
// boundaries directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimeOfDay, nextFireAt } from "../pure/schedule.js";

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
