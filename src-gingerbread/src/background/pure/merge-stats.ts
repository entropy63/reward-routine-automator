// Combines the two page reads behind the stats panel: the dashboard's and the
// Earn page's. The 2026-09 redesign split them: the dashboard keeps the top
// cards (Available points, Ready to claim, Daily streak) and the stamp bonus
// card, while the four streak cards live only on the Earn page. The top cards
// keep the dashboard's answer; the four activity keys take the Earn page's;
// the stamp bonus takes whichever answer is the star count ("11/12") over the
// older "1,000 pts" read. In every case a page that failed to load, or a
// reader that found nothing on it, never erases what the other page did find.
// Pure on purpose: the tests import it directly.

import type { Activities, RawStats, Stats } from '../../shared/storage.ts'

type AnyRecord = Record<string, unknown>

export function mergeStats(dashboard?: RawStats | null, earn?: RawStats | null): Stats {
  const a = (dashboard || {}) as RawStats
  const b = (earn || {}) as RawStats

  function firstNonNull(key: string, left: AnyRecord, right: AnyRecord): string | null {
    if (left[key] != null) return left[key] as string
    if (right[key] != null) return right[key] as string
    return null
  }

  const activities = {} as Activities
  const aActs = (a.activities || {}) as AnyRecord
  const bActs = (b.activities || {}) as AnyRecord
  // The activities are the one pair where the EARN read (b) wins: its streak
  // cards carry both values ("Day 4 of 7 · 1/1"), while the dashboard's
  // progressbar tiles only ever answer the progress half ("1/1"). The tiles
  // remain the fallback for an Earn page that renders no cards.
  for (const key of ['bingSearch', 'dailySet', 'bingApp', 'visualSearch'] as (keyof Activities)[]) {
    activities[key] = firstNonNull(key, bActs, aActs)
  }

  // The stamp bonus follows the same rule by VALUE, not by page: a
  // slash-shaped answer ("11/12") is the redesigned star count the user
  // asked for, while "1,000 pts" is the older card's points read.
  function pickStampBonus(): string | null {
    const isStarCount = (v: unknown): v is string => typeof v === 'string' && /^\d+\/\d+$/.test(v)
    if (isStarCount(a.stampBonus)) return a.stampBonus
    if (isStarCount(b.stampBonus)) return b.stampBonus
    return firstNonNull('stampBonus', a as AnyRecord, b as AnyRecord)
  }

  return {
    availablePoints: firstNonNull('availablePoints', a as AnyRecord, b as AnyRecord),
    readyToClaim: firstNonNull('readyToClaim', a as AnyRecord, b as AnyRecord),
    dailyStreak: firstNonNull('dailyStreak', a as AnyRecord, b as AnyRecord),
    stampBonus: pickStampBonus(),
    // The membership tier is a header extra (the medal lives on the
    // dashboard), so the dashboard read wins; the Earn read stays the
    // fallback for a page that renders it there instead.
    membership: firstNonNull('membership', a as AnyRecord, b as AnyRecord),
    // The search-points cap: both pages can carry the Today's points card,
    // and both answers are today's truth — whichever page's breakdown
    // answered wins, a miss never erasing the other page's find.
    searchPoints: firstNonNull('searchPoints', a as AnyRecord, b as AnyRecord),
    activities,
    // The keep-earning counts are Earn-page data (that is where the section
    // lives), so the Earn read wins; the dashboard's answer stays as the
    // fallback for the odd account that renders it there instead. An object
    // rather than a string, so firstNonNull cannot carry it.
    keepEarning: b.keepEarning != null ? b.keepEarning : a.keepEarning != null ? a.keepEarning : null,
  }
}
