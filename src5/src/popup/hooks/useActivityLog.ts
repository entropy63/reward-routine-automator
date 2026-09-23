import { KEYS } from '../../shared/storage.ts'
import type { ImageSearchRow, LastQuery, LogRow } from '../../shared/storage.ts'
import { useStorageValue } from './useStorageValue.ts'

// Every engine subsystem's last-line log row, read in ONE place. The popup's
// Activity view and the dashboard's Activity-log tile show the same set, so
// they read it through this hook (seven live storage subscriptions, one per
// key) instead of repeating the reads. `hasLogs` is the shared "anything to
// show yet?" both surfaces hang their empty state on.
export interface ActivityLog {
  tabAction: LogRow | null
  rewards: LogRow | null
  statsLog: LogRow | null
  redeemLog: LogRow | null
  ordersLog: LogRow | null
  imageLog: ImageSearchRow | null
  lastQuery: LastQuery | null
  hasLogs: boolean
}

export function useActivityLog(): ActivityLog {
  const { value: tabAction } = useStorageValue<LogRow | null>('local', KEYS.lastTabAction, null)
  const { value: rewards } = useStorageValue<LogRow | null>('local', KEYS.lastRewards, null)
  const { value: statsLog } = useStorageValue<LogRow | null>('local', KEYS.lastStatsLog, null)
  const { value: redeemLog } = useStorageValue<LogRow | null>('local', KEYS.lastRedeemLog, null)
  const { value: ordersLog } = useStorageValue<LogRow | null>('local', KEYS.lastOrdersLog, null)
  const { value: imageLog } = useStorageValue<ImageSearchRow | null>('local', KEYS.lastImageSearch, null)
  const { value: lastQuery } = useStorageValue<LastQuery | null>('local', KEYS.lastQuery, null)
  const hasLogs = Boolean(
    tabAction?.detail ||
      rewards?.detail ||
      statsLog?.detail ||
      redeemLog?.detail ||
      ordersLog?.detail ||
      imageLog?.detail ||
      lastQuery?.text,
  )
  return { tabAction, rewards, statsLog, redeemLog, ordersLog, imageLog, lastQuery, hasLogs }
}
