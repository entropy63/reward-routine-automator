import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enabledRoutinePlan, routinePlan } from '../src/background/pure/plan.ts'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'
import type { Stats } from '../src/shared/storage.ts'

const order = ['stats', 'claim', 'dailySet', 'keepEarning', 'search', 'imageSearch']

function statsAt(day: Date, over: Partial<Stats> = {}): Stats {
  return {
    at: day.getTime(),
    availablePoints: null,
    readyToClaim: null,
    dailyStreak: null,
    stampBonus: null,
    searchPoints: null,
    activities: { bingSearch: null, dailySet: null, bingApp: null, visualSearch: null },
    ...over,
  }
}

test('routinePlan marks done steps as skipped with the verdict wording', () => {
  const now = new Date('2026-09-07T10:00:00')
  const stats = statsAt(now, {
    searchPoints: '60/60',
    readyToClaim: '0',
    activities: { bingSearch: null, dailySet: '3/3', bingApp: null, visualSearch: '1/1' },
  })
  const plan = routinePlan(stats, order, now)
  const byId = Object.fromEntries(plan.map((p) => [p.id, p]))
  assert.equal(byId.search.willRun, false)
  assert.match(byId.search.reason!, /already/)
  assert.equal(byId.claim.willRun, false)
  assert.equal(byId.dailySet.willRun, false)
  assert.equal(byId.imageSearch.willRun, false)
  // no done-check → always runs
  assert.equal(byId.stats.willRun, true)
})

test('routinePlan skips keep earning only when the read says every tile is spent', () => {
  const now = new Date('2026-09-07T10:00:00')
  const spent = routinePlan(statsAt(now, { keepEarning: { open: 0, total: 5 } }), order, now)
  const byId = Object.fromEntries(spent.map((p) => [p.id, p]))
  assert.equal(byId.keepEarning.willRun, false)
  assert.match(byId.keepEarning.reason!, /all 5 activities done/)
  // open tiles → runs; unread → runs (an unknown is never a skip)
  const open = routinePlan(statsAt(now, { keepEarning: { open: 2, total: 5 } }), order, now)
  assert.equal(Object.fromEntries(open.map((p) => [p.id, p])).keepEarning.willRun, true)
  const unread = routinePlan(statsAt(now), order, now)
  assert.equal(Object.fromEntries(unread.map((p) => [p.id, p])).keepEarning.willRun, true)
})

test('routinePlan runs everything on a stale or missing read', () => {
  const now = new Date('2026-09-07T10:00:00')
  const yesterday = new Date('2026-09-06T10:00:00')
  const stale = statsAt(yesterday, { searchPoints: '60/60', readyToClaim: '0' })
  assert.ok(routinePlan(stale, order, now).every((p) => p.willRun))
  assert.ok(routinePlan(null, order, now).every((p) => p.willRun))
})

test('routinePlan preserves the given order and tolerates junk', () => {
  const now = new Date('2026-09-07T10:00:00')
  assert.deepEqual(
    routinePlan(null, ['search', 'claim'], now).map((p) => p.id),
    ['search', 'claim'],
  )
  assert.deepEqual(routinePlan(null, [] as string[], now), [])
})

test('enabledRoutinePlan keeps only the enabled steps, in the saved order', () => {
  const now = new Date('2026-09-07T10:00:00')
  const allOn = {
    ...DEFAULT_SETTINGS,
    statsStartupEnabled: true,
    claimStartupEnabled: true,
    dailySetStartupEnabled: true,
    keepEarningStartupEnabled: true,
    searchStartupEnabled: true,
    imageSearchStartupEnabled: true,
  }
  // A null read runs everything; every enabled step appears, in the saved order.
  assert.deepEqual(
    enabledRoutinePlan(allOn, null, now).map((p) => p.id),
    DEFAULT_SETTINGS.startupOrder,
  )
  // Turning a step off drops exactly that step; the rest keep their order.
  const noSearch = enabledRoutinePlan({ ...allOn, searchStartupEnabled: false }, null, now)
  assert.ok(!noSearch.some((p) => p.id === 'search'))
  assert.equal(noSearch.length, DEFAULT_SETTINGS.startupOrder.length - 1)
})
