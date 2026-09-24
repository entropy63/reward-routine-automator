import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTimeOfDay, nextScheduledAt, to12Hour, from12Hour, scheduledDue } from '../src/background/pure/schedule.ts'

// The scheduled run's clock (user request, 2026-09-12): the routine fires once
// a day at the user-specified "HH:MM". These tests pin the parse and the
// day-boundary walk with injected `now` values — the wall clock is never read.
// scheduledDue (2026-09-22 rebuild) pins the "is it due right now?" check that
// every trigger — the periodic heartbeat, each worker wake, the punctual alarm
// — funnels through: at/past today's time and today unhandled = due, no
// missed-alarm bookkeeping.

const at = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(y, mo - 1, d, h, mi, 0, 0)

// ---- scheduledDue ----
// Default: schedule on at 09:00, nothing handled yet, now = 14:00 on
// 2026-09-15 (comfortably past the time) — so the bare default is DUE.

const due = (over: Partial<Parameters<typeof scheduledDue>[0]>) =>
  scheduledDue({
    enabled: true,
    scheduledTime: '09:00',
    lastHandledDay: null,
    now: at(2026, 9, 15, 14, 0),
    ...over,
  })

test('past the time today and unhandled — due', () => {
  assert.deepEqual(due({}), { due: true, day: '2026-09-15' })
})

test('the toggle off is never due', () => {
  assert.deepEqual(due({ enabled: false }), { due: false, reason: 'disabled' })
})

test('an unparsable time is never due — a broken clock, not a fire loop', () => {
  assert.deepEqual(due({ scheduledTime: 'junk' }), { due: false, reason: 'bad-time' })
})

test('before the time today is not yet due', () => {
  assert.deepEqual(due({ now: at(2026, 9, 15, 8, 0) }), { due: false, reason: 'early' })
})

test('already handled today is not due again — the once-a-day latch', () => {
  assert.deepEqual(due({ lastHandledDay: '2026-09-15' }), { due: false, reason: 'done-today' })
})

test('handled yesterday and now past today — due (the next-day case)', () => {
  // The bug the rebuild fixes: the browser was left for a day, the moment came,
  // the old one-shot never delivered. Here the wall clock alone owes the round.
  assert.deepEqual(due({ lastHandledDay: '2026-09-14' }), { due: true, day: '2026-09-15' })
})

test('exactly at the moment counts as due — no gap at the boundary', () => {
  assert.deepEqual(due({ now: at(2026, 9, 15, 9, 0) }), { due: true, day: '2026-09-15' })
})

test('one tick before the moment is still early', () => {
  assert.deepEqual(due({ now: new Date(at(2026, 9, 15, 9, 0).getTime() - 1) }), {
    due: false,
    reason: 'early',
  })
})

test('parseTimeOfDay accepts 24-hour HH:MM', () => {
  assert.equal(parseTimeOfDay('09:00'), 9 * 60)
  assert.equal(parseTimeOfDay('23:59'), 23 * 60 + 59)
  assert.equal(parseTimeOfDay('0:05'), 5)
  assert.equal(parseTimeOfDay('00:00'), 0)
})

test('parseTimeOfDay rejects junk', () => {
  for (const bad of ['', '9am', '24:00', '12:60', '09-00', undefined, null]) {
    assert.equal(parseTimeOfDay(bad as string), null, `${String(bad)} must not parse`)
  }
})

test('a time still ahead lands today', () => {
  const now = at(2026, 9, 12, 8, 0)
  const next = nextScheduledAt('09:00', now)
  assert.equal(next, at(2026, 9, 12, 9, 0).getTime())
})

test('a time already past lands tomorrow', () => {
  const now = at(2026, 9, 12, 10, 30)
  const next = nextScheduledAt('09:00', now)
  assert.equal(next, at(2026, 9, 13, 9, 0).getTime())
})

test('the exact moment counts as past — no double-fire window', () => {
  const fireTime = at(2026, 9, 12, 9, 0)
  assert.equal(nextScheduledAt('09:00', fireTime), at(2026, 9, 13, 9, 0).getTime())
  // One tick before it is still today's moment.
  assert.equal(nextScheduledAt('09:00', new Date(fireTime.getTime() - 1)), fireTime.getTime())
})

test('midnight rolls to the next day, not two days out', () => {
  const now = at(2026, 9, 12, 23, 59)
  const next = nextScheduledAt('00:00', now)
  assert.equal(next, at(2026, 9, 13, 0, 0).getTime())
})

test('month and year boundaries roll correctly', () => {
  // Sept 30 → Oct 1, and Dec 31 → Jan 1 of the next year.
  assert.equal(nextScheduledAt('09:00', at(2026, 9, 30, 10, 0)), at(2026, 10, 1, 9, 0).getTime())
  assert.equal(nextScheduledAt('09:00', at(2026, 12, 31, 10, 0)), at(2027, 1, 1, 9, 0).getTime())
})

test('an unparsable time has no next occurrence', () => {
  assert.equal(nextScheduledAt('junk', at(2026, 9, 12, 8, 0)), null)
})

// The 12-hour face the popup edits: storage stays 24-hour "HH:MM", only the
// editing is 1–12 + AM/PM. These pin the two half-past-twelves and the
// round-trip through every hour of the day.
test('to12Hour reads the clock face people read', () => {
  assert.deepEqual(to12Hour(0), { hour: 12, minute: 0, meridiem: 'AM' }) // midnight
  assert.deepEqual(to12Hour(9 * 60), { hour: 9, minute: 0, meridiem: 'AM' })
  assert.deepEqual(to12Hour(11 * 60 + 59), { hour: 11, minute: 59, meridiem: 'AM' })
  assert.deepEqual(to12Hour(12 * 60), { hour: 12, minute: 0, meridiem: 'PM' }) // noon
  assert.deepEqual(to12Hour(13 * 60 + 30), { hour: 1, minute: 30, meridiem: 'PM' })
  assert.deepEqual(to12Hour(23 * 60), { hour: 11, minute: 0, meridiem: 'PM' })
})

test('from12Hour folds 12 back onto the day', () => {
  assert.equal(from12Hour(12, 0, 'AM'), 0) // 12 AM is midnight
  assert.equal(from12Hour(12, 0, 'PM'), 12 * 60) // 12 PM is noon
  assert.equal(from12Hour(9, 0, 'AM'), 9 * 60)
  assert.equal(from12Hour(9, 0, 'PM'), 21 * 60)
  assert.equal(from12Hour(11, 59, 'PM'), 23 * 60 + 59)
})

test('to12Hour and from12Hour round-trip every hour of the day', () => {
  for (let h = 0; h < 24; h++) {
    const face = to12Hour(h * 60 + 30)
    assert.equal(from12Hour(face.hour, face.minute, face.meridiem), h * 60 + 30, `hour ${h} must survive`)
  }
})

test('the 12-hour converters tolerate junk', () => {
  // Minutes outside the day wrap; minutes past 59 clamp.
  assert.deepEqual(to12Hour(1440 + 90), { hour: 1, minute: 30, meridiem: 'AM' })
  assert.equal(from12Hour(13, 99, 'AM'), 13 * 60 + 59 - 720) // 1:59 AM
})
