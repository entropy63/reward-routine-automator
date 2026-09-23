// The pure migration + sanitation (6.8.0 rewrite): whatever sits under the
// dashLayout key becomes a clean list of registry-legal items — known ids
// only, designed steps only, seats on the board, missing tiles appended.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compact, defaultBoard, migrate, stepIndex, toDoc } from '../src/pages/dashboard/layout/migrate.ts'
import { GRID_COLS, PANEL_IDS, TILES } from '../src/pages/dashboard/tiles/registry.ts'

// Every item on a designed step, on the board, in registry order.
const assertClean = (items: ReturnType<typeof migrate>) => {
  assert.equal(items.length, PANEL_IDS.length)
  PANEL_IDS.forEach((id, i) => {
    const it = items[i]
    assert.equal(it.i, id)
    assert.ok(it.w >= 1 && it.x >= 0 && it.x + it.w <= GRID_COLS, `${id} hangs off the board`)
    assert.ok(it.y >= 0, `${id} has a negative y`)
    assert.ok(stepIndex(id, it.w, it.h) >= 0, `${id} sits at ${it.w}x${it.h}, not a designed step`)
    // The bounds are per-axis min/max across the lattice's steps (a lattice's
    // smallest-area step need not be the narrowest — streaks' floor step is
    // 4×1 but its 3-wide quad is legal).
    assert.equal(it.minW, Math.min(...TILES[id].steps.map((s) => s.w)))
    assert.equal(it.maxH, Math.max(...TILES[id].steps.map((s) => s.h)))
  })
}

test('a null doc yields the declared default board', () => {
  const items = migrate(null)
  assertClean(items)
  const defaults = defaultBoard()
  PANEL_IDS.forEach((_, i) => {
    assert.equal(items[i].x, defaults[i].x)
    assert.equal(items[i].y, defaults[i].y)
    assert.equal(items[i].w, defaults[i].w)
    assert.equal(items[i].h, defaults[i].h)
  })
})

test('a v2 doc keeps its seats and snaps off-registry sizes', () => {
  const items = migrate({
    v: 2,
    items: [
      { i: 'orders', x: 3, y: 1, w: 9, h: 9 }, // off-registry size → snapped
      { i: 'balance', x: 0, y: 0, w: 4, h: 2 }, // a designed step → kept
      { i: 'nope', x: 0, y: 0, w: 1, h: 1 }, // unknown id → dropped
    ],
  })
  assertClean(items)
  const orders = items.find((it) => it.i === 'orders')!
  assert.equal(orders.x, 3, 'the stored x is preserved (only clamped, never re-seated)')
  assert.equal(orders.y, 1)
  assert.ok(stepIndex('orders', orders.w, orders.h) >= 0, 'the 9x9 was snapped onto a designed step')
  const balance = items.find((it) => it.i === 'balance')!
  assert.deepEqual([balance.x, balance.y, balance.w, balance.h], [0, 0, 4, 2])
})

test('a v2 doc dedupes repeated ids', () => {
  const items = migrate({ v: 2, items: [{ i: 'log', x: 0, y: 0, w: 4, h: 2 }, { i: 'log', x: 6, y: 0, w: 6, h: 3 }] })
  assertClean(items)
  assert.equal(items.filter((it) => it.i === 'log').length, 1)
  // First occurrence wins.
  assert.equal(items.find((it) => it.i === 'log')!.w, 4)
})

test('a v2 doc with a seat past the right edge is pulled back in', () => {
  const items = migrate({ v: 2, items: [{ i: 'history', x: 10, y: 0, w: 6, h: 2 }] })
  assertClean(items)
  const history = items.find((it) => it.i === 'history')!
  assert.ok(history.x + history.w <= GRID_COLS)
})

test(`a legacy {order, span, rows} doc flows through the old grid's auto-seat`, () => {
  const items = migrate({
    order: ['balance', 'history', 'streaks'],
    span: { balance: 4, history: 4, streaks: 4 },
    rows: { balance: 2, history: 2, streaks: 2 },
  })
  assertClean(items)
  // The three named tiles sit left-to-right on row 0, like the old grid.
  const seeded = items.filter((it) => ['balance', 'history', 'streaks'].includes(it.i))
  assert.deepEqual(seeded.map((it) => it.x), [0, 4, 8])
  assert.ok(seeded.every((it) => it.y === 0), 'a 4+4+4 row band seats all three on row 0')
})

test('a legacy doc with a missing tile appends the tile at its default seat', () => {
  const items = migrate({
    order: ['balance'],
    span: { balance: 4 },
    rows: { balance: 2 },
  })
  assertClean(items)
  // Everything not named joins at its declared seat.
  for (const id of PANEL_IDS.slice(1)) {
    const it = items.find((x) => x.i === id)!
    assert.deepEqual([it.x, it.y], [TILES[id].seat.x, TILES[id].seat.y], `${id} joins at its designed seat`)
  }
})

test('a {columns} masonry doc transposes row-major', () => {
  const items = migrate({
    columns: [
      ['balance', 'controls', 'orders'],
      ['history', 'next'],
      ['streaks', 'catalog'],
    ],
  })
  assertClean(items)
  // Row-major: balance, history, streaks first — "next to the one above it"
  // (the 6.7.16 transposition).
  const order = items.map((it) => it.i).slice(0, 3)
  assert.deepEqual(order, ['balance', 'history', 'streaks'])
})

test('toDoc round-trips a migrated board', () => {
  const doc = toDoc(migrate({ v: 2, items: [{ i: 'orders', x: 3, y: 1, w: 6, h: 4 }] }))
  assert.equal(doc.v, 2)
  assert.equal(doc.items.length, PANEL_IDS.length)
  // Registry order, every size a designed step — and the doc re-migrates to
  // the same board.
  const again = migrate(doc)
  assert.deepEqual(
    again.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h })),
    toDoc(again).items.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h })),
  )
})

test('compact packs a scattered board upward', () => {
  const packed = compact([
    { i: 'log', x: 6, y: 9, w: 6, h: 3 },
    { i: 'orders', x: 0, y: 5, w: 6, h: 4 },
    { i: 'controls', x: 0, y: 20, w: 4, h: 3 },
  ])
  // orders (y5) and log (y9) float to row 0 in their columns; controls
  // (y20) can't join row 0 (orders holds x0–5, log x6–11 for 3 rows), so
  // it stacks under log at row 3 — packed as high as its span allows.
  const byId = Object.fromEntries(packed.map((it) => [it.i, it]))
  assert.equal(byId.orders.y, 0)
  assert.equal(byId.log.y, 0)
  assert.equal(byId.controls.y, 3)
  // And nothing overlaps.
  const cells = new Set<string>()
  for (const it of packed) {
    for (let y = it.y; y < it.y + it.h; y++) {
      for (let x = it.x; x < it.x + it.w; x++) {
        const key = `${x},${y}`
        assert.ok(!cells.has(key), `compact overlapped at ${key}`)
        cells.add(key)
      }
    }
  }
})

test('compact never hangs on a width past the board', () => {
  // A direct caller could hand in junk; the clamp keeps the scan finite.
  const packed = compact([{ i: 'log', x: 0, y: 0, w: 99, h: 2 }])
  assert.equal(packed[0].w, GRID_COLS)
})
