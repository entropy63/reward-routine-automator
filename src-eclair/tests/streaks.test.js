// The streak guard (build 3's "Before the day ends" block). Pure, so the tests
// pin both the verdict and the clock directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { streakRisk, minutesUntilMidnight, remainingWording } from "../pure/streaks.js";

const NOW = new Date(2026, 8, 6, 20, 30, 0); // 2026-09-06 8:30pm local
const today = at => ({ at: at.getTime() });

test("minutesUntilMidnight counts to the next LOCAL midnight", () => {
  assert.equal(minutesUntilMidnight(new Date(2026, 8, 6, 23, 59, 0)), 1);
  assert.equal(minutesUntilMidnight(new Date(2026, 8, 6, 20, 30, 0)), 210); // 3h 30m
  assert.equal(minutesUntilMidnight(new Date(2026, 8, 6, 0, 0, 0)), 1440);
});

test("remainingWording phrases the three shapes", () => {
  assert.equal(remainingWording(200), "3h 20m left");
  assert.equal(remainingWording(45), "45m left");
  assert.equal(remainingWording(180), "3h left");
  assert.equal(remainingWording(0), "under a minute left");
});

test("streakRisk names every open streak and stays silent about done ones", () => {
  const risk = streakRisk(
    {
      ...today(NOW),
      searchPoints: "40/60", // open
      activities: { dailySet: "3/3", visualSearch: "1/1" }, // both done
      keepEarning: { open: 2, total: 4 } // open
    },
    NOW
  );
  assert.deepEqual(risk.atRisk.map(r => r.id), ["search", "keepEarning"]);
  assert.equal(risk.atRisk[0].detail, "40/60");
  assert.equal(risk.atRisk[1].detail, "2 of 4 left");
  assert.equal(risk.minutesLeft, 210);
});

test("streakRisk is silent when every streak is closed", () => {
  const risk = streakRisk(
    {
      ...today(NOW),
      searchPoints: "60/60",
      activities: { dailySet: "3/3", visualSearch: "1/1" },
      keepEarning: { open: 0, total: 4 }
    },
    NOW
  );
  assert.deepEqual(risk.atRisk, []);
});

test("streakRisk returns null for a stale or missing read, never an empty list", () => {
  // The distinction matters: "nothing at risk" and "nothing known" must not
  // render the same way.
  assert.equal(streakRisk(null, NOW), null);
  assert.equal(streakRisk({}, NOW), null);
  assert.equal(
    streakRisk({ at: new Date(2026, 8, 5, 23, 0, 0).getTime(), searchPoints: "0/60" }, NOW),
    null
  );
  // Midnight rollover: a read from 23:59 is yesterday's at 00:01.
  assert.equal(
    streakRisk(
      { at: new Date(2026, 8, 6, 23, 59, 0).getTime(), searchPoints: "0/60" },
      new Date(2026, 8, 7, 0, 1, 0)
    ),
    null
  );
});

test("streakRisk runs an unread streak with no detail rather than calling it done", () => {
  // The house rule: an unknown is never a "done". The row shows without a
  // number, which is honest; hiding it would not be.
  const risk = streakRisk({ ...today(NOW) }, NOW);
  assert.deepEqual(
    risk.atRisk.map(r => [r.id, r.detail]),
    [
      ["search", null],
      ["dailySet", null],
      ["imageSearch", null],
      ["keepEarning", null]
    ]
  );
});

test("streakRisk and the routine agree: every row is a step the routine runs", () => {
  // The guard imports stepSkipReason, so this is really a guard against a
  // future refactor that re-derives the verdict — the two must move together.
  const stats = {
    ...today(NOW),
    searchPoints: "60/60",
    activities: { dailySet: "2/3", visualSearch: "1/1" },
    keepEarning: { open: 0, total: 2 }
  };
  const risk = streakRisk(stats, NOW);
  assert.deepEqual(risk.atRisk.map(r => r.id), ["dailySet"]);
});
