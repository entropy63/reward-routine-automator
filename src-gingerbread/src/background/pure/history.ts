// The points history — "what did the balance do over time?" (ADR-020). The
// stats read records one entry per local day: the day's FIRST balance and
// its LAST, so both "earned today" (last − first) and a trend line (each
// day's last) come out of the same small list. Pure: the list in, the next
// list out; the storage write lives in readers/stats.ts, the renders in the
// popup.

import type { HistoryEntry } from '../../shared/storage.ts'

// How many days the history keeps. 60 covers two months at one entry per
// day — a few hundred bytes — while the popup only ever renders the last 7.
export const HISTORY_MAX_DAYS = 60

// A balance display string ("5,113") → number, or null when it holds no
// digits at all. Same parse the Redeem button's affordability check uses.
export function parsePoints(value: unknown): number | null {
  const digits = String(value == null ? '' : value).replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

// Records one day's balance into the history: a new day appends
// { day, first, last, at }, a day already present only moves its `last`.
// The result is a fresh, day-sorted list capped at HISTORY_MAX_DAYS —
// corrupt entries (no day, non-numeric balances) are dropped rather than
// trusted, the same only-wrong-answer-is-lying direction as the verdicts.
export function recordDay(
  history: HistoryEntry[] | null | undefined,
  day: string,
  points: number,
  now: number = Date.now(),
): HistoryEntry[] {
  const list: HistoryEntry[] = (Array.isArray(history) ? history : [])
    .filter(
      (entry): entry is HistoryEntry =>
        !!entry &&
        typeof entry.day === 'string' &&
        Number.isFinite(entry.first) &&
        Number.isFinite(entry.last),
    )
    .map((entry) => ({ day: entry.day, first: entry.first, last: entry.last, at: entry.at || 0 }))

  const entry = list.find((e) => e.day === day)
  if (entry) {
    entry.last = points
    entry.at = now
  } else {
    list.push({ day, first: points, last: points, at: now })
  }

  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return list.slice(-HISTORY_MAX_DAYS)
}

// The day's balance change: last − first, or null when the day has no
// entry yet. Can be negative (a redeem spends points) — the caller decides
// how to phrase that; the number stays honest.
export function earnedToday(history: HistoryEntry[] | null | undefined, day: string): number | null {
  const entry = (Array.isArray(history) ? history : []).find((e) => e && e.day === day)
  return entry ? entry.last - entry.first : null
}

// The average daily gain across the newest `days` snapshots, measured from
// the oldest snapshot's FIRST balance to the newest one's LAST. Null when
// there is no measurable positive trend — fewer than two snapshots, or a
// balance that went down — because "0 days to your goal" off a negative
// slope would be a lie.
export function trendPerDay(history: HistoryEntry[] | null | undefined, days: number = 7): number | null {
  const recent = (Array.isArray(history) ? history : []).slice(-days)
  if (recent.length < 2) return null

  const gained = recent[recent.length - 1].last - recent[0].first
  const intervals = recent.length - 1
  const perDay = gained / intervals
  return perDay > 0 ? perDay : null
}

// Days until the balance reaches the target at the given daily rate:
// 0 when it is already there, null when the rate can't answer (no positive
// trend). Rounded up — "3.1 days" is not a day the user can wait for.
export function goalDaysRemaining(balance: number, target: number, perDay: number | null): number | null {
  if (!Number.isFinite(balance) || !Number.isFinite(target)) return null
  if (balance >= target) return 0
  if (perDay == null || !Number.isFinite(perDay) || perDay <= 0) return null
  return Math.ceil((target - balance) / perDay)
}
