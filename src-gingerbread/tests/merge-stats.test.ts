import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStats } from '../src/background/pure/merge-stats.ts'

test('the Earn read wins for the four activity streaks', () => {
  const dashboard = { activities: { dailySet: '1/1', bingSearch: '1/1' } }
  const earn = { activities: { dailySet: 'Day 4 of 7 · 1/1', bingApp: '0/1' } }
  const merged = mergeStats(dashboard, earn)
  // Earn's richer value wins where it answered…
  assert.equal(merged.activities.dailySet, 'Day 4 of 7 · 1/1')
  assert.equal(merged.activities.bingApp, '0/1')
  // …and the dashboard tile remains the fallback where Earn was silent.
  assert.equal(merged.activities.bingSearch, '1/1')
  assert.equal(merged.activities.visualSearch, null)
})

test('the stamp bonus prefers the star count over the older points read', () => {
  assert.equal(mergeStats({ stampBonus: '1,000 pts' }, { stampBonus: '11/12' }).stampBonus, '11/12')
  // even when the star count is on the dashboard side
  assert.equal(mergeStats({ stampBonus: '11/12' }, { stampBonus: '1,000 pts' }).stampBonus, '11/12')
  // no star count anywhere → first non-null wins
  assert.equal(mergeStats({ stampBonus: '1,000 pts' }, {}).stampBonus, '1,000 pts')
})

test('a page miss never erases the other page’s find', () => {
  const merged = mergeStats(
    { availablePoints: '5,113', readyToClaim: null },
    { readyToClaim: '30', searchPoints: '40/60' },
  )
  assert.equal(merged.availablePoints, '5,113')
  assert.equal(merged.readyToClaim, '30')
  assert.equal(merged.searchPoints, '40/60')
})

test('mergeStats tolerates null/undefined inputs', () => {
  const merged = mergeStats(null, undefined)
  assert.equal(merged.availablePoints, null)
  assert.deepEqual(merged.activities, {
    bingSearch: null,
    dailySet: null,
    bingApp: null,
    visualSearch: null,
  })
})

test('the keep-earning counts come from the Earn read, with the dashboard as fallback', () => {
  // Earn's counts win (that is where the section lives)…
  assert.deepEqual(
    mergeStats({ keepEarning: { open: 2, total: 5 } }, { keepEarning: { open: 0, total: 3 } }).keepEarning,
    { open: 0, total: 3 },
  )
  // …and answer when only the dashboard found the section
  assert.deepEqual(mergeStats({ keepEarning: { open: 1, total: 2 } }, {}).keepEarning, {
    open: 1,
    total: 2,
  })
  // a miss on either side never erases the other's
  assert.deepEqual(mergeStats({}, { keepEarning: { open: 0, total: 6 } }).keepEarning, {
    open: 0,
    total: 6,
  })
  // unread everywhere → null, which is "unknown", never a verdict
  assert.equal(mergeStats({}, {}).keepEarning, null)
})
