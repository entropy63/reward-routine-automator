// The scheduled daily run's clock math (ADR-019). Pure: a "HH:MM" string and
// a moment in, the next fire moment out — the alarm's `when` is the only
// effect, and it lives in background.js. Pure on purpose: the tests import
// it directly and pin the day boundaries.

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
