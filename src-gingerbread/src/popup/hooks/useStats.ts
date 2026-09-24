import { KEYS } from '../../shared/storage.ts'
import type { HistoryEntry, Stats } from '../../shared/storage.ts'
import { useStorageValue } from './useStorageValue.ts'

// A stable empty history reference for the fallback.
const NO_HISTORY: HistoryEntry[] = []

// The last merged stats read (dashboard + Earn cards). Null until the first
// read lands; every verdict downstream re-checks it is today's.
export function useStats(): Stats | null {
  return useStorageValue<Stats | null>('local', KEYS.lastStats, null).value
}

// The points history — one entry per local day (first + last balance), the
// source of "earned today", the 7-day sparkline, and the goal pace.
export function usePointsHistory(): HistoryEntry[] {
  return useStorageValue<HistoryEntry[]>('local', KEYS.pointsHistory, NO_HISTORY).value
}
