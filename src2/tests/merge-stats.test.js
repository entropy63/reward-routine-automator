// mergeStats — the pure merge of the dashboard and Earn page reads. No
// chrome stub needed: the module touches nothing but its arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStats } from "../pure/merge-stats.js";

test("a null Earn read never erases the dashboard's finds", () => {
  const merged = mergeStats(
    {
      availablePoints: "5,113",
      readyToClaim: "0",
      dailyStreak: "Day 4",
      stampBonus: "11/12",
      searchPoints: "40/60",
      activities: { bingSearch: "1/1", dailySet: "2/3" }
    },
    null
  );
  assert.equal(merged.availablePoints, "5,113");
  assert.equal(merged.dailyStreak, "Day 4");
  assert.equal(merged.stampBonus, "11/12");
  assert.equal(merged.searchPoints, "40/60");
  assert.equal(merged.activities.bingSearch, "1/1");
  assert.equal(merged.activities.dailySet, "2/3");
});

test("Earn wins the activities, the dashboard keeps the top cards", () => {
  const merged = mergeStats(
    {
      availablePoints: "5,113",
      activities: { bingSearch: "1/1", dailySet: "1/1", bingApp: "0/1", visualSearch: "2/2" }
    },
    {
      activities: {
        bingSearch: "Day 4 of 7 · 1/1",
        dailySet: "Day 2 of 3 · 2/3"
      }
    }
  );
  // The Earn streak cards' richer answer shadows the dashboard tiles' bare
  // progress pair — the exact regression the user's first live run showed.
  assert.equal(merged.activities.bingSearch, "Day 4 of 7 · 1/1");
  assert.equal(merged.activities.dailySet, "Day 2 of 3 · 2/3");
  // An activity only the dashboard found survives as the fallback.
  assert.equal(merged.activities.bingApp, "0/1");
  assert.equal(merged.activities.visualSearch, "2/2");
  // The top cards were always dashboard-first.
  assert.equal(merged.availablePoints, "5,113");
});

test("the stamp bonus takes the star-count shape by value, either page", () => {
  // The dashboard's old points read loses to the Earn page's star count…
  assert.equal(
    mergeStats({ stampBonus: "1,000 pts" }, { stampBonus: "11/12" }).stampBonus,
    "11/12"
  );
  // …and the dashboard's star count wins over the Earn page's points read.
  assert.equal(
    mergeStats({ stampBonus: "11/12" }, { stampBonus: "1,000 pts" }).stampBonus,
    "11/12"
  );
  // When neither is a star count, the dashboard's answer holds.
  assert.equal(
    mergeStats({ stampBonus: "1,000 pts" }, { stampBonus: "500 pts" }).stampBonus,
    "1,000 pts"
  );
  // A miss never erases: null on one side defers to the other.
  assert.equal(mergeStats({ stampBonus: null }, { stampBonus: "9/12" }).stampBonus, "9/12");
  assert.equal(mergeStats(null, { stampBonus: "9/12" }).stampBonus, "9/12");
});

test("two empty reads merge to an all-null record", () => {
  const merged = mergeStats(null, {});
  assert.equal(merged.availablePoints, null);
  assert.equal(merged.readyToClaim, null);
  assert.equal(merged.dailyStreak, null);
  assert.equal(merged.stampBonus, null);
  assert.equal(merged.searchPoints, null);
  assert.deepEqual(merged.activities, {
    bingSearch: null,
    dailySet: null,
    bingApp: null,
    visualSearch: null
  });
});
