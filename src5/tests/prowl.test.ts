import test from 'node:test'
import assert from 'node:assert/strict'
import {
  prowlDelayMs,
  prowlSearchCount,
  prowlWindowMs,
  PROWL_MIN_MS,
  PROWL_MAX_MS,
  PROWL_MIN_SEARCHES,
  PROWL_MAX_SEARCHES,
  PROWL_WINDOW_FLOOR_MS,
  PROWL_WINDOW_CEIL_MS,
} from '../src/background/pure/prowl.ts'

// The prowl's bounds (user request, 2026-09-09): a random moment inside the
// time window, 2–5 searches per round. The window was hardcoded 15–45 min
// until 6.8.0 made it user-settable ("let the user choose the time range") —
// these tests pin the default window, arbitrary windows, and the sanitizer,
// all with deterministic rand injections — Math.random itself is never drawn.

test('default prowl delays land inside the 15–45 minute window', () => {
  for (const r of [0, 0.001, 0.25, 0.5, 0.75, 0.999999, 1]) {
    const ms = prowlDelayMs(() => r)
    assert.ok(ms >= PROWL_MIN_MS && ms <= PROWL_MAX_MS, `${ms}ms outside the window at rand ${r}`)
  }
  assert.equal(prowlDelayMs(() => 0), PROWL_MIN_MS)
  assert.equal(prowlDelayMs(() => 1), PROWL_MAX_MS)
})

test('prowl delays are uniform draws, not just the endpoints', () => {
  // A middle draw must land proportionally inside the window.
  const ms = prowlDelayMs(() => 0.5)
  assert.equal(ms, (PROWL_MIN_MS + PROWL_MAX_MS) / 2)
})

test('a user-set window drives the delay', () => {
  // 5–10 minutes: every draw lands inside it, endpoints included.
  const window = [5 * 60_000, 10 * 60_000] as [number, number]
  for (const r of [0, 0.25, 0.5, 0.999999, 1]) {
    const ms = prowlDelayMs(() => r, window)
    assert.ok(ms >= window[0] && ms <= window[1], `${ms}ms outside the user window at rand ${r}`)
  }
  assert.equal(prowlDelayMs(() => 0.5, window), 7.5 * 60_000)
})

test('prowlWindowMs accepts a legal window as-is', () => {
  assert.deepEqual(prowlWindowMs(15, 45), [15 * 60_000, 45 * 60_000])
  assert.deepEqual(prowlWindowMs(5, 10), [5 * 60_000, 10 * 60_000])
})

test('prowlWindowMs falls back to the defaults on junk', () => {
  // NaN/undefined/strings are not numbers — the default window answers.
  assert.deepEqual(prowlWindowMs(NaN, NaN), [PROWL_MIN_MS, PROWL_MAX_MS])
  assert.deepEqual(prowlWindowMs(undefined, 45), [PROWL_MIN_MS, 45 * 60_000])
  assert.deepEqual(prowlWindowMs('15', '45'), [PROWL_MIN_MS, PROWL_MAX_MS])
})

test('prowlWindowMs clamps to the floor and the ceiling', () => {
  // Tighter than a minute → a minute; looser than 4 hours → 4 hours.
  assert.deepEqual(prowlWindowMs(0, 0.5), [PROWL_WINDOW_FLOOR_MS, PROWL_WINDOW_FLOOR_MS])
  assert.deepEqual(prowlWindowMs(1, 9999), [60_000, PROWL_WINDOW_CEIL_MS])
})

test('prowlWindowMs swaps an inverted pair instead of trusting it', () => {
  // 45/15 was stored upside down — the answer is still a legal ordered pair.
  assert.deepEqual(prowlWindowMs(45, 15), [15 * 60_000, 45 * 60_000])
})

test('prowl counts land in 2–5 and cover the whole range', () => {
  const seen = new Set<number>()
  for (let i = 0; i < 300; i++) {
    const n = prowlSearchCount()
    assert.ok(n >= PROWL_MIN_SEARCHES && n <= PROWL_MAX_SEARCHES, `${n} outside 2–5`)
    seen.add(n)
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [2, 3, 4, 5])
})

test('prowl count edges: the top draw clamps to 5, not 6', () => {
  assert.equal(prowlSearchCount(() => 0), 2)
  // rand() === 1 would floor past the span's top (2 + 4 = 6) without the clamp.
  assert.equal(prowlSearchCount(() => 1), 5)
  assert.equal(prowlSearchCount(() => 0.999), 5)
})
