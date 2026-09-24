// The plan preview — "what would the routine do if it ran right now?".
// Pure: today's stats + the step order in, one verdict per step out. The
// popup calls this with the lastStats it already holds, so the plan the user
// reads is computed by the SAME verdict code the routine itself runs — not a
// re-implementation that can drift from it.

import type { Stats } from '../../shared/storage.ts'
import type { Settings } from '../../shared/settings.ts'
import { DEFAULT_SETTINGS, ENABLED_KEY } from '../../shared/settings.ts'
import { slotMissingDefaults } from './orders.ts'
import { statsAreCurrent, stepSkipReason } from './verdicts.ts'

export interface PlanEntry {
  id: string
  willRun: boolean
  reason: string | null
}

// One entry per step id in the order given. A stale, missing or unreadable
// read never skips — every unknown runs, the same only-wrong-answer-is-
// skipping-something-not-done direction as the routine. Steps with no
// done-check (stats, which is the read itself) always report willRun.
export function routinePlan(
  stats: Stats | null | undefined,
  order: string[],
  now: Date = new Date(),
): PlanEntry[] {
  const fresh = statsAreCurrent(stats, now)
  return (Array.isArray(order) ? order : []).map((id) => {
    const reason = fresh && stats ? stepSkipReason(id, stats) : null
    return { id, willRun: !reason, reason }
  })
}

// The plan over the user's ENABLED startup steps, in their saved order — the
// exact list both the popup's Today card and the dashboard's Next-routine tile
// show. Repairs an older saved order (slotMissingDefaults), keeps only the
// steps the user has switched on, then runs the shared verdicts. One source so
// the two previews can't disagree with each other or with the routine.
export function enabledRoutinePlan(
  settings: Settings,
  stats: Stats | null | undefined,
  now: Date = new Date(),
): PlanEntry[] {
  const order = slotMissingDefaults(settings.startupOrder, DEFAULT_SETTINGS.startupOrder).filter((id) =>
    Boolean(settings[ENABLED_KEY[id]]),
  )
  return routinePlan(stats, order, now)
}
