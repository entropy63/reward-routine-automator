import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  progressPair,
  streakDone,
  statsAreCurrent,
  rightSizedCount,
  judgeSettlement,
  stepSkipReason,
  POINTS_PER_SEARCH,
} from '../src/background/pure/verdicts.ts'
import type { Stats } from '../src/shared/storage.ts'

const emptyActivities = { bingSearch: null, dailySet: null, bingApp: null, visualSearch: null }
function statsAt(day: Date, over: Partial<Stats> = {}): Stats {
  return {
    at: day.getTime(),
    availablePoints: null,
    readyToClaim: null,
    dailyStreak: null,
    stampBonus: null,
    searchPoints: null,
    activities: { ...emptyActivities },
    ...over,
  }
}

test('progressPair reads the trailing X/Y of both stored shapes', () => {
  assert.deepEqual(progressPair('3/3'), [3, 3])
  assert.deepEqual(progressPair('Day 4 of 7 · 1/1'), [1, 1])
  assert.deepEqual(progressPair('40 / 60'), [40, 60])
  assert.equal(progressPair('no pair here'), null)
  assert.equal(progressPair(null), null)
  assert.equal(progressPair(42), null)
})

test('streakDone returns the value only when complete', () => {
  assert.equal(streakDone('3/3'), '3/3')
  assert.equal(streakDone('Day 4 of 7 · 1/1'), 'Day 4 of 7 · 1/1')
  assert.equal(streakDone('1/2'), null)
  assert.equal(streakDone('nope'), null)
})

test('statsAreCurrent gates on today', () => {
  const now = new Date('2026-09-07T10:00:00')
  assert.equal(statsAreCurrent(statsAt(now), now), true)
  const yesterday = new Date('2026-09-06T23:59:00')
  assert.equal(statsAreCurrent(statsAt(yesterday), now), false)
  assert.equal(statsAreCurrent(null, now), false)
  assert.equal(statsAreCurrent({ ...statsAt(now), at: undefined }, now), false)
})

test('rightSizedCount trims to the remaining points, else runs the full batch', () => {
  const now = new Date('2026-09-07T10:00:00')
  // 40/60 → 20 remaining → ceil(20/3) = 7
  assert.deepEqual(rightSizedCount(statsAt(now, { searchPoints: '40/60' }), 30, now), {
    count: 7,
    pair: [40, 60],
    trimmed: true,
  })
  // cap met → fallback, not trimmed
  assert.deepEqual(rightSizedCount(statsAt(now, { searchPoints: '60/60' }), 30, now), {
    count: 30,
    pair: null,
    trimmed: false,
  })
  // needed >= perBatch → full, untrimmed, pair kept
  assert.deepEqual(rightSizedCount(statsAt(now, { searchPoints: '0/60' }), 5, now), {
    count: 5,
    pair: [0, 60],
    trimmed: false,
  })
  // stale read → full batch, no pair
  const yesterday = new Date('2026-09-06T10:00:00')
  assert.deepEqual(rightSizedCount(statsAt(yesterday, { searchPoints: '0/60' }), 30, now), {
    count: 30,
    pair: null,
    trimmed: false,
  })
  // no pair in value → full batch
  assert.deepEqual(rightSizedCount(statsAt(now, { searchPoints: 'unknown' }), 30, now), {
    count: 30,
    pair: null,
    trimmed: false,
  })
})

test('judgeSettlement covers cap, maxRounds, notCounting, and continue', () => {
  assert.equal(judgeSettlement({ round: 1, pair: [40, 60] }, [60, 60]).reason, 'cap')
  assert.equal(judgeSettlement({ round: 1, pair: [40, 60] }, [60, 60]).verdict, 'done')
  assert.equal(judgeSettlement({ round: 3, pair: [40, 60] }, [50, 60], 3).reason, 'maxRounds')
  assert.equal(judgeSettlement({ round: 1, pair: [40, 60] }, [40, 60]).reason, 'notCounting')
  const cont = judgeSettlement({ round: 1, pair: [40, 60] }, [51, 60], 3, POINTS_PER_SEARCH)
  assert.equal(cont.verdict, 'continue')
  assert.equal(cont.more, 3) // ceil((60-51)/3)
  assert.equal(judgeSettlement({ round: 1, pair: [40, 60] }, null).verdict, 'done')
})

test('stepSkipReason skips done steps, runs the rest', () => {
  const now = new Date('2026-09-07T10:00:00')
  const s = statsAt(now, {
    searchPoints: '60/60',
    readyToClaim: '0',
    activities: { ...emptyActivities, dailySet: '3/3', visualSearch: '0/1' },
  })
  assert.match(stepSkipReason('search', s)!, /already/)
  assert.match(stepSkipReason('claim', s)!, /nothing to claim/)
  assert.match(stepSkipReason('dailySet', s)!, /already/)
  assert.equal(stepSkipReason('imageSearch', s), null) // 0/1 not done
  // no keep-earning answer in this read → unknown, never a skip
  assert.equal(stepSkipReason('keepEarning', s), null)
})

test('the keep-earning verdict skips only a fully spent, answered section', () => {
  const now = new Date('2026-09-07T10:00:00')
  // all spent → skip, with the count in the reason
  const allDone = statsAt(now, { keepEarning: { open: 0, total: 4 } })
  assert.equal(stepSkipReason('keepEarning', allDone), 'all 4 activities done')
  // still-open tiles → run
  const partly = statsAt(now, { keepEarning: { open: 1, total: 4 } })
  assert.equal(stepSkipReason('keepEarning', partly), null)
  // unread section → unknown, never a skip
  assert.equal(stepSkipReason('keepEarning', statsAt(now)), null)
  assert.equal(stepSkipReason('keepEarning', statsAt(now, { keepEarning: null })), null)
  // a section that answered with nothing usable is not "done" either
  assert.equal(stepSkipReason('keepEarning', statsAt(now, { keepEarning: { open: 0, total: 0 } })), null)
})
