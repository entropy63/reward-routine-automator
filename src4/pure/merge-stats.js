// Combines the two page reads behind the stats panel: the dashboard's and the
// Earn page's. The 2026-09 redesign split them (the user confirmed
// 2026-09-03): the dashboard keeps the top cards (Available points, Ready to
// claim, Daily streak) and the stamp bonus card, while the four streak cards
// live only on the Earn page. The top cards keep the dashboard's answer; the
// four activity keys take the Earn page's (its streak cards carry both
// values, the dashboard's old tiles only the progress half); the stamp bonus
// takes whichever answer is the star count ("11/12") over the older "1,000
// pts" read. In every case a page that failed to load, or a reader that
// found nothing on it, never erases what the other page did find. Pure on
// purpose: the tests import it directly.

export function mergeStats(dashboard, earn) {
  const a = dashboard || {};
  const b = earn || {};

  function firstNonNull(key, left, right) {
    if (left[key] != null) return left[key];
    if (right[key] != null) return right[key];
    return null;
  }

  const activities = {};
  const aActs = a.activities || {};
  const bActs = b.activities || {};
  // The activities are the one pair where the EARN read (b) wins: its streak
  // cards carry both values ("Day 4 of 7 · 1/1"), while the dashboard's
  // progressbar tiles only ever answer the progress half ("1/1") — with
  // dashboard-first order the tiles' shorter answer shadowed the richer Earn
  // value (exactly what the user's first live run of the two-page read
  // showed: every streak displayed "1/1" with no day count). The tiles
  // remain the fallback for an Earn page that renders no cards.
  for (const key of ["bingSearch", "dailySet", "bingApp", "visualSearch"]) {
    activities[key] = firstNonNull(key, bActs, aActs);
  }

  // The stamp bonus follows the same rule by VALUE, not by page: a
  // slash-shaped answer ("11/12") is the redesigned star count the user
  // asked for, while "1,000 pts" is the older card's points read — the
  // dashboard still answers the old shape, and dashboard-first order showed
  // "1,000 pts" instead of the lit-star count on the user's live run.
  function pickStampBonus() {
    const isStarCount = v => typeof v === "string" && /^\d+\/\d+$/.test(v);
    if (isStarCount(a.stampBonus)) return a.stampBonus;
    if (isStarCount(b.stampBonus)) return b.stampBonus;
    return firstNonNull("stampBonus", a, b);
  }

  return {
    availablePoints: firstNonNull("availablePoints", a, b),
    readyToClaim: firstNonNull("readyToClaim", a, b),
    dailyStreak: firstNonNull("dailyStreak", a, b),
    stampBonus: pickStampBonus(),
    // The search-points cap: both pages can carry the Today's points card,
    // and both answers are today's truth — whichever page's breakdown
    // answered wins, a miss never erasing the other page's find.
    searchPoints: firstNonNull("searchPoints", a, b),
    activities
  };
}
