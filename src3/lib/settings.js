// Settings live in storage.sync (small, user-owned, worth syncing across
// devices) under one "settings" key. Everything here is effectful storage
// access; the shape's defaults and its normalization rules are data, below.

// Values mirrored in the popup. Keys the popup alone reads are marked; the
// worker must keep treating them as opaque booleans/strings it stores but
// never interprets.
export const DEFAULT_SETTINGS = {
  startupEnabled: false,           // Master switch for the whole startup
                                   // sequence (default off, user request
                                   // 2026-09-03; a user who turns it on keeps
                                   // it on — the stored setting always wins)
  startupOncePerDay: true,         // Skip the startup routine if it already
                                   // completed today
  confirmBeforeRoutine: true,      // Ask before the startup routine starts
  statsStartupEnabled: true,       // Stats step (the routine's opening read)
  claimStartupEnabled: true,       // Claim step
  dailySetStartupEnabled: true,    // Daily set step
  keepEarningStartupEnabled: true, // Keep earning step
  searchStartupEnabled: true,      // Web search step
  imageSearchStartupEnabled: true, // Image search step
  // Sequence of the startup steps; the popup reorders this by drag. The
  // stats read goes first so the numbers reflect the day before the steps
  // churn the dashboard, and claim before the others so pending points land
  // early.
  startupOrder: ["stats", "claim", "dailySet", "keepEarning", "search", "imageSearch"],
  // Order of the popup's cards (keys into the data-section attributes in
  // popup.html); the popup reorders this by drag in layout edit mode. The
  // third build's redesign renamed the Stats card to Today (ADR-019) and it
  // leads the main view.
  sectionOrder: ["today", "runNow", "redeem", "activity"], // popup.js only
  querySourceOrder: ["bingAutosuggest", "googleTrends", "wikipedia", "uselessFacts", "local"],
  searchesPerBatch: 30,            // How many searches per batch
  // Right-size the batch to the day's remaining search points (ADR-016 §7):
  // today's read saying 40/60 runs ceil(20/3) = 7 searches, not the full 30.
  // Turned off, the configured batch always runs.
  rightSizeSearchBatch: true,
  minDelaySec: 5,                  // Min delay between searches (seconds)
  maxDelaySec: 15,                 // Max delay between searches (seconds)

  // Tab cleanup: "perStep" closes each feature's tabs as it finishes (the
  // closeTabsAfter* toggles); "routine" holds every tab open until the whole
  // startup sequence ends, then closes them in one sweep. Manual runs keep
  // their own toggle in routine mode.
  tabCloseMode: "perStep",
  closeTabsAfterManualRun: true,
  closeTabsAfterClaim: true,
  closeTabsAfterDailySet: true,
  closeTabsAfterKeepEarning: true,
  closeTabsAfterSearch: true,
  closeTabsAfterImageSearch: true,
  tabCloseDelaySec: 8,             // Grace period so the page can be credited
  keepPinnedTabs: true,            // Never close a tab the user pinned
  dailySetMaxTiles: 3,
  keepEarningMaxTiles: 0,          // 0 = however many are there today

  // The scheduled daily run (ADR-019): start the routine at a fixed local
  // time, independent of the launch-time routine. Fires only while Chrome
  // is running; a fire missed while the browser was closed runs on the next
  // browser start (the once-per-day gate keeps it from doubling up).
  scheduledRunEnabled: false,
  scheduledRunTime: "09:00",       // local "HH:MM", 24-hour

  // The restock watcher: re-run the redeem watch on a background alarm so
  // the restock/sold-out banners stay fresh without the popup. Opt-in —
  // each round opens a background tab.
  restockWatcherEnabled: false,

  // Everything below is read by popup.js only; the worker stores it and
  // never interprets it.
  animationsEnabled: true,         // Popup motion
  theme: "catppuccin",             // Popup palette ("the purr" defaults to
                                   // catppuccin; geist and primer remain)
  appearance: "auto",              // light/dark/auto (ADR-003)
  refreshStatsOnPopupOpen: true,   // Re-read the stats + redeem on popup open
  popupHeight: 0,                  // 240–600, Chromium's cap; 0 = auto fold
  hiddenSections: [],              // Cards hidden via the layout editor's ×
  developerOptionsEnabled: false,  // The Activity card's gate
  experimentalFeatures: false      // The Coupons button's gate
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
