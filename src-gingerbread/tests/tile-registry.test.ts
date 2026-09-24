// The tile registry's own contract (6.8.0 rewrite): every tile declares
// designed steps, the steps are sane, and the declared default board is
// packed and collision-free — so react-grid-layout's vertical compaction
// leaves the declared board exactly as written.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRID_COLS, PANEL_IDS, TILES, stepCeiling, stepFloor } from '../src/pages/dashboard/tiles/registry.ts'

test('every registry tile has at least one designed step', () => {
  for (const id of PANEL_IDS) {
    assert.ok(TILES[id].steps.length >= 1, `${id} has no steps`)
  }
})

test('steps are small → large, unique, and inside the board', () => {
  for (const id of PANEL_IDS) {
    const seen = new Set<string>()
    let prevKey = -1
    for (const s of TILES[id].steps) {
      assert.ok(s.w >= 1 && s.h >= 1, `${id} step ${s.w}x${s.h} has a zero/negative axis`)
      assert.ok(s.w <= GRID_COLS, `${id} step ${s.w}x${s.h} is wider than the board`)
      const key = `${s.w}x${s.h}`
      assert.ok(!seen.has(key), `${id} repeats step ${key}`)
      seen.add(key)
      // Small → large by AREA, then width (user, 2026-09-11: "I do not like
      // how I can't really resize them" — the steps are a LATTICE, so width
      // and height step independently; only the sort order is fixed, and it
      // must be deterministic so the snap's "nearest step" is stable).
      const order = s.w * s.h * 1000 + s.w * 10 + s.h
      assert.ok(order > prevKey, `${id} step ${key} is not area-sorted after the previous step`)
      prevKey = order
    }
  }
})

test('floor/ceiling match the step list', () => {
  for (const id of PANEL_IDS) {
    const meta = TILES[id]
    // The floor is the per-axis MINIMA (a lattice's smallest-area step need
    // not be the narrowest or the shortest — streaks' floor step is 4×1 but
    // its 3-wide quad is legal).
    assert.deepEqual(stepFloor(meta), {
      w: Math.min(...meta.steps.map((s) => s.w)),
      h: Math.min(...meta.steps.map((s) => s.h)),
    })
    const ceil = stepCeiling(meta)
    assert.equal(ceil.w, Math.max(...meta.steps.map((s) => s.w)))
    assert.equal(ceil.h, Math.max(...meta.steps.map((s) => s.h)))
    assert.ok(ceil.w <= GRID_COLS)
  }
})

test('defaultStep indexes into the steps and the seat is on the board', () => {
  for (const id of PANEL_IDS) {
    const meta = TILES[id]
    const step = meta.steps[meta.defaultStep]
    assert.ok(step, `${id} defaultStep ${meta.defaultStep} is out of range`)
    assert.ok(meta.seat.x >= 0 && meta.seat.x + step.w <= GRID_COLS, `${id} seat hangs off the board's right edge`)
    assert.ok(meta.seat.y >= 0, `${id} seat has a negative y`)
  }
})

test('the declared default board is collision-free', () => {
  const cells = new Set<string>()
  for (const id of PANEL_IDS) {
    const { seat, steps, defaultStep } = TILES[id]
    const step = steps[defaultStep]
    for (let y = seat.y; y < seat.y + step.h; y++) {
      for (let x = seat.x; x < seat.x + step.w; x++) {
        const key = `${x},${y}`
        assert.ok(!cells.has(key), `default board overlaps at ${key} (${id})`)
        cells.add(key)
      }
    }
  }
})

test('the declared default board is vertically packed — no tile can move up', () => {
  // The RGL-compaction-stability invariant: for every tile, some cell
  // directly above its span (in rows 0..y-1) is occupied, or the tile is
  // already at row 0. If any tile could slide up, the board we hand RGL is
  // not the board it renders.
  const board = PANEL_IDS.map((id) => {
    const { seat, steps, defaultStep } = TILES[id]
    return { id, ...seat, ...steps[defaultStep] }
  })
  const taken = (x: number, y: number): boolean =>
    board.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)
  for (const t of board) {
    if (t.y === 0) continue
    let blocked = false
    for (let x = t.x; x < t.x + t.w && !blocked; x++) {
      // Blocked if ANY row above (0..y-1) in this column is occupied.
      for (let y = 0; y < t.y; y++) {
        if (taken(x, y)) {
          blocked = true
          break
        }
      }
    }
    assert.ok(blocked, `${t.id} at y=${t.y} can slide up — the default board is not packed`)
  }
})
