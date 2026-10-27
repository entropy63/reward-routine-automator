import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, runInContext } from 'node:vm'

function harness() {
  let pending: string | null = null
  let disk = '6.9.8'
  let fail = false
  let cleanup: () => void = () => {}
  let focus: (() => Promise<void>) | null = null
  let poll: (() => Promise<void>) | null = null
  const context = createContext({
    useState: () => [null, (value: string | null) => { pending = value }],
    useEffect: (effect: () => () => void) => { cleanup = effect() },
    chrome: { runtime: {
      getManifest: () => ({ version: '6.9.8' }),
      getURL: (file: string) => `chrome-extension://fixture/${file}`,
    } },
    fetch: async (_url: string, options: RequestInit) => {
      assert.equal(options.cache, 'no-store')
      if (fail) throw new Error('replacement in progress')
      return { ok: true, json: async () => ({ version: disk }) }
    },
    window: {
      setInterval: (fn: () => Promise<void>, ms: number) => {
        assert.equal(ms, 30_000); poll = fn; return 1
      },
      clearInterval: () => { poll = null },
      addEventListener: (_event: string, fn: () => Promise<void>) => { focus = fn },
      removeEventListener: () => { focus = null },
    },
  })
  const source = readFileSync(new URL('../src/popup/hooks/usePendingUpdate.ts', import.meta.url), 'utf8')
  runInContext(stripTypeScriptTypes(source).replace(/^import .*$/gm, '').replace(/^export /gm, ''), context)
  runInContext('usePendingUpdate()', context)
  return {
    flush: async () => { await new Promise(resolve => setImmediate(resolve)) },
    pending: () => pending,
    disk: (version: string) => { disk = version },
    fail: (value: boolean) => { fail = value },
    focus: async () => { await focus?.() },
    poll: async () => { await poll?.() },
    cleanup: () => cleanup(),
    watching: () => !!focus || !!poll,
  }
}

test('an already-open dashboard discovers an update on focus and clears a matching version', async () => {
  const h = harness()
  await h.flush()
  assert.equal(h.pending(), null)
  h.disk('6.9.9')
  await h.focus()
  assert.equal(h.pending(), '6.9.9')
  h.disk('6.9.8')
  await h.poll()
  assert.equal(h.pending(), null)
  h.cleanup()
})

test('periodic checks recover from temporary read errors and stop on unmount', async () => {
  const h = harness()
  await h.flush()
  h.fail(true)
  await h.poll()
  assert.equal(h.pending(), null)
  h.fail(false)
  h.disk('6.9.9')
  await h.poll()
  assert.equal(h.pending(), '6.9.9')
  h.fail(true)
  await h.focus()
  assert.equal(h.pending(), '6.9.9')
  h.cleanup()
  assert.equal(h.watching(), false)
})
