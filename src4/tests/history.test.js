// The points history (ADR-020): the day-keyed balance log the stats read
// records and the Today view renders. Pure, so the tests pin the day
// boundaries, the cap and the trend math directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_MAX_DAYS,
  parsePoints,
  recordDay,
  earnedToday,
  trendPerDay,
  goalDaysRemaining
} from "../pure/history.js";

test("parsePoints reads the digits out of a display string", () => {
  assert.equal(parsePoints("5,113"), 5113);
  assert.equal(parsePoints("460"), 460);
  assert.equal(parsePoints(" 12,000 pts "), 12000);
  assert.equal(parsePoints("0"), 0);
});

test("parsePoints answers null when there are no digits at all", () => {
  assert.equal(parsePoints(""), null);
  assert.equal(parsePoints("—"), null);
  assert.equal(parsePoints(null), null);
  assert.equal(parsePoints(undefined), null);
});

test("recordDay appends a new day with first and last both set", () => {
  const list = recordDay([], "2026-09-05", 5000, 1);
  assert.deepEqual(list, [{ day: "2026-09-05", first: 5000, last: 5000, at: 1 }]);
});

test("recordDay moves only the last of a day already present", () => {
  const list = recordDay(
    [{ day: "2026-09-05", first: 5000, last: 5100, at: 1 }],
    "2026-09-05",
    5250,
    2
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].first, 5000);
  assert.equal(list[0].last, 5250);
  assert.equal(list[0].at, 2);
});

test("recordDay sorts by day and caps the list at HISTORY_MAX_DAYS", () => {
  let list = [];
  for (let i = 1; i <= HISTORY_MAX_DAYS + 5; i++) {
    const day = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    list = recordDay(list, day, i * 100);
  }
  assert.equal(list.length, HISTORY_MAX_DAYS);
  // The newest days survive; the list stays day-sorted.
  assert.ok(list[0].day < list[list.length - 1].day);
  assert.equal(list[list.length - 1].last, (HISTORY_MAX_DAYS + 5) * 100);
});

test("recordDay drops corrupt entries rather than trusting them", () => {
  const list = recordDay(
    [
      null,
      { day: "2026-09-04" }, // no balances
      { day: "2026-09-03", first: "x", last: "y", at: 3 },
      { day: "2026-09-02", first: 10, last: 20, at: 2 }
    ],
    "2026-09-05",
    100
  );
  assert.deepEqual(
    list.map(entry => entry.day),
    ["2026-09-02", "2026-09-05"]
  );
});

test("earnedToday is the day's last minus first", () => {
  const list = [{ day: "2026-09-06", first: 5000, last: 5090, at: 1 }];
  assert.equal(earnedToday(list, "2026-09-06"), 90);
});

test("earnedToday can be negative after a redeem — and stays honest", () => {
  const list = [{ day: "2026-09-06", first: 5000, last: 1000, at: 1 }];
  assert.equal(earnedToday(list, "2026-09-06"), -4000);
});

test("earnedToday answers null for a day with no entry", () => {
  assert.equal(earnedToday([], "2026-09-06"), null);
  assert.equal(
    earnedToday([{ day: "2026-09-05", first: 1, last: 2, at: 1 }], "2026-09-06"),
    null
  );
});

test("trendPerDay measures the window first-balance to last-balance", () => {
  // 7 days climbing 10 points a day: the oldest day's first (5000) to the
  // newest day's last (5060) spans 60 points over 6 intervals: 10/day.
  const list = Array.from({ length: 7 }, (_, i) => ({
    day: `2026-08-${31 + i}`,
    first: 5000 + i * 10,
    last: 5000 + i * 10,
    at: i
  }));
  assert.equal(trendPerDay(list, 7), 10);
});

test("trendPerDay answers null with fewer than two snapshots", () => {
  assert.equal(trendPerDay([], 7), null);
  assert.equal(
    trendPerDay([{ day: "2026-09-06", first: 1, last: 2, at: 1 }], 7),
    null
  );
});

test("trendPerDay answers null when the balance went down — a spend is not a rate", () => {
  const list = [
    { day: "2026-09-05", first: 5000, last: 5060, at: 1 },
    { day: "2026-09-06", first: 5060, last: 1000, at: 2 }
  ];
  assert.equal(trendPerDay(list, 7), null);
});

test("goalDaysRemaining rounds up, and 0 means already there", () => {
  assert.equal(goalDaysRemaining(5000, 6000, 10), 100);
  assert.equal(goalDaysRemaining(5995, 6000, 10), 1); // 0.5 days rounds up
  assert.equal(goalDaysRemaining(6000, 6000, 10), 0);
  assert.equal(goalDaysRemaining(7000, 6000, 10), 0);
});

test("goalDaysRemaining answers null when the rate cannot get there", () => {
  assert.equal(goalDaysRemaining(5000, 6000, null), null);
  assert.equal(goalDaysRemaining(5000, 6000, 0), null);
  assert.equal(goalDaysRemaining(5000, 6000, -10), null);
  assert.equal(goalDaysRemaining(null, 6000, 10), null);
  assert.equal(goalDaysRemaining(5000, null, 10), null);
});
