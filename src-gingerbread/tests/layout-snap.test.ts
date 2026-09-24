// The pure step snapping (6.8.0 rewrite): a free (w, h) proposal lands on
// one of the tile's DESIGNED pairs — chosen together, by pixel distance.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapToStep, stepIndexOf } from '../src/pages/dashboard/layout/snap.ts'

const STEPS = [
  { w: 2, h: 1 },
  { w: 4, h: 3 },
  { w: 6, h: 4 },
]

test('an exact designed step snaps to itself', () => {
  assert.deepEqual(snapToStep(STEPS, 4, 3), { w: 4, h: 3 })
  assert.deepEqual(snapToStep(STEPS, 2, 1), { w: 2, h: 1 })
})

test('a near miss snaps to the nearest designed pair', () => {
  // One column off the middle step.
  assert.deepEqual(snapToStep(STEPS, 3, 3), { w: 4, h: 3 })
  // One row above the smallest step.
  assert.deepEqual(snapToStep(STEPS, 2, 2), { w: 2, h: 1 })
})

test('distance is in pixels, not grid units', () => {
  // (5, 2): 1 column from (4,3) and (6,4)... compute it —
  // to (4,3): dx=112, dy=-160 → 12544+25600 = 38144
  // to (6,4): dx=-112, dy=-320 → 12544+102400 = 114944
  // to (2,1): dx=336, dy=160 → 112896+25600 = 138496
  assert.deepEqual(snapToStep(STEPS, 5, 2), { w: 4, h: 3 })
  // The same gap measured in grid units would be a tie (1 unit from (4,3)
  // in w AND 1 unit in h); the px scale breaks it toward the row, which is
  // what the cursor feels.
})

test('out-of-range sizes still land on a designed step', () => {
  assert.deepEqual(snapToStep(STEPS, 0, 0), { w: 2, h: 1 })
  assert.deepEqual(snapToStep(STEPS, 99, 99), { w: 6, h: 4 })
})

test('a tie keeps the earlier (smaller) step', () => {
  const steps = [
    { w: 2, h: 2 },
    { w: 4, h: 2 },
  ]
  // (3, 2) is equidistant in px between the two.
  assert.deepEqual(snapToStep(steps, 3, 2), { w: 2, h: 2 })
})

test('an empty step list passes the size through', () => {
  assert.deepEqual(snapToStep([], 5, 5), { w: 5, h: 5 })
})

test('the col scale changes which step wins', () => {
  // (3, 1) at the default colPx=112: to (2,1) → 112²=12544; to (4,3) →
  // 112²+2·160² = 63344 → snaps small. With WIDE columns (400px), the
  // width pull dominates differently:
  const steps = [
    { w: 2, h: 1 },
    { w: 4, h: 3 },
  ]
  assert.deepEqual(snapToStep(steps, 3, 1, 112, 160), { w: 2, h: 1 })
  assert.deepEqual(snapToStep(steps, 3, 1, 400, 160), { w: 2, h: 1 })
  // But (3, 3) — a full row above the small step — flips with the scale:
  // colPx=112: to (2,1) → 12544+102400=114944; to (4,3) → 12544 → middle.
  assert.deepEqual(snapToStep(steps, 3, 3, 112, 160), { w: 4, h: 3 })
})

test('stepIndexOf finds exact pairs and rejects the rest', () => {
  assert.equal(stepIndexOf(STEPS, 4, 3), 1)
  assert.equal(stepIndexOf(STEPS, 2, 1), 0)
  assert.equal(stepIndexOf(STEPS, 4, 4), -1)
  assert.equal(stepIndexOf(STEPS, 3, 3), -1)
})
