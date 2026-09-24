// The scheduled run's clock math (user request, 2026-09-12): fire the startup
// routine once a day at the time the user specifies — including in a browser
// that never closes and reopens. Pure so the parse and the day-boundary walk
// are unit-tested; the effectful driver lives in routine/scheduled.ts.

import { localDayKey } from '../core/day.ts'

// Parse a 24-hour "HH:MM" string into minutes since midnight; null when it
// isn't one (an unparsable time is a broken clock, never a fire loop).
export function parseTimeOfDay(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// The epoch-ms moment of the next occurrence of that time of day, from `now`:
// today when it is still ahead, else tomorrow. Constructed in local time (the
// user thinks in wall-clock), and a DST shift mid-night simply lands the alarm
// at the wall-clock time the new day resolves to.
export function nextScheduledAt(timeOfDay: string, now: Date = new Date()): number | null {
  const mins = parseTimeOfDay(timeOfDay)
  if (mins == null) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
  if (today.getTime() > now.getTime()) return today.getTime()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.getTime()
}

// Is today's scheduled round due RIGHT NOW? (user report 2026-09-15, restated
// 2026-09-22 "the schedule feature does not work": the close-time test fires,
// the next-day leave never does.) The old design leaned on a one-shot `when`
// alarm delivering ~24h later — and Chrome never delivers a past-due alarm, so
// a browser closed (or a PC asleep) at the moment silently lost the day. This
// replaces that fragile delivery assumption with a time-based check any wake
// can evaluate: a periodic heartbeat (and every worker wake, and the punctual
// alarm) asks this function, and it fires the round the moment the clock is at
// or past today's time and today hasn't been handled yet. No missed-alarm
// bookkeeping — the wall clock is the source of truth, not alarm delivery.
export interface DueInput {
  enabled: boolean
  // The 24-hour "HH:MM" the routine should fire at.
  scheduledTime: string
  // localDayKey of the last scheduled round already handled today (fired or
  // visibly skipped) — the once-a-day latch, so repeated heartbeats after the
  // moment don't re-run the round.
  lastHandledDay: string | null
  now: Date
}

export type DueDecision =
  | { due: true; day: string }
  | { due: false; reason: 'disabled' | 'bad-time' | 'early' | 'done-today' }

export function scheduledDue(input: DueInput): DueDecision {
  if (!input.enabled) return { due: false, reason: 'disabled' }
  const mins = parseTimeOfDay(input.scheduledTime)
  // An unparsable time is a broken clock, never a fire loop.
  if (mins == null) return { due: false, reason: 'bad-time' }
  const today = localDayKey(input.now)
  // Already run (or skipped) today — the once-a-day latch.
  if (input.lastHandledDay === today) return { due: false, reason: 'done-today' }
  const moment = new Date(
    input.now.getFullYear(),
    input.now.getMonth(),
    input.now.getDate(),
    Math.floor(mins / 60),
    mins % 60,
    0,
    0,
  )
  // Not there yet today — the alarm/heartbeat will ask again after the moment.
  if (input.now.getTime() < moment.getTime()) return { due: false, reason: 'early' }
  return { due: true, day: today }
}

// The 12-hour face the popup edits (user request, 2026-09-12: "there should be
// an option for am pm"): storage stays the 24-hour "HH:MM" the clock above
// parses, only the EDITING is 1–12 + AM/PM. Junk minutes clamp to the day.
export type Meridiem = 'AM' | 'PM'

export function to12Hour(mins: number): { hour: number; minute: number; meridiem: Meridiem } {
  const clamped = ((Math.trunc(mins) % 1440) + 1440) % 1440
  const h = Math.floor(clamped / 60)
  return {
    hour: ((h + 11) % 12) + 1,
    minute: clamped % 60,
    meridiem: h < 12 ? 'AM' : 'PM',
  }
}

export function from12Hour(hour: number, minute: number, meridiem: Meridiem): number {
  const h = ((Math.trunc(hour) % 12) + 12) % 12
  const m = Math.min(59, Math.max(0, Math.trunc(minute)))
  return (meridiem === 'PM' ? h + 12 : h) * 60 + m
}

