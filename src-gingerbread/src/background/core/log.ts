// The activity-log writers: how the worker reports into the popup's Activity
// view. Tab cleanup and the routine run while the popup is closed, and the
// reads run in background tabs whose console nobody can open, so their
// outcomes travel through storage instead — including the ADR-010 markup dumps
// the readers attach when a page surprises them (the popup shows the dump as
// the row's hover text). The keys match the earlier builds exactly, so the
// storage schema is unchanged across the rebuild.

import type { StepId } from '../../shared/settings.ts'
import { KEYS, setLocal } from '../../shared/storage.ts'

// Display names for the Activity rows; the ids are the startupOrder ids.
export const STEP_LABEL: Partial<Record<StepId, string>> = {
  claim: 'claim',
  dailySet: 'daily set',
  keepEarning: 'keep earning',
  search: 'web searches',
  imageSearch: 'image search',
}

export async function setLastTabAction(detail: string, ok: boolean | null): Promise<void> {
  await setLocal(KEYS.lastTabAction, { detail, ok })
}

// The Rewards steps' shared row. Worth reporting rather than logging because
// Keep earning offers a different number of activities every day — the count
// is the only way to tell "there were three today" from "the finder missed
// them". The optional dump is the claim flow's evidence markup.
export async function setLastRewards(detail: string, ok: boolean | null, dump?: string): Promise<void> {
  await setLocal(KEYS.lastRewards, { detail, ok, dump: typeof dump === 'string' ? dump : '' })
}

// The stats read's own row.
export async function setLastStatsLog(detail: string, ok: boolean | null, dump?: string): Promise<void> {
  await setLocal(KEYS.lastStatsLog, { detail, ok, dump: typeof dump === 'string' ? dump : '' })
}

// The redeem watch's own row: the read runs in a background tab whose console
// nobody can open, so its outcome — and, on a failure, the markup the reader
// stared at (ADR-010) — lands here instead.
export async function setLastRedeemLog(detail: string, ok: boolean | null, dump?: string): Promise<void> {
  await setLocal(KEYS.lastRedeemLog, { detail, ok, dump: typeof dump === 'string' ? dump : '' })
}

// The order-history sync's own row: same reasoning as the redeem watch — a
// multi-dialog background read whose outcome belongs in the Activity view.
export async function setLastOrdersLog(detail: string, ok: boolean | null, dump?: string): Promise<void> {
  await setLocal(KEYS.lastOrdersLog, { detail, ok, dump: typeof dump === 'string' ? dump : '' })
}

// The image search's row; `at` lets the popup dim stale entries.
export async function reportImageSearch(detail: string, ok: boolean | null = null): Promise<void> {
  console.log('Image search:', detail)
  await setLocal(KEYS.lastImageSearch, { detail, ok, at: new Date().toISOString() })
}
