import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePoints,
  recordDay,
  earnedToday,
  trendPerDay,
  goalDaysRemaining,
  HISTORY_MAX_DAYS,
} from '../src/background/pure/history.ts'
import type { HistoryEntry } from '../src/shared/storage.ts'

test('parsePoints strips separators, null when no digits', () => {
  assert.equal(parsePoints('5,113'), 5113)
  assert.equal(parsePoints('1 234 pts'), 1234)
  assert.equal(parsePoints(''), null)
  assert.equal(parsePoints('no digits'), null)
  assert.equal(parsePoints(null), null)
})

test('recordDay appends a new day and moves an existing day’s last', () => {
  let h = recordDay([], '2026-09-06', 100, 1)
  assert.deepEqual(h, [{ day: '2026-09-06', first: 100, last: 100, at: 1 }])
  // same day → only last + at move; first is preserved
  h = recordDay(h, '2026-09-06', 160, 2)
  assert.deepEqual(h, [{ day: '2026-09-06', first: 100, last: 160, at: 2 }])
  // a new day appends and the list stays day-sorted
  h = recordDay(h, '2026-09-07', 170, 3)
  assert.deepEqual(h.map((e) => e.day), ['2026-09-06', '2026-09-07'])
})

test('recordDay drops corrupt entries and caps the length', () => {
  const corrupt = [{ day: 123 }, { day: 'x', first: 'a', last: 2 }, null] as unknown as HistoryEntry[]
  const h = recordDay(corrupt, '2026-09-07', 5, 1)
  assert.deepEqual(h, [{ day: '2026-09-07', first: 5, last: 5, at: 1 }])

  let big: HistoryEntry[] = []
  for (let i = 0; i < HISTORY_MAX_DAYS + 10; i++) {
    big = recordDay(big, `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, i, i)
  }
  assert.equal(big.length, HISTORY_MAX_DAYS)
})

test('earnedToday is last − first, or null when the day is absent', () => {
  const h = recordDay(recordDay([], '2026-09-07', 100, 1), '2026-09-07', 145, 2)
  assert.equal(earnedToday(h, '2026-09-07'), 45)
  assert.equal(earnedToday(h, '2026-09-08'), null)
})

test('trendPerDay is the positive slope across snapshots, else null', () => {
  const h: HistoryEntry[] = [
    { day: '2026-09-05', first: 100, last: 130, at: 1 },
    { day: '2026-09-06', first: 130, last: 160, at: 2 },
    { day: '2026-09-07', first: 160, last: 190, at: 3 },
  ]
  // (190 − 100) / 2 intervals = 45
  assert.equal(trendPerDay(h, 7), 45)
  assert.equal(trendPerDay(h.slice(0, 1), 7), null) // < 2 snapshots
  const down: HistoryEntry[] = [
    { day: '2026-09-06', first: 200, last: 200, at: 1 },
    { day: '2026-09-07', first: 200, last: 100, at: 2 },
  ]
  assert.equal(trendPerDay(down, 7), null) // negative slope
})

test('goalDaysRemaining rounds up, 0 when there, null when the rate can’t answer', () => {
  assert.equal(goalDaysRemaining(100, 100, 10), 0)
  assert.equal(goalDaysRemaining(150, 100, 10), 0)
  assert.equal(goalDaysRemaining(100, 250, 50), 3)
  assert.equal(goalDaysRemaining(100, 251, 50), 4) // ceil(151/50)
  assert.equal(goalDaysRemaining(100, 250, null), null)
  assert.equal(goalDaysRemaining(100, 250, 0), null)
})
