import test from 'node:test'
import assert from 'node:assert/strict'
import { tickShouldRun, TICK_STALL_CEILING_MS } from '../src/background/pure/tick-guard.ts'

// The search loop's re-entrancy guard (the fix for "sometimes the search stuck
// at half the searches"): a bare boolean would wedge forever if a tick's await
// never settled, so the guard lets a beat take over once the in-flight tick has
// stalled past the ceiling.

test('a beat runs when no tick is in flight', () => {
  assert.equal(tickShouldRun(0, 1_000_000), true)
})

test('a beat is skipped while a fresh tick is still in flight', () => {
  const startedAt = 1_000_000
  assert.equal(tickShouldRun(startedAt, startedAt + 5_000), false)
  assert.equal(tickShouldRun(startedAt, startedAt + TICK_STALL_CEILING_MS - 1), false)
})

test('a beat takes over once the in-flight tick has stalled past the ceiling', () => {
  const startedAt = 1_000_000
  assert.equal(tickShouldRun(startedAt, startedAt + TICK_STALL_CEILING_MS), true)
  assert.equal(tickShouldRun(startedAt, startedAt + TICK_STALL_CEILING_MS + 60_000), true)
})

test('the ceiling sits above any legitimate tick (~1 minute worst case)', () => {
  // 20s tab wait + ~24s all-sources query timeout + ~15s typing < ceiling.
  assert.ok(TICK_STALL_CEILING_MS > 60_000, 'ceiling must clear the worst honest tick')
})
