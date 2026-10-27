import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts'
import { STEP_DONE_CHECKS, statsAreCurrent, stepSkipReason } from '../src/background/pure/verdicts.ts'
import { planRoutineRecovery } from '../src/background/pure/routine-recovery.ts'
import { slotMissingDefaults } from '../src/background/pure/orders.ts'

function makeStats(search = '57/60', image = '0/1') {
  return { at: Date.now(), searchPoints: search, readyToClaim: '0', activities: { visualSearch: image, dailySet: '3/3' } }
}

function harness(options: { enabled?: string[]; readings?: ReturnType<typeof makeStats>[]; stopDuringRead?: boolean; readFails?: boolean; deferConfirm?: boolean } = {}) {
  let stored: any = {
    v: 1, stopEpoch: 0, activity: null, batch: null, rightSizeRun: null,
    captures: { capturing: [], opened: {} },
    routine: {
      startDay: '2026-10-27', pendingSteps: [], pendingTabs: [40], skipped: [],
      enabledSteps: options.enabled || ['search', 'imageSearch'], ownerUntilAt: Date.now() + 180_000,
    },
  }
  let stats = { ...makeStats(), at: Date.now() - 60_000 }
  let reads = 0
  let images = 0
  let sweeps = 0
  const searches: any[] = []
  const created: any[] = []
  const removed: number[] = []
  const windows: any[] = []
  const removedWindows: number[] = []
  const timers: Array<() => void> = []
  let completeConfirm: (() => void) | undefined
  const notes: string[] = []
  const data: Record<string, unknown> = {}
  const alarms = new Set<string>()
  const context = createContext({
    console, structuredClone, Date, URLSearchParams,
    KEYS: { runState: 'runState', lastStats: 'lastStats', lastRoutineDay: 'lastRoutineDay' },
    chrome: {
      storage: { local: {
        get: async () => ({ runState: structuredClone(stored) }),
        set: async (value: any) => { stored = structuredClone(value.runState) },
      } },
      alarms: {
        create: async (name: string) => { alarms.add(name) },
        clear: async (name: string) => alarms.delete(name),
      },
      tabs: {
        create: async (value: any) => { created.push(value); return { id: 80 } },
        remove: async (id: number) => { removed.push(id) },
      },
      windows: {
        create: async (value: any) => {
          windows.push(value)
          if (options.deferConfirm) await new Promise<void>(resolve => { completeConfirm = resolve })
          return { id: 90 }
        },
        remove: async (id: number) => { removedWindows.push(id) },
      },
      runtime: { getURL: (p: string) => `chrome-extension://fixture/${p}` },
    },
    localDayKey: () => '2026-10-27',
    getSettings: async () => ({ ...DEFAULT_SETTINGS, tabCloseDelaySec: 0 }),
    holdKeepAlive() {}, releaseKeepAlive() {}, sleep: async () => {},
    closeTabs: async () => { sweeps++; return 1 },
    closeOtherDashboardTabs: async () => {}, closeBingRewardsTabs: async () => 0,
    setLastTabAction: async (note: string) => { notes.push(note) },
    setLastRewards: async () => {}, reportImageSearch: async () => {},
    setLocal: async (key: string, value: unknown) => { data[key] = value },
    getLocal: async (key: string) => key === 'lastStats' ? stats : data[key],
    slotMissingDefaults, STEP_DONE_CHECKS, statsAreCurrent, stepSkipReason, planRoutineRecovery,
    refreshStats: async () => {
      if (options.readFails) return
      const next = options.readings?.[reads] || options.readings?.at(-1) || makeStats()
      stats = { ...next, at: Date.now() }; reads++
      if (options.stopDuringRead) { stored.stopEpoch++; stored.routine = null }
    },
    checkRedeemAvailability: async () => {}, runStartupClaim: async () => {},
    openDailySetOnRewardsDashboard: async () => {}, openKeepEarningActivities: async () => {},
    runRandomImageSearch: async () => { images++ },
    startSearchBatch: async (value: any) => {
      searches.push(value); stored.batch = { runId: 1, remaining: value.count, tabId: 7, nextRunAt: 0 }
    },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length },
  })
  for (const file of ['core/run-state.ts', 'routine/routine.ts']) {
    const source = readFileSync(new URL(`../src/background/${file}`, import.meta.url), 'utf8')
    const script = stripTypeScriptTypes(source)
      .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
      .replace(/^export /gm, '')
    runInContext(script, context, { filename: file })
  }
  return {
    searches, created, removed, data, notes, alarms, windows, removedWindows,
    timeout: () => timers[0](),
    completeConfirm: () => completeConfirm?.(),
    stored: () => stored,
    images: () => images,
    sweeps: () => sweeps,
    async finish() { await runInContext('endRoutine()', context) },
    async tail() { await runInContext('runPendingStartupSteps()', context) },
    async resume() { await runInContext('resumeRoutineRecovery()', context) },
    endSearch() { stored.batch = null },
    call: (code: string) => runInContext(code, context),
  }
}

test('final retry retains routine and queue until credited searches and image task verify complete', async () => {
  const h = harness({ readings: [makeStats(), makeStats('60/60', '1/1')] })
  await h.finish()
  assert.equal(h.searches.length, 1)
  assert.equal(h.searches[0].count, 1)
  assert.deepEqual(Array.from(h.stored().routine.pendingSteps), ['imageSearch'])
  assert.equal(h.stored().routine.recoveryRound, 1)
  assert.equal(h.data.lastRoutineDay, undefined)
  assert.equal(h.alarms.has('routineRecovery'), true)
  h.endSearch()
  await h.tail()
  assert.equal(h.images(), 1)
  assert.equal(h.stored().routine, null)
  assert.equal(h.data.lastRoutineDay, '2026-10-27')
  assert.equal(h.created.length, 1)
  assert.equal(h.sweeps(), 1)
  assert.equal(h.alarms.has('routineRecovery'), false)
})

test('no credited progress ends recovery after one final retry and reports the remaining streak', async () => {
  const h = harness({ enabled: ['imageSearch'], readings: [makeStats(), makeStats()] })
  await h.finish()
  assert.equal(h.images(), 1)
  assert.equal(h.stored().routine, null)
  assert.equal(h.notes.some(note => note.includes('no-progress')), true)
  assert.match(h.created[0].url, /visualSearch/)
})

test('Stop during the final read prevents recovery, completion marker and tab cleanup', async () => {
  const h = harness({ stopDuringRead: true })
  await h.finish()
  assert.equal(h.searches.length, 0)
  assert.equal(h.images(), 0)
  assert.equal(h.data.lastRoutineDay, undefined)
  assert.equal(h.created.length, 0)
  assert.equal(h.sweeps(), 0)
})

test('concurrent finalization calls reserve only one recovery round', async () => {
  const h = harness()
  await Promise.all([h.finish(), h.finish()])
  assert.equal(h.searches.length, 1)
  assert.equal(h.stored().routine.recoveryRound, 1)
})

test('worker wake resumes only an explicitly persisted final-recovery queue', async () => {
  const h = harness({ enabled: ['imageSearch'], readings: [makeStats('60/60', '1/1')] })
  h.stored().routine.recovering = true
  h.stored().routine.recoveryRound = 1
  h.stored().routine.recoveryProgress = { imageSearch: 0 }
  h.stored().routine.pendingSteps = ['imageSearch']
  await h.resume()
  assert.equal(h.images(), 1)
  assert.equal(h.stored().routine, null)
})

test('confirmation alone uses a popup window and closing that window cancels', async () => {
  const h = harness()
  const result = h.call('confirmRoutineStart()')
  await Promise.resolve()
  assert.equal(h.created.length, 0)
  assert.equal(h.windows.length, 1)
  assert.equal(h.windows[0].type, 'popup')
  assert.equal(h.windows[0].width, 510)
  assert.equal(h.windows[0].height, 350)
  h.call('routineConfirmWindowRemoved(80)') // unrelated window cannot cancel
  assert.deepEqual(h.removedWindows, [])
  h.call('routineConfirmWindowRemoved(90)')
  assert.equal(await result, false)
  assert.deepEqual(h.removedWindows, [90])
  assert.deepEqual(h.removed, [])
})

test('accepting the confirmation closes only its popup window', async () => {
  const h = harness()
  const result = h.call('confirmRoutineStart()')
  await Promise.resolve()
  h.call('answerRoutineConfirm(true)')
  assert.equal(await result, true)
  assert.deepEqual(h.removedWindows, [90])
  assert.deepEqual(h.removed, [])
})

test('confirmation timeout proceeds and closes a popup that finishes opening late', async () => {
  const h = harness({ deferConfirm: true })
  const result = h.call('confirmRoutineStart()')
  h.timeout()
  assert.equal(await result, true)
  h.completeConfirm()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.removedWindows, [90])
  assert.deepEqual(h.removed, [])
})

test('an unreadable final check finishes with unverified labels rather than claiming completion', async () => {
  const h = harness({ readFails: true })
  await h.finish()
  assert.equal(h.searches.length, 0)
  assert.equal(h.images(), 0)
  assert.match(h.created[0].url, /bingSearch%3Anot\+verified/)
  assert.match(h.created[0].url, /visualSearch%3Anot\+verified/)
})

test('an active routine cannot be cleared by a duplicate manual start', async () => {
  const h = harness()
  assert.equal(await h.call('runStartupSequence({manual:true})'), 'cancelled')
  assert.equal(h.stored().routine.startDay, '2026-10-27')
  assert.deepEqual(Array.from(h.stored().routine.enabledSteps), ['search', 'imageSearch'])
})

test('incomplete search credit stays in the finish summary even if the streak reports done', async () => {
  const h = harness({ enabled: ['search'] })
  await h.finish()
  h.endSearch()
  await h.tail()
  assert.match(h.created[0].url, /bingSearch%3A57%2F60/)
})

test('a new worker recovers an expired original image step by verifying stats, without replaying the original queue', async () => {
  const h = harness({ enabled: ['imageSearch'], readings: [makeStats('60/60'), makeStats('60/60', '1/1')] })
  h.stored().routine.ownerUntilAt = Date.now() - 1
  h.stored().routine.pendingSteps = ['stats', 'dailySet', 'imageSearch']
  h.stored().activity = { label: 'Image search' }
  await h.resume()
  assert.equal(h.images(), 1)
  assert.equal(h.searches.length, 0)
  assert.equal(h.stored().routine, null)
  assert.equal(h.stored().activity, null)
  assert.equal(h.data.lastRoutineDay, '2026-10-27')
})

test('a worker wake waits for an unexpired original-step lease and never duplicates live work', async () => {
  const h = harness()
  await h.resume()
  assert.equal(h.searches.length, 0)
  assert.equal(h.images(), 0)
  assert.equal(h.stored().routine.recovering, undefined)
  assert.equal(h.data.lastRoutineDay, undefined)
})

test('a manual start can recover an expired original routine instead of remaining blocked forever', async () => {
  const h = harness({ enabled: ['imageSearch'], readings: [makeStats('60/60', '1/1')] })
  h.stored().routine.ownerUntilAt = Date.now() - 1
  assert.equal(await h.call('runStartupSequence({manual:true})'), 'cancelled')
  assert.equal(h.stored().routine, null)
  assert.equal(h.data.lastRoutineDay, '2026-10-27')
  assert.equal(h.images(), 0)
})

test('Stop during interrupted-original recovery leaves the day unmarked and never runs replacement steps', async () => {
  const h = harness({ stopDuringRead: true })
  h.stored().routine.ownerUntilAt = Date.now() - 1
  await h.resume()
  assert.equal(h.stored().routine, null)
  assert.equal(h.searches.length, 0)
  assert.equal(h.images(), 0)
  assert.equal(h.data.lastRoutineDay, undefined)
  assert.equal(h.created.length, 0)
})
