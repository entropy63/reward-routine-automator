// The activity-log writers: how the worker reports into the popup's
// Activity card. Tab cleanup and the routine run while the popup is closed,
// and the reads run in background tabs whose console nobody can open, so
// their outcomes travel through storage instead — including the ADR-010
// markup dumps the readers attach when a page surprises them (capped at the
// readers' own 1500-char slice; the popup shows the dump as the row's hover
// text).
//
// The keys match src/ exactly (lastTabAction, lastRewards, lastStatsLog,
// lastRedeemLog, lastImageSearch) so the Stage-3 popup port reads them
// unchanged.

// Display names for the Activity rows; stepIds are the settings/
// startupOrder ids.
export const STEP_LABEL = {
  claim: "claim",
  dailySet: "daily set",
  keepEarning: "keep earning",
  search: "web searches",
  imageSearch: "image search"
};

export async function setLastTabAction(detail, ok) {
  await chrome.storage.local.set({ lastTabAction: { detail, ok } });
}

// The Rewards steps' shared row. Worth reporting rather than logging because
// Keep earning offers a different number of activities every day — the count
// is the only way to tell "there were three today" from "the finder missed
// them". The optional dump is the claim flow's evidence markup.
export async function setLastRewards(detail, ok, dump) {
  await chrome.storage.local.set({
    lastRewards: { detail, ok, dump: typeof dump === "string" ? dump : "" }
  });
}

// The stats read's own row (the redeem row's pattern).
export async function setLastStatsLog(detail, ok, dump) {
  await chrome.storage.local.set({
    lastStatsLog: { detail, ok, dump: typeof dump === "string" ? dump : "" }
  });
}

// The redeem watch's own row.
export async function setLastRedeemLog(detail, ok, dump) {
  await chrome.storage.local.set({
    lastRedeemLog: { detail, ok, dump: typeof dump === "string" ? dump : "" }
  });
}

// The image search's row; `at` lets the popup dim stale entries.
export async function reportImageSearch(detail, ok = null) {
  console.log("Image search:", detail);
  await chrome.storage.local.set({
    lastImageSearch: { detail, ok, at: new Date().toISOString() }
  });
}
