// The per-section storage map (user request, 2026-09-11: "if the developer
// option is set to on and if I go to the dashboard, for each section that has
// local storage, there should be a button to reset that section's local
// storage… its button will only clear the section's own local storage").
//
// A section's OWN keys are the ones its tiles read for their content — never
// another section's. The sections that ride shared data carry no button:
// streaks and next read lastStats (the Balance section's key), and the Run
// controls live in chrome.storage.sync settings, not local storage at all.
// Resetting a key fires chrome.storage.onChanged, and useStorageValue's live
// subscription re-renders the tile empty on the spot — no reload needed.

import { KEYS } from '../../../shared/storage.ts'

export const SECTION_LOCAL_KEYS: Record<string, readonly string[]> = {
  // The stats hero: the read stats doc + the coupons count on its stat row.
  balance: [KEYS.lastStats, KEYS.lastCoupons],
  // The graph: the daily points history.
  history: [KEYS.pointsHistory],
  // The Overwatch catalog: the last redeem read (variants + prices).
  catalog: [KEYS.lastRedeem],
  // The stock news: the restock and sell-out records.
  news: [KEYS.redeemRestockNews, KEYS.redeemSoldOutNews],
  // The order rows: the synced orders doc.
  orders: [KEYS.lastOrders],
  // The activity log: every "last …" row it renders.
  log: [
    KEYS.lastTabAction,
    KEYS.lastRewards,
    KEYS.lastStatsLog,
    KEYS.lastRedeemLog,
    KEYS.lastOrdersLog,
    KEYS.lastImageSearch,
    KEYS.lastQuery,
  ],
}
