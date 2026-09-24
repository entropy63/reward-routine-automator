// The points history — "what did the balance do over time?" (ADR-020). The
// stats read records one entry per local day: the day's FIRST balance and
// its LAST, so both "earned today" (last − first) and a trend line (each
// day's last) come out of the same small list. Pure: the list in, the next
// list out; the storage write lives in readers/stats.js, the renders in the
// popup. Pure on purpose: the tests pin the day boundaries and the window
// math directly.

import { localDayKey } from "../lib/day.js";

// How many days the history keeps. 60 covers two months at one entry per
// day — a few hundred bytes — while the popup only ever renders the last 7.
export const HISTORY_MAX_DAYS = 60;

// A balance display string ("5,113") → number, or null when it holds no
// digits at all. Same parse the Redeem button's affordability check uses.
export function parsePoints(value) {
  const digits = String(value == null ? "" : value).replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

// Records one day's balance into the history: a new day appends
// { day, first, last, at }, a day already present only moves its `last`.
// The result is a fresh, day-sorted list capped at HISTORY_MAX_DAYS —
// corrupt entries (no day, non-numeric balances) are dropped rather than
// trusted, the same only-wrong-answer-is-lying direction as the verdicts.
export function recordDay(history, day, points, now = Date.now()) {
  const list = (Array.isArray(history) ? history : [])
    .filter(
      entry =>
        entry &&
        typeof entry.day === "string" &&
        Number.isFinite(entry.first) &&
        Number.isFinite(entry.last)
    )
    .map(entry => ({ day: entry.day, first: entry.first, last: entry.last, at: entry.at || 0 }));

  const entry = list.find(e => e.day === day);
  if (entry) {
    entry.last = points;
    entry.at = now;
  } else {
    list.push({ day, first: points, last: points, at: now });
  }

  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return list.slice(-HISTORY_MAX_DAYS);
}

// The day's balance change: last − first, or null when the day has no
// entry yet. Can be negative (a redeem spends points) — the caller decides
// how to phrase that; the number stays honest.
export function earnedToday(history, day) {
  const entry = (Array.isArray(history) ? history : []).find(e => e && e.day === day);
  return entry ? entry.last - entry.first : null;
}

// The average daily gain across the newest `days` snapshots, measured from
// the oldest snapshot's FIRST balance to the newest one's LAST (so a day
// half-observed at the window's edge still counts what it earned while
// watched). Null when there is no measurable positive trend — fewer than
// two snapshots, or a balance that went down (a spend) — because "0 days to
// your goal" off a negative slope would be a lie.
export function trendPerDay(history, days = 7) {
  const recent = (Array.isArray(history) ? history : []).slice(-days);
  if (recent.length < 2) return null;

  const gained = recent[recent.length - 1].last - recent[0].first;
  const intervals = recent.length - 1;
  const perDay = gained / intervals;
  return perDay > 0 ? perDay : null;
}

// Days until the balance reaches the target at the given daily rate:
// 0 when it is already there, null when the rate can't answer (no positive
// trend). Rounded up — "3.1 days" is not a day the user can wait for.
export function goalDaysRemaining(balance, target, perDay) {
  if (!Number.isFinite(balance) || !Number.isFinite(target)) return null;
  if (balance >= target) return 0;
  if (!Number.isFinite(perDay) || perDay <= 0) return null;
  return Math.ceil((target - balance) / perDay);
}

// The goal alert's verdict (build 4): should the popup's goal card — and the
// user's phone — say something today?
//
//   reached     the balance is at or past the target
//   daysLeft    days remaining at the recent rate, or null when unknowable
//   shouldAlert whether this is a day worth a notification
//
// `daysBefore` is the user's own lead time: alert once the goal is within that
// many days, including the day it lands. The alert fires on the CROSSING, not
// on every read — the caller latches `shouldAlert` per state — so this stays a
// pure description of the moment and never has to know what was announced.
//
// A null `daysLeft` (no positive trend, no history yet) is deliberately NOT an
// alert: "you will never get there" is not a useful notification, and the
// popup's goal card already says the trend is unmeasurable.
//
// No goal set (target 0, the default) is not an alert either. That case has to
// be answered HERE rather than left to the caller: goalDaysRemaining sees any
// non-negative balance as having passed a 0 target and answers 0 days, which
// would read as "reached today" and nag a user who never asked for a goal.
export function goalState(balance, target, history, daysBefore = 1, days = 7) {
  const hasGoal = Number.isFinite(target) && target > 0;
  if (!hasGoal) return { reached: false, daysLeft: null, shouldAlert: false };

  const reached = Number.isFinite(balance) && balance >= target;
  const daysLeft = reached ? 0 : goalDaysRemaining(balance, target, trendPerDay(history, days));

  let shouldAlert = false;
  if (reached) {
    shouldAlert = true;
  } else if (Number.isFinite(daysLeft)) {
    const lead = Number.isFinite(daysBefore) && daysBefore >= 0 ? Math.floor(daysBefore) : 1;
    shouldAlert = daysLeft <= lead;
  }

  return { reached, daysLeft, shouldAlert };
}

// "5,113" — the balance and the goal read as amounts wherever they are shown,
// and the history module is already the one place that turns stored values
// into user-facing numbers.
function amount(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// The alert's wording, kept beside the verdict that decides it: "reached" ends
// the chase, "near" is the user's own lead time doing its job. Both name the
// real numbers — an alert that only says "your goal is close" makes the user
// open the extension to find out what that means.
export function goalMessage(state, balance, target) {
  const goal = amount(target);
  if (state.reached) {
    return `You're at ${amount(balance)} points — your ${goal}-point goal is reached. Redeem whenever you like.`;
  }
  const days = state.daysLeft;
  const away = days === 1 ? "about a day" : `about ${days} days`;
  return `You're at ${amount(balance)} points — ${away} from your ${goal}-point goal at your recent pace.`;
}

