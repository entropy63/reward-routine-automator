// Pure step snapping (6.8.0 rewrite). react-grid-layout proposes FREE grid
// units while a grip is dragged; the board's designed-steps constraint (see
// layout/GridLayout.tsx) funnels every proposal through here so a tile only
// ever lands on one of ITS designed sizes — the pair, chosen together, not
// each axis independently (the steps of one tile are layouts, not tracks).
//
// Distance is measured in PIXELS, not grid units, because one column
// (~112px) is not one row (160px): a step that is "1 away" in columns is a
// much smaller nudge than "1 away" in rows, and the snap should feel that
// way under the cursor.

import type { TileStep } from '../tiles/registry.ts'

// A representative column width for callers without the live container at
// hand (the real one is ~112–120px on the diag's 1585px board).
export const FALLBACK_COL_PX = 112

export function snapToStep(steps: TileStep[], w: number, h: number, colPx = FALLBACK_COL_PX, rowPx = 160): TileStep {
  if (steps.length === 0) return { w, h }
  let best = steps[0]
  let bestD = Infinity
  for (const s of steps) {
    const dx = (w - s.w) * colPx
    const dy = (h - s.h) * rowPx
    const d = dx * dx + dy * dy
    // Strict < keeps the EARLIER (smaller) step on a tie.
    if (d < bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

// The index of an exact designed step, or -1 (sanity for stored docs and the
// diag's "every tile sits on a designed step" gate).
export function stepIndexOf(steps: TileStep[], w: number, h: number): number {
  return steps.findIndex((s) => s.w === w && s.h === h)
}
