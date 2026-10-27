import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import { tickShouldRun } from '../src/background/pure/tick-guard.ts'

// Execute the real driver and storage boundary together, with only browser,
// network and scheduling effects replaced. This catches flags that are written
// by the driver but silently discarded when readRunState normalizes storage.
function harness(batchExtras = {}, stopAtLoad = false) {
  let stored: any = {
    v: 1, stopEpoch: 0, activity: null, routine: null, rightSizeRun: null,
    captures: { capturing: [], opened: {} },
    batch: { runId: 1, remaining: 4, tabId: 7, nextRunAt: 0, ...batchExtras },
  }
  const injections: any[] = []
  const navigations: any[] = []
  const delays: number[] = []
  const typedSearch = () => {}
  const context = createContext({
    console, structuredClone, Date, tickShouldRun,
    KEYS: { runState: 'runState', lastQuery: 'lastQuery' },
    chrome: {
      storage: { local: {
        get: async () => ({ runState: structuredClone(stored) }),
        set: async (value: any) => { stored = structuredClone(value.runState) },
      } },
      tabs: {
        get: async () => ({ id: 7, status: 'complete' }),
        update: async (...args: any[]) => { navigations.push(args) },
      },
      scripting: { executeScript: async (options: any) => {
        injections.push(options)
        return [{ result: 650 }]
      } },
    },
    performHumanTypedSearchOnBing: typedSearch,
    waitForTabComplete: async () => {
      if (stopAtLoad) { stored.stopEpoch++; stored.batch = null }
      return true
    },
    awaitedQuery: async () => ({ query: 'a meaningful query', api: 'fixture' }),
    setLocal: async () => {}, startKeepAlive: () => {}, startQueryPrefetch: () => {},
    getSettings: async () => ({ minDelaySec: 5, maxDelaySec: 15 }),
    randomDelayMillis: () => 5000,
    scheduleBeat: (delay: number) => { delays.push(delay) },
    cancelBeats: () => {},
  })
  for (const file of ['core/run-state.ts', 'routine/search.ts']) {
    const source = readFileSync(new URL(`../src/background/${file}`, import.meta.url), 'utf8')
    const script = stripTypeScriptTypes(source)
      .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
      .replace(/^export /gm, '')
    runInContext(script, context, { filename: file })
  }
  return {
    injections, navigations, delays, typedSearch,
    state: () => stored,
    async tick() { await runInContext('tick()', context) },
    due() { stored.batch.nextRunAt = 0 },
  }
}

test('regular batches type the first and subsequent searches across storage reads', async () => {
  const h = harness()
  await h.tick()
  h.due()
  await h.tick()
  assert.equal(h.injections.length, 2)
  for (const injection of h.injections) {
    assert.equal(injection.target.tabId, 7)
    assert.equal(injection.func, h.typedSearch)
    assert.deepEqual(Array.from(injection.args), ['a meaningful query'])
  }
  assert.equal(h.navigations.length, 0)
  assert.equal(h.state().batch.remaining, 2)
  assert.deepEqual(h.delays, [5650, 5650])
})

test('a batch left by the newer version still uses typing', async () => {
  const h = harness({ firstSearchDone: true })
  await h.tick()
  assert.equal(h.injections.length, 1)
  assert.equal(h.navigations.length, 0)
})

test('prowl batches retain typed searches', async () => {
  const h = harness({ prowl: true })
  await h.tick()
  assert.equal(h.injections.length, 1)
  assert.equal(h.navigations.length, 0)
  assert.equal(h.state().batch.prowl, true)
})

test('stopping while the page loads prevents typing and rescheduling', async () => {
  const h = harness({}, true)
  await h.tick()
  assert.equal(h.injections.length, 0)
  assert.equal(h.navigations.length, 0)
  assert.equal(h.delays.length, 0)
  assert.equal(h.state().batch, null)
})
