// Pure layout migration + sanitation (6.8.0 rewrite). Whatever sits under
// the dashLayout key becomes a clean list of registry-legal items: known ids
// only, every size one of the tile's DESIGNED steps, seats inside the board,
// vertically packed and collision-free. react-grid-layout re-compacts on
// render anyway — this module exists so the doc we READ, the doc we WRITE
// and the doc the tests reason about are all the same shape.

import type { DashLayoutItem, DashLayoutV2, StoredDashLayout } from '../../../shared/storage.ts'
import { GRID_COLS, PANEL_IDS, TILES, metaOf, stepCeiling, stepFloor } from '../tiles/registry.ts'
import { snapToStep, stepIndexOf } from './snap.ts'

export type RGLItem = DashLayoutItem & {
  minW: number
  maxW: number
  minH: number
  maxH: number
}

// The registry's default board: the designed default step of every tile at
// its declared seat. The board is packed BY DESIGN (tests assert it) — no
// overlaps, every tile as high as its column span allows — so RGL's own
// vertical compaction leaves it untouched.
export function defaultBoard(): RGLItem[] {
  return PANEL_IDS.map((id) => withBounds({ ...TILES[id].steps[TILES[id].defaultStep], i: id, ...TILES[id].seat }))
}

function withBounds(item: DashLayoutItem): RGLItem {
  const meta = metaOf(item.i)
  if (!meta) return { ...item, minW: 1, maxW: GRID_COLS, minH: 1, maxH: 8 }
  const floor = stepFloor(meta)
  const ceiling = stepCeiling(meta)
  return {
    ...item,
    w: Math.max(floor.w, Math.min(ceiling.w, Math.round(item.w) || floor.w)),
    h: Math.max(floor.h, Math.min(ceiling.h, Math.round(item.h) || floor.h)),
    minW: floor.w,
    maxW: ceiling.w,
    minH: floor.h,
    maxH: ceiling.h,
  }
}

// Snaps a free size onto the tile's designed steps (nearest pair, in px).
function snapItem(item: DashLayoutItem): RGLItem {
  const bounded = withBounds(item)
  const meta = metaOf(item.i)
  if (!meta) return bounded
  const s = snapToStep(meta.steps, bounded.w, bounded.h)
  return { ...bounded, w: s.w, h: s.h }
}

// One occupancy grid pass: tiles are placed top-to-bottom (sorted by y, then
// x), each as HIGH as its column span allows, scanning columns left to
// right. Used to seat migrated legacy docs; RGL's own vertical compaction
// agrees with a board already packed this way.
export function compact(items: DashLayoutItem[]): DashLayoutItem[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const occupied: boolean[][] = []
  const free = (y: number, x: number, h: number, w: number): boolean => {
    for (let r = y; r < y + h; r++) {
      const cells = occupied[r]
      if (cells) for (let c = x; c < x + w; c++) if (cells[c]) return false
    }
    return true
  }
  const out: DashLayoutItem[] = []
  for (const item of sorted) {
    // A width past the board would spin the scan below forever — clamp first
    // (migrate() already bounds every item; this guards direct callers).
    const w = Math.max(1, Math.min(GRID_COLS, Math.round(item.w) || 1))
    let placed = false
    for (let y = 0; !placed; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        if (free(y, x, item.h, w)) {
          out.push({ ...item, x, y, w })
          for (let r = y; r < y + item.h; r++) {
            const cells = (occupied[r] ||= [])
            for (let c = x; c < x + w; c++) cells[c] = true
          }
          placed = true
          break
        }
      }
    }
  }
  // Restore the caller's order (sorted by id list) so the doc is stable.
  const byId = new Map(out.map((it) => [it.i, it]))
  return items.map((it) => byId.get(it.i) || it)
}

// The v2 doc we persist. Bounds are stamped in (the registry is the source,
// so a step-list edit re-bounds a stored board on read) and the list is
// always in registry order — and only the FIVE persistable fields are
// written, so react-grid-layout's internal echoes (moved/static flags and
// friends) never leak into storage.
export function toDoc(items: DashLayoutItem[]): DashLayoutV2 {
  return {
    v: 2,
    items: PANEL_IDS.map((id) => items.find((it) => it.i === id))
      .filter((it): it is DashLayoutItem => !!it)
      .map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
  }
}

// Whatever is stored → clean, packed, designed-steps-only items. Unknown ids
// drop; a missing tile appends at its designed default step; legacy
// {order, span, rows} docs flow through the old grid's row-major auto-seat
// first (so "next to the one above it" survives), and {columns} masonry docs
// transpose to that flow order exactly as 6.7.16 did.
export function migrate(raw: StoredDashLayout | null | undefined): RGLItem[] {
  const legacyOrder = (ids: string[], span: Record<string, number>, rows: Record<string, number>): DashLayoutItem[] => {
    // The 6.7 grid's sparse row auto-placement, simulated — a cursor walks
    // right, wrapping and skipping past cells taller panels already fill.
    const occupied: boolean[][] = []
    const free = (y: number, x: number, h: number, w: number): boolean => {
      for (let r = y; r < y + h; r++) {
        const cells = occupied[r]
        if (cells) for (let c = x; c < x + w; c++) if (cells[c]) return false
      }
      return true
    }
    let track = 0
    let col = 0
    const out: DashLayoutItem[] = []
    for (const id of ids) {
      const meta = metaOf(id)
      if (!meta) continue
      const raw = { w: span[id], h: rows[id] }
      const step = snapToStep(meta.steps, raw.w || meta.steps[meta.defaultStep].w, raw.h || meta.steps[meta.defaultStep].h)
      for (;;) {
        if (col + step.w > GRID_COLS) {
          track += 1
          col = 0
        } else if (free(track, col, step.h, step.w)) {
          break
        } else {
          col += 1
        }
      }
      out.push({ i: id, x: col, y: track, w: step.w, h: step.h })
      for (let r = track; r < track + step.h; r++) {
        const cells = (occupied[r] ||= [])
        for (let c = col; c < col + step.w; c++) cells[c] = true
      }
      col += step.w
    }
    return out
  }

  let seeded: DashLayoutItem[] | null = null
  if (raw && Array.isArray((raw as { items?: unknown }).items)) {
    // The current v2 doc — keep known ids' seats (first occurrence wins;
    // a junk doc may repeat one), snap any size that isn't a designed step
    // (an older registry's step, or junk).
    const doc = raw as { items: { i: unknown; x: unknown; y: unknown; w: unknown; h: unknown }[] }
    const seen = new Set<string>()
    seeded = []
    for (const it of doc.items) {
      const id = String(it?.i)
      if (!metaOf(id) || seen.has(id)) continue
      seen.add(id)
      seeded.push(snapItem({ i: id, x: Number(it.x) || 0, y: Number(it.y) || 0, w: Number(it.w) || 1, h: Number(it.h) || 1 }))
    }
  } else if (raw && Array.isArray((raw as { order?: unknown }).order)) {
    const doc = raw as { order: unknown[]; span?: Record<string, number>; rows?: Record<string, number> }
    seeded = legacyOrder(doc.order.map(String), doc.span || {}, doc.rows || {})
  } else if (raw && Array.isArray((raw as { columns?: unknown }).columns)) {
    const columns = (raw as { columns: unknown[][] }).columns as unknown[][]
    // Masonry columns → row-major order (the 6.7.16 transposition): the
    // panel beside a column's top stays beside it.
    const order: string[] = []
    const seen = new Set<string>()
    const depth = columns.reduce((n, c) => Math.max(n, Array.isArray(c) ? c.length : 0), 0)
    for (let r = 0; r < depth; r++) {
      for (const c of columns) {
        const id = Array.isArray(c) ? c[r] : null
        if (metaOf(String(id)) && !seen.has(String(id))) {
          seen.add(String(id))
          order.push(String(id))
        }
      }
    }
    seeded = legacyOrder(order, {}, {})
  }

  const board = seeded ? [...seeded] : defaultBoard()
  // Anything the registry knows that the doc doesn't (a tile added since the
  // doc was written) joins at its designed default seat.
  for (const id of PANEL_IDS) {
    if (!board.some((it) => it.i === id)) {
      const meta = TILES[id]
      board.push({ i: id, ...meta.seat, ...meta.steps[meta.defaultStep] })
    }
  }
  // Seats stay where the user put them (or where the legacy flow placed
  // them) — only a seat that hangs off the board's right edge is pulled
  // back in. Overlaps a size snap may have introduced are LEFT for
  // react-grid-layout's own vertical compaction: it resolves them at render
  // and fires onLayoutChange, which persists the settled board (self-
  // healing — the stored doc never stays broken). The list comes back in
  // REGISTRY order (the same order toDoc writes and the board renders), so
  // what we read, write and show all agree.
  return PANEL_IDS.map((id) => board.find((it) => it.i === id))
    .filter((it): it is DashLayoutItem => !!it)
    .map(withBounds)
    .map((it) => ({ ...it, x: Math.max(0, Math.min(it.x, GRID_COLS - it.w)), y: Math.max(0, it.y) }))
}

// The step INDEX a tile sits at (its content variant), for tiles and the
// diag gates. A stored size is always a designed step after migrate(), so
// this never misses in practice; -1 says "not on any designed step".
export function stepIndex(id: string, w: number, h: number): number {
  const meta = metaOf(id)
  return meta ? stepIndexOf(meta.steps, w, h) : -1
}
