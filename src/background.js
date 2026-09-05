// background.js

// Default settings
const DEFAULT_SETTINGS = {
  startupEnabled: false,           // Master switch for the whole startup sequence
                                  // (default off, user request 2026-09-03; a
                                  // user who turns it on keeps it on — the
                                  // stored setting always wins over this)
  startupOncePerDay: true,         // Skip the startup routine if it already completed today
  confirmBeforeRoutine: true,      // Ask before the startup routine starts (cancel prompt)
  statsStartupEnabled: true,       // Stats step (the routine's opening Rewards read)
  claimStartupEnabled: true,       // Claim step
  dailySetStartupEnabled: true,    // Daily set step
  keepEarningStartupEnabled: true, // Keep earning step
  searchStartupEnabled: true,      // Web search step
  imageSearchStartupEnabled: true, // Image search step
  // Sequence of the startup steps; the popup reorders this by drag. The stats
  // read goes first so the numbers reflect the day before the steps churn the
  // dashboard, and claim before the others so pending points land early.
  startupOrder: ["stats", "claim", "dailySet", "keepEarning", "search", "imageSearch"],
  // Order of the popup's cards; the popup reorders this by drag in layout
  // edit mode. Keys into the data-section attributes in popup.html. The
  // Run-on-startup card lives in the popup's Settings view (2026-09-03), so
  // it left this list; the Search settings card became the Run now card's
  // gear panel the same day, so it left too; the Redeem card joined after
  // Stats. Saved orders from before any of these changes are normalized on
  // load (unknown ids dropped, missing ones slotted at their default spot).
  sectionOrder: ["runNow", "stats", "redeem", "activity"],
  // Fallback order of the query sources (ids key into QUERY_SOURCES); the
  // popup reorders this by drag too. Each search tries them in this order
  // until one answers.
  querySourceOrder: ["bingAutosuggest", "googleTrends", "wikipedia", "uselessFacts", "local"],
  searchesPerBatch: 30,            // How many searches per batch
  // Right-size the batch to the day's remaining search points (user request
  // 2026-09-05): today's read saying 40/60 runs ceil(20/3) = 7 searches, not
  // the full 30. Turned off, the configured batch always runs.
  rightSizeSearchBatch: true,
  minDelaySec: 5,                  // Min delay between searches (seconds)
  maxDelaySec: 15,                 // Max delay between searches (seconds)

  // Tab cleanup: each feature tidies up the tabs it opened once it is done.
  // Two modes: "perStep" closes each feature's tabs as it finishes (the five
  // closeTabsAfter* toggles); "routine" holds every tab open until the whole
  // startup sequence ends, then closes them in one sweep. Manual runs keep
  // their own toggle in routine mode.
  tabCloseMode: "perStep",
  closeTabsAfterManualRun: true, // routine mode: a popup-started run's tabs
  closeTabsAfterClaim: true,
  closeTabsAfterDailySet: true,
  closeTabsAfterKeepEarning: true,
  closeTabsAfterSearch: true,
  closeTabsAfterImageSearch: true,
  tabCloseDelaySec: 8,             // Grace period so the page can be credited
  keepPinnedTabs: true,            // Never close a tab the user pinned
  dailySetMaxTiles: 3,             // How many daily set tiles to open
  // Keep earning holds a different number of activities each day, so the useful
  // default is "however many are there". 0 means no limit of our own.
  keepEarningMaxTiles: 0,
  animationsEnabled: true,         // Popup motion (read by popup.js only)
  theme: "geist",                  // Popup palette (read by popup.js only)
  // Popup light/dark: "auto" follows the OS; "light"/"dark" pin it. Read by
  // popup.js only (ADR-003).
  appearance: "auto",
  // Re-read the stats + redeem watch every time the popup opens (the popup
  // is usually opened to CHECK the numbers). Read by popup.js only.
  refreshStatsOnPopupOpen: true,
  // Popup window height in px (240–600, Chromium's cap); 0 = the automatic
  // fold at the deepest visible card. Read by popup.js only.
  popupHeight: 0,
  // Sections hidden from the main view by the layout editor's × button; the
  // topbar's eye button (edit mode) lists them so one click restores one.
  // Read by popup.js only.
  hiddenSections: [],
  // Developer Option: the Activity card only shows in the main view while
  // this is on. Read by popup.js only.
  developerOptionsEnabled: false,
  // Experimental features gate the popup's Coupons button (the dashboard
  // coupon claimer). Off by default until the flow is verified against a
  // live coupon. Read by popup.js only.
  experimentalFeatures: false,
};

// The startup steps, keyed by the ids stored in settings.startupOrder.
// popup.html mirrors these ids in each row's data-step attribute.
const STARTUP_STEPS = {
  // First key on purpose: normalizeStartupOrder() slots a step missing from a
  // saved order at its default index, so existing users get the stats read
  // slotted first, matching the new default order — it must reflect the day
  // before the steps churn the dashboard.
  stats: {
    enabledKey: "statsStartupEnabled",
    run: () => runStartupReads()
  },
  claim: {
    enabledKey: "claimStartupEnabled",
    run: () => runStartupClaim()
  },
  dailySet: {
    enabledKey: "dailySetStartupEnabled",
    run: () => openDailySetOnRewardsDashboard()
  },
  keepEarning: {
    enabledKey: "keepEarningStartupEnabled",
    run: () => openKeepEarningActivities()
  },
  search: {
    enabledKey: "searchStartupEnabled",
    run: () => startSearchBatch()
  },
  imageSearch: {
    enabledKey: "imageSearchStartupEnabled",
    run: () => runRandomImageSearch()
  }
};

const SEARCH_ALARM = "searchTick";
// How long the routine's cancel-before-start dialog waits for an answer
// before silence counts as consent.
const ROUTINE_CONFIRM_TIMEOUT_MS = 15000;
// Steps ordered after the web search step can only run once its batch has
// drained, which may outlive the service worker — so the remainder of the
// sequence is parked in storage rather than held on the stack.
const PENDING_STARTUP_STEPS = "pendingStartupSteps";
// Whether a startup sequence is mid-flight. The step runners are shared with
// manual runs, and a parameter would not survive the search-batch handoff, so
// the routine tells them apart through storage. Cleared by endRoutine() — and
// by a stop or a fresh launch, both of which abandon the sequence where it
// stands.
const ROUTINE_ACTIVE = "routineActive";
// Local calendar day ("YYYY-MM-DD") the startup routine last completed on, for
// the once-per-day gate. It is the whole point that it survives browser
// restarts and service-worker evictions, so it must never appear in any
// cleanup's remove() list — only a newer day supersedes it.
const LAST_ROUTINE_DAY = "lastRoutineDay";
// The day the in-flight routine STARTED on. endRoutine() copies it into
// LAST_ROUTINE_DAY so a routine that crosses midnight is credited to the day
// it began — the new day must still get its own routine, because the daily
// set and searches reset at midnight. In storage.local (not a worker local)
// because the post-search-batch tail finishes in a later worker instance.
const ROUTINE_DAY = "routineDay";
// Tabs stashed by finished steps in "routine" mode, closed in one sweep when
// the sequence ends.
const ROUTINE_PENDING_TABS = "routinePendingTabs";
// The steps this routine skipped as already done (skip-when-done, ADR-016),
// recorded as { id, reason } so the finish page can name them (user request,
// 2026-09-05). In storage because the post-search tail finishes in a later
// worker instance; cleared when the next routine starts and consumed by
// endRoutine() when the finish page opens.
const ROUTINE_SKIPPED = "routineSkipped";
// The right-sizing verification loop's state (2026-09-05): { round, pair,
// freshAt } while a right-sized batch is mid-loop — the batch that just
// finished started from `pair`, and `freshAt` (written only by the verifier)
// tells the next startSearchBatch its read is seconds old. Survives worker
// evictions because the loop spans batches.
const SEARCH_RIGHT_SIZE_RUN = "searchRightSizeRun";
// Generation counter for Stop: stopAllActivity() bumps it, and every runner
// compares it against the value it captured at start to see it was stopped.
const ACTIVITY_TOKEN = "activityToken";
// Which tabs each feature opened, and which features are currently collecting.
// In storage rather than memory because a batch outlives the service worker.
const OPENED_TABS = "openedTabs";        // { [stepId]: number[] }
const CAPTURING_STEPS = "capturingSteps"; // stepId[]
const KEEPALIVE_MS = 20000;      // Service worker idles out at ~30s
const WATCHDOG_PAD_MS = 15000;   // Alarm fires after the timer, as a backstop
const MAX_QUERY_LEN = 90;
const RECENT_QUERY_MEMORY = 200;
// Trending-search titles cached for the current local day ({ day, titles }),
// so the Trends query source costs one fetch per day, not one per query. Left
// absent (never an empty array) when a fetch fails, so the next query retries.
const TRENDS_CACHE = "trendsCache";
// The dashboard stats last read by refreshStats(): display strings exactly as
// the dashboard shows them, plus the epoch-ms read time. In storage.local so
// the popup can show the last read even when it happened headless at startup.
const LAST_STATS = "lastStats";
// The Overwatch-coins redeem options last read by checkRedeemAvailability():
// { at, query, options: [{ title, points, available, href }] }. Same storage
// reasoning as LAST_STATS — the popup shows the last read even when it
// happened headless at the start of the routine.
const LAST_REDEEM = "lastRedeem";
// Stock-change news from the redeem watch (2026-09-03), one record per
// direction for the popup's two banners: { at, labels } for restocked
// amounts and { at, labels } for newly sold-out ones, written when a
// variants read shows a flip vs the previous read. The banners are NOT
// dismissible: a record clears only when the amount flips back, which moves
// it into the opposite record instead.
const REDEEM_RESTOCK_NEWS = "redeemRestockNews";
const REDEEM_SOLD_OUT_NEWS = "redeemSoldOutNews";
// The last coupon count read off the dashboard's "Coupon (N)" trigger:
// { at, available }. available === 0 is what grays the popup's Coupons
// button (every coupon applied); a missing record means "unknown", which
// stays green. The claim run also writes 0 once it has applied everything
// it found.
const LAST_COUPONS = "lastCoupons";
// The routine's finish page: endRoutine() opens "routine-done.html" (with the
// streak summary in the ?q= query) instead of leaving a blank tab behind.
// The page URL is also the tab the Clear-tabs action must never take down —
// the user's one request for it (2026-09-04) — so clearAllTabs() exempts any
// tab whose pendingUrl/url matches this prefix.
const ROUTINE_DONE_URL = "routine-done.html";
const IDLE_STATUS = {
  running: false,
  remaining: 0,
  tabId: null,
  nextRunAt: null,
  runId: 0
};

// These handles live only as long as the service worker. If it is evicted
// mid-batch the watchdog alarm revives it and the batch resumes from the
// persisted status, so nothing here needs to survive a restart.
let searchTimer = null;
let keepAliveTimer = null;
let keepAliveHolds = 0;
// The watchdog alarm (armed with a 15s pad) can fire while a slow tick — a
// ~15s typing injection plus the query fetch — is still mid-flight. Two
// concurrent ticks would share the same runId and interleave their typing in
// the same search box, so the alarm tick is dropped instead. Same lifetime as
// the timers above: if the worker was evicted, the in-flight tick died with
// the flag, and a revived worker starts with it false — which is correct.
let tickInFlight = false;
// Resolver of the routine's cancel-before-start dialog: the answer message
// and the awaiting confirmRoutineStart() are separate functions, so the live
// prompt's outcome crosses through here. Null while no prompt is waiting —
// which is what makes a stale click after the timeout a no-op.
let routineConfirmResolver = null;
// Window id of that dialog, so windows.onRemoved can tell it from any other
// window. Null while no dialog is up; nulled by settle() when it comes down.
let routineConfirmWindowId = null;

// ---------- Storage helpers ----------
// settings -> storage.sync (small, user-owned, worth syncing across devices)
// status / lastQuery / recentQueries -> storage.local (churns every search,
// which would burn through the sync write quota)

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getStatus() {
  const { status } = await chrome.storage.local.get("status");
  return { ...IDLE_STATUS, ...(status || {}) };
}

async function setStatus(patch) {
  const next = { ...(await getStatus()), ...patch };
  await chrome.storage.local.set({ status: next });
  return next;
}

// Runners capture the token when they start; stopAllActivity() bumps it, so a
// token that no longer matches means "you were stopped".
async function currentActivityToken() {
  const { [ACTIVITY_TOKEN]: value } = await chrome.storage.local.get(ACTIVITY_TOKEN);
  return Number(value) || 0;
}

// The local calendar day as "YYYY-MM-DD". Built from the local date
// components on purpose: date.toISOString().slice(0, 10) would give the UTC
// day, which flips at the wrong hour for any non-UTC timezone. Here the day
// starts at local midnight; 11:59pm is simply "not yet tomorrow". Kept pure
// (no storage access) so tests can pass any Date in.
function localDayKey(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------- Tab bookkeeping ----------
//
// Each feature records the tabs it opens so it can close them again when it
// finishes. Daily set is the reason this can't just remember one id: clicking a
// tile opens further tabs, so anything created while a feature is "capturing"
// counts as belonging to it.

// Every update here is read-modify-write on shared keys, and tabs.onCreated can
// fire twice in a row, so the writes are queued instead of racing each other.
let tabBookkeeping = Promise.resolve();

function serializeTabWrite(task) {
  const result = tabBookkeeping.then(task, task);
  tabBookkeeping = result.catch(() => {});
  return result;
}

chrome.tabs.onCreated.addListener(tab => {
  if (tab && tab.id != null) {
    recordOpenedTab(tab.id).catch(e => console.warn("Tab capture failed:", e));
  }
});

function recordOpenedTab(tabId) {
  return serializeTabWrite(async () => {
    const store = await chrome.storage.local.get([CAPTURING_STEPS, OPENED_TABS]);
    const capturing = Array.isArray(store[CAPTURING_STEPS])
      ? store[CAPTURING_STEPS]
      : [];
    if (!capturing.length) return;

    const opened = { ...(store[OPENED_TABS] || {}) };
    for (const stepId of capturing) {
      const ids = Array.isArray(opened[stepId]) ? opened[stepId] : [];
      if (!ids.includes(tabId)) opened[stepId] = ids.concat(tabId);
    }

    await chrome.storage.local.set({ [OPENED_TABS]: opened });
  });
}

// A tab we opened ourselves, or an existing one we claimed — ensureBingTab can
// reuse a tab, and a reused tab never fires onCreated.
function claimTab(stepId, tabId) {
  if (tabId == null) return Promise.resolve();

  return serializeTabWrite(async () => {
    const store = await chrome.storage.local.get(OPENED_TABS);
    const opened = { ...(store[OPENED_TABS] || {}) };
    const ids = Array.isArray(opened[stepId]) ? opened[stepId] : [];
    if (ids.includes(tabId)) return;

    opened[stepId] = ids.concat(tabId);
    await chrome.storage.local.set({ [OPENED_TABS]: opened });
  });
}

function beginTabCapture(stepId) {
  return serializeTabWrite(async () => {
    const store = await chrome.storage.local.get([CAPTURING_STEPS, OPENED_TABS]);
    const capturing = new Set(
      Array.isArray(store[CAPTURING_STEPS]) ? store[CAPTURING_STEPS] : []
    );
    capturing.add(stepId);

    // A fresh run starts from an empty list; the previous run's tabs were
    // already dealt with, or deliberately left alone.
    const opened = { ...(store[OPENED_TABS] || {}), [stepId]: [] };
    await chrome.storage.local.set({
      [CAPTURING_STEPS]: [...capturing],
      [OPENED_TABS]: opened
    });
  });
}

// Stops capturing and hands back the tabs collected so far.
function endTabCapture(stepId) {
  return serializeTabWrite(async () => {
    const store = await chrome.storage.local.get([CAPTURING_STEPS, OPENED_TABS]);
    const capturing = (
      Array.isArray(store[CAPTURING_STEPS]) ? store[CAPTURING_STEPS] : []
    ).filter(id => id !== stepId);

    const opened = { ...(store[OPENED_TABS] || {}) };
    const ids = Array.isArray(opened[stepId]) ? opened[stepId] : [];
    delete opened[stepId];

    await chrome.storage.local.set({
      [CAPTURING_STEPS]: capturing,
      [OPENED_TABS]: opened
    });
    return ids;
  });
}

// Capture state that outlived its run would attribute unrelated tabs to a
// feature and then close them.
async function resetTabCapture() {
  await chrome.storage.local.remove([CAPTURING_STEPS, OPENED_TABS]);
}

// Tab cleanup happens while the popup is closed, so it reports into the same
// Activity list as everything else rather than only into the console.
const STEP_LABEL = {
  claim: "claim",
  dailySet: "daily set",
  keepEarning: "keep earning",
  search: "web searches",
  imageSearch: "image search"
};

async function setLastTabAction(detail, ok) {
  await chrome.storage.local.set({ lastTabAction: { detail, ok } });
}

// The redeem watch's own report row (2026-09-03, user request: no devtools on
// the machine — the errors must surface in the popup). The read runs in a
// background tab whose console nobody can open, so its failures — and the
// ADR-010 markup dumps the readers attach when a page surprises them —
// travel through storage into the Activity card instead. The dump is capped
// at the readers' own 1500-char slice; the popup shows it as the row's
// hover text.
async function setLastRedeemLog(detail, ok, dump) {
  await chrome.storage.local.set({
    lastRedeemLog: {
      detail,
      ok,
      dump: typeof dump === "string" ? dump : ""
    }
  });
}

// The stats read's own report row (2026-09-05, user request — the redeem
// row's pattern): the read runs in background tabs whose console nobody can
// open, so a page that surprised a reader surfaces here, with the ADR-010
// markup dump as the row's hover text.
async function setLastStatsLog(detail, ok, dump) {
  await chrome.storage.local.set({
    lastStatsLog: {
      detail,
      ok,
      dump: typeof dump === "string" ? dump : ""
    }
  });
}

// Same idea for the Rewards steps. Worth reporting rather than logging because
// Keep earning offers a different number of activities every day — the count is
// the only way to tell "there were three today" from "the finder missed them".
// The optional dump is the claim flow's evidence markup (ADR-010's contract,
// extended here 2026-09-05): the row's hover text in the popup, so a claim
// failure is diagnosable without devtools on the service worker.
async function setLastRewards(detail, ok, dump) {
  await chrome.storage.local.set({
    lastRewards: {
      detail,
      ok,
      dump: typeof dump === "string" ? dump : ""
    }
  });
}

// Removing every tab in a window closes the window too, so leave one behind.
// The window ids are handed in from closeTabs()'s own tabs.get pass —
// re-fetching every tab here would double the round trips for no new
// information.
async function keepWindowsAlive(closingIds, windowIds) {
  const closing = new Set(closingIds);

  for (const windowId of windowIds) {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.length && tabs.every(tab => closing.has(tab.id))) {
      // Only the user's own normal windows are worth keeping alive. A window
      // the extension itself created to host one read tab (the visibility
      // escalation's popup window, 2026-09-05) is allowed to close with its
      // tab — keeping it alive would leave a stray blank window behind, and
      // the keep-alive tab opens ACTIVE, stealing focus (the live report:
      // a new tab when the refresh ends, and the popup closing).
      try {
        const win = await chrome.windows.get(windowId);
        if (win.type !== "normal") continue;
      } catch (e) {
        continue; // the window is already going away
      }
      await chrome.tabs.create({ windowId });
    }
  }
}

async function closeTabs(ids, keepPinned) {
  const unique = [...new Set(ids.filter(id => typeof id === "number"))];
  const closable = [];
  const windowIds = new Set();

  for (const id of unique) {
    try {
      const tab = await chrome.tabs.get(id);
      // One round trip feeds both filters: pinned here, the window sweep
      // above.
      if (keepPinned && tab.pinned) continue;
      closable.push(id);
      windowIds.add(tab.windowId);
    } catch (e) {
      // The user already closed it.
    }
  }

  if (!closable.length) return 0;

  await keepWindowsAlive(closable, windowIds);
  try {
    await chrome.tabs.remove(closable);
  } catch (e) {
    console.warn("Closing tabs failed:", e);
    return 0;
  }

  return closable.length;
}

// Called when a feature finishes: stop capturing, then decide what happens to
// the tabs it opened.
//
//   perStep mode: close now iff the feature's own toggle says so (as always).
//   routine mode, routine running: stash them — one sweep at sequence end.
//   routine mode, manual run: close now iff closeTabsAfterManualRun.
async function closeCapturedTabs(stepId, enabledKey) {
  // Captured at entry so the re-check after the grace sleep below can tell a
  // real stop from anything else. On the normal per-step path the token never
  // moves, so this only ever skips after an actual stopAllActivity().
  const myToken = await currentActivityToken();
  const ids = await endTabCapture(stepId);
  const settings = await getSettings();
  if (!ids.length) return 0;

  if (settings.tabCloseMode === "routine") {
    const { [ROUTINE_ACTIVE]: routineActive } = await chrome.storage.local.get(
      ROUTINE_ACTIVE
    );
    if (routineActive) {
      await stashRoutineTabs(ids);
      return 0;
    }
    if (!settings.closeTabsAfterManualRun) return 0;
  } else if (!settings[enabledKey]) {
    return 0;
  }

  const graceMs = Math.max(0, Number(settings.tabCloseDelaySec) || 0) * 1000;

  // The grace period is there so Bing can credit the visit — and it is long
  // enough that the worker would otherwise be evicted mid-wait.
  holdKeepAlive();
  try {
    if (graceMs) await new Promise(resolve => setTimeout(resolve, graceMs));
    // A stop during the grace period must not close the tabs out from under
    // it: stopping is not finishing. The tabs stay open with the rest.
    if ((await currentActivityToken()) !== myToken) {
      console.log(
        `Tab close for "${stepId}" skipped: stopped during the grace period.`
      );
      return 0;
    }
    const closed = await closeTabs(ids, settings.keepPinnedTabs);
    if (closed) {
      console.log(`Closed ${closed} tab(s) opened by "${stepId}".`);
      await setLastTabAction(
        `Closed ${closed} tab(s) after the ${STEP_LABEL[stepId] || stepId}`,
        true
      );
    }
    return closed;
  } finally {
    releaseKeepAlive();
  }
}

// Read-modify-write behind the tab-write queue: steps finish concurrently with
// tabs.onCreated capture.
async function stashRoutineTabs(ids) {
  await serializeTabWrite(async () => {
    const store = await chrome.storage.local.get(ROUTINE_PENDING_TABS);
    const stashed = Array.isArray(store[ROUTINE_PENDING_TABS])
      ? store[ROUTINE_PENDING_TABS]
      : [];
    await chrome.storage.local.set({
      [ROUTINE_PENDING_TABS]: [...new Set(stashed.concat(ids))]
    });
  });
}

// The finish page's streak summary, built from the last stats read: which
// activities read as not-done, as "key:label;key:label" (the query the page
// parses). A display string's trailing progress pair is the verdict — the
// same parse the popup's Bing-app banner uses, so the page and the banner
// can never disagree about whether a streak is done. A null or unparseable
// value never enters the query: the page should say "every streak is
// complete" only when a read actually answered, not because a value went
// missing. Returns "" when every answered streak is done — a query-less page
// is the plain "The daily routine finished."
function routineSummaryQuery() {
  return chrome.storage.local.get(LAST_STATS).then(({ [LAST_STATS]: stats }) => {
    const activities = (stats && stats.activities) || {};
    const parts = [];
    for (const key of ["bingSearch", "dailySet", "bingApp", "visualSearch"]) {
      const value = activities[key];
      const match = String(value == null ? "" : value).match(/(\d+)\s*\/\s*(\d+)\s*$/);
      if (!match) continue; // not answered — no verdict to report
      const done = Number(match[1]) >= Number(match[2]) && Number(match[2]) > 0;
      if (!done) parts.push(`${key}:${value}`);
    }
    return parts.join(";");
  });
}

// The finish page's skip list, built from ROUTINE_SKIPPED: which steps the
// routine skipped as already done, as "id:reason;id:reason" (the ?s= query
// the page parses — the same compact shape the streak summary's ?q= uses).
// Reasons come from the routine's own verdicts, which carry no ";" or ":"; an
// entry that somehow does is dropped rather than mis-parsed.
function routineSkippedQuery(skipped) {
  return (Array.isArray(skipped) ? skipped : [])
    .filter(
      entry =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.reason === "string" &&
        entry.id &&
        entry.reason &&
        !entry.id.includes(":") &&
        !entry.reason.includes(":") &&
        !entry.reason.includes(";")
    )
    .map(entry => `${entry.id}:${entry.reason}`)
    .join(";");
}

// The end of a startup sequence. In routine mode this is the one moment the
// stashed tabs are all closed at once; a no-op when no routine ran, so callers
// don't need to care which mode they're in. A routine that genuinely finished
// also marks the day it started as done for the once-per-day gate.
async function endRoutine() {
  const store = await chrome.storage.local.get([
    ROUTINE_ACTIVE,
    ROUTINE_DAY,
    ROUTINE_PENDING_TABS,
    ROUTINE_SKIPPED
  ]);
  if (!store[ROUTINE_ACTIVE]) return;

  await chrome.storage.local.remove(ROUTINE_ACTIVE);

  // Only a live ROUTINE_ACTIVE flag gets this far, i.e. a routine truly
  // finished (inline end or post-search-batch tail — both land here). A
  // stopped routine never does: stopAllActivity() clears the flag directly,
  // so the no-op return above is what a stop sees, and the day stays unmarked.
  // The START day is what gets marked, not the finish day: a routine that
  // crosses midnight belongs to the day it began, or the new day would be
  // silently marked done without ever getting its routine.
  await chrome.storage.local.set({
    [LAST_ROUTINE_DAY]: store[ROUTINE_DAY] || localDayKey()
  });
  await chrome.storage.local.remove(ROUTINE_DAY);
  // The skip list is this finish page's to consume: cleared here so a later
  // page (the dev opener) can't re-report a consumed routine's skips.
  const skippedQuery = routineSkippedQuery(store[ROUTINE_SKIPPED]);
  await chrome.storage.local.remove(ROUTINE_SKIPPED);

  const ids = Array.isArray(store[ROUTINE_PENDING_TABS])
    ? store[ROUTINE_PENDING_TABS].filter(id => typeof id === "number")
    : [];
  await chrome.storage.local.remove(ROUTINE_PENDING_TABS);

  // The finish page (2026-09-04, the user's spec): after the sweep below the
  // user would be left staring at whatever the routine's tabs last showed —
  // so a summary tab opens instead, saying the routine is done and listing
  // the streaks they have to finish themselves (the Bing-app check-in, usually)
  // and the steps it skipped as already done (2026-09-05, the user's request).
  // Foreground and never auto-closed: the user is the only one who takes it
  // down, and the Clear-tabs action exempts its URL.
  try {
    const summary = await routineSummaryQuery();
    const params = new URLSearchParams();
    if (summary) params.set("q", summary);
    if (skippedQuery) params.set("s", skippedQuery);
    await chrome.tabs.create({
      url: `${ROUTINE_DONE_URL}${params.toString() ? `?${params.toString()}` : ""}`,
      active: true
    });
  } catch (e) {
    // The summary is a nicety, never a failure of the routine itself.
    console.warn("Routine: could not open the finish page:", e);
  }

  if (!ids.length) return;

  // Stop checkpoint for the sweep below. Captured here rather than at the
  // top: by this point the routine genuinely finished, so a stop that landed
  // earlier was already caught by the live-flag guard above.
  const myToken = await currentActivityToken();

  const settings = await getSettings();
  const graceMs = Math.max(0, Number(settings.tabCloseDelaySec) || 0) * 1000;

  // Same shape as closeCapturedTabs: credit the visits, keep the worker alive.
  holdKeepAlive();
  try {
    if (graceMs) await new Promise(resolve => setTimeout(resolve, graceMs));
    // A stop during the grace period must leave the stashed tabs open —
    // stopping is not finishing, exactly like the per-step close above.
    if ((await currentActivityToken()) !== myToken) {
      console.log("Routine tab sweep skipped: stopped during the grace period.");
      return;
    }
    const closed = await closeTabs(ids, settings.keepPinnedTabs);
    if (closed) {
      console.log(`Closed ${closed} tab(s) after the routine.`);
      await setLastTabAction(
        `Closed ${closed} tab(s) after the routine`,
        true
      );
    }
  } finally {
    releaseKeepAlive();
  }
}

// The finish page is exempt from Clear tabs (2026-09-04, the user's spec):
// it never closes automatically, so the sweep must skip it too. Matched on
// both pendingUrl and url — a still-loading tab only knows its pending URL,
// and a fresh extension page can sit in that state for a beat.
function isRoutineDoneTab(tab) {
  const urls = [tab.pendingUrl, tab.url].filter(Boolean);
  return urls.some(url => url.includes(ROUTINE_DONE_URL));
}

// Opens a fresh tab first, then closes everything else in that window, so the
// window never blinks out of existence.
async function clearAllTabs(windowId) {
  const settings = await getSettings();

  let targetWindow = windowId;
  if (targetWindow == null) {
    try {
      const focused = await chrome.windows.getLastFocused({
        windowTypes: ["normal"]
      });
      targetWindow = focused && focused.id;
    } catch (e) {
      console.warn("Clear tabs: could not resolve a window:", e);
    }
  }

  // An unset windowId makes tabs.query match every window — which would close
  // the user's other windows too. Refuse instead of guessing.
  if (targetWindow == null) {
    const error = "could not work out which window to clear";
    await setLastTabAction(`Clear failed — ${error}`, false);
    return { ok: false, error };
  }

  const existing = await chrome.tabs.query({ windowId: targetWindow });
  const fresh = await chrome.tabs.create({ windowId: targetWindow, active: true });

  const doomed = existing
    .filter(tab => tab.id !== fresh.id)
    .filter(tab => !isRoutineDoneTab(tab))
    .filter(tab => !(settings.keepPinnedTabs && tab.pinned))
    .map(tab => tab.id);

  const keptOut = existing.length - doomed.length;

  if (!doomed.length) {
    await setLastTabAction("Nothing to clear — opened a fresh tab", true);
    return { ok: true, closed: 0, kept: keptOut };
  }

  try {
    await chrome.tabs.remove(doomed);
  } catch (e) {
    console.warn("Clear tabs failed:", e);
    await setLastTabAction(`Clear failed — ${e}`, false);
    return { ok: false, error: String(e) };
  }

  // Those tabs are gone; a batch pointing at one of them has nothing to type in,
  // and the routine's stash would close tabs that no longer exist.
  await resetTabCapture();
  await chrome.storage.local.remove(ROUTINE_PENDING_TABS);
  const status = await getStatus();
  if (doomed.includes(status.tabId)) await setStatus({ tabId: null });

  const pinnedKept = keptOut - (existing.filter(isRoutineDoneTab).length);
  await setLastTabAction(
    `Cleared ${doomed.length} tab(s)${pinnedKept > 0 ? `, kept ${pinnedKept} pinned` : ""}`,
    true
  );
  return { ok: true, closed: doomed.length, kept: keptOut };
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);

  await chrome.storage.sync.set({
    settings: { ...DEFAULT_SETTINGS, ...(existing.settings || {}) }
  });
  // Older versions kept these in sync; move them out.
  await chrome.storage.sync.remove(["status", "lastQuery"]);
  // Superseded by the pendingStartupSteps queue.
  await chrome.storage.local.remove("pendingStartupImageSearch");
  await resetTabCapture();
  // A routine interrupted by an update must not sweep stale tab ids, or leak
  // its start day into the next one.
  await chrome.storage.local.remove([ROUTINE_ACTIVE, ROUTINE_DAY, ROUTINE_PENDING_TABS, ROUTINE_SKIPPED]);
  // Same for a verification loop interrupted mid-batch.
  await chrome.storage.local.remove(SEARCH_RIGHT_SIZE_RUN);

  const local = await chrome.storage.local.get(["lastQuery", "recentQueries"]);
  await chrome.storage.local.set({
    status: { ...IDLE_STATUS },
    lastQuery: local.lastQuery || existing.lastQuery || { api: null, text: null },
    recentQueries: local.recentQueries || []
  });
});

// Startup sequence: whatever order settings.startupOrder holds.
chrome.runtime.onStartup.addListener(async () => {
  await runStartupSequence();
});

// Tolerates a stale or hand-edited value: unknown ids and duplicates go, and
// anything missing is slotted into its default position. Mirrored in popup.js.
function normalizeStartupOrder(order) {
  const ids = Object.keys(STARTUP_STEPS);
  const known = Array.isArray(order) ? order.filter(id => ids.includes(id)) : [];
  const merged = [...new Set(known)];

  // A step added by an update is absent from every saved order. Putting it where
  // it belongs by default beats tacking it on the end, where it would run last
  // and be easy to miss.
  ids.forEach((id, defaultIndex) => {
    if (!merged.includes(id)) {
      merged.splice(Math.min(defaultIndex, merged.length), 0, id);
    }
  });

  return merged;
}

// The routine's cancel-before-start dialog. Resolves true when the routine may
// run ("Start now", the timeout, or no windows API to ask with) and false when
// the user cancelled. The wait lives inside the async onStartup handler,
// within the worker's 30s idle window — same pattern as the grace-period
// sleeps in closeCapturedTabs().
function confirmRoutineStart() {
  // Very old Chrome: no API to ask with, so the routine is never blocked on it.
  if (!(chrome.windows && chrome.windows.create)) {
    return Promise.resolve(true);
  }

  return new Promise(resolve => {
    let settled = false;

    const settle = proceed => {
      if (settled) return;
      settled = true;
      routineConfirmResolver = null;
      // Taking the dialog down fires onRemoved too; the nulled resolver above
      // is what makes that a no-op. The remove() itself can reject if the
      // window is already gone — fine either way.
      if (routineConfirmWindowId != null) {
        chrome.windows.remove(routineConfirmWindowId).catch(() => {});
        routineConfirmWindowId = null;
      }
      resolve(proceed);
    };

    // Handed to the answer message and the onRemoved listener below; nulled by
    // settle() after use, so a click arriving after the outcome is a no-op.
    routineConfirmResolver = settle;

    // The 15s window: silence means the user is away, and this is an
    // automator — proceed rather than dropping the routine on the floor.
    setTimeout(() => settle(true), ROUTINE_CONFIRM_TIMEOUT_MS);

    chrome.windows
      .create({
        url: "confirm.html",
        type: "popup",
        width: 420,
        height: 220,
        focused: true
      })
      .then(win => {
        // The prompt never went up — the routine must not hang waiting on an
        // answer nobody can give.
        if (!win) {
          console.warn("Startup: confirm dialog could not be shown.");
          settle(true);
          return;
        }
        routineConfirmWindowId = win.id;
      })
      .catch(e => {
        console.warn("Startup: confirm dialog could not be shown:", e);
        settle(true);
      });
  });
}

// The routine's opening reads, as one step: the Rewards stats (dashboard + Earn
// pages, merged) and the redeem watch. Grouped because the popup's Refresh
// button asks for the same two reads together, and neither throws — a page
// that won't load costs the sequence one console.warn, not the routine. As a
// step it can be turned off (statsStartupEnabled) and dragged around like any
// other; the default order keeps it first so the numbers still reflect the day
// before the steps churn the dashboard.
async function runStartupReads() {
  await refreshStats();
  await checkRedeemAvailability();
}

// ---------- Skip-when-done (2026-09-05, user request) ----------
//
// The routine skips a step whose own numbers say there is nothing left to
// do: no search batch at 60/60 search points, no claim at 0 pending, no
// daily set at 3/3, no image search at 1/1 visual search. Only the ROUTINE
// skips — a manual button press is deliberate and always runs. The Bing-app
// check-in has no entry: the extension cannot do it from a browser at all,
// so there is nothing to skip.
//
// The verdict comes from LAST_STATS stamped TODAY: every one of these values
// resets at midnight, so yesterday's "done" says nothing about today. A
// stale, missing or unreadable value never skips — the only wrong answer
// here is skipping something not actually done, so every unknown runs.

// The trailing "X/Y" pair of a stat value. Both stored shapes end with it
// ("3/3" from the old tiles, "Day 4 of 7 · 3/3" from the streak cards);
// returns [done, total] or null when the value carries no pair.
function progressPair(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

// A streak-shaped value that is complete ("3/3", "Day 4 of 7 · 1/1")
// returns the value itself (it becomes the reason's wording); null for
// anything partial, day-only or unreadable.
function streakDone(value) {
  const pair = progressPair(value);
  return pair && pair[0] >= pair[1] ? String(value).trim() : null;
}

const STEP_DONE_CHECKS = {
  // The web-search batch earns the daily search-points cap, read from the
  // Today's points breakdown ("60/60").
  search: stats => {
    const done = streakDone(stats.searchPoints);
    return done && `already ${done}`;
  },
  // "Ready to claim: 0" — the claim flow would only report "nothing to
  // claim", so the routine never opens the tab.
  claim: stats => {
    const raw =
      typeof stats.readyToClaim === "string"
        ? stats.readyToClaim.replace(/,/g, "").trim()
        : "";
    return /^\d+$/.test(raw) && Number(raw) === 0
      ? "nothing to claim (0 pending)"
      : null;
  },
  dailySet: stats => {
    const done = streakDone((stats.activities || {}).dailySet);
    return done && `already ${done}`;
  },
  // The image search earns the visual-search streak's one point.
  imageSearch: stats => {
    const done = streakDone((stats.activities || {}).visualSearch);
    return done && `already ${done}`;
  }
};

// The routine's skip verdict for a step: a reason string when today's read
// already shows it done, null when it should run.
async function routineStepSkipped(id) {
  const check = STEP_DONE_CHECKS[id];
  if (!check) return null;

  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  if (!stats || typeof stats.at !== "number") return null;
  if (localDayKey(new Date(stats.at)) !== localDayKey()) return null;

  return check(stats) || null;
}

// Points one web search earns on the account this automates (level 2:
// 3 points x 20 searches = the "60/60" cap the Today's-points card shows).
const POINTS_PER_SEARCH = 3;
// The verification loop's bounds (2026-09-05, user request: "after the batch
// is finished, it should check again how many points it reached because some
// searches do not count"): at most this many batches per loop, and a settle
// wait before the post-batch read — Bing credits a search within seconds,
// and reading immediately would misjudge the last one as not counted.
const RIGHT_SIZE_MAX_ROUNDS = 3;
const RIGHT_SIZE_SETTLE_MS = 10000;

// The batch the day actually needs (user request, 2026-09-05): with
// right-sizing on and today's read showing a partial search-points pair
// ("40/60"), only the remainder is searched — ceil(20 / 3) = 7 searches
// reach the cap; the configured batch would waste the rest. Returns
// { count, pair, trimmed } where pair is the [current, max] read (null when
// unreadable — verification can't judge what was never readable) and
// trimmed says whether the pair actually cut the count (the note only fires
// on a trim). Every unknown — the setting off, no read, a stale
// (yesterday's) read, no pair in the value, the cap already met — runs the
// full configured batch. The 60/60 case especially: the routine's
// skip-when-done keeps the routine from ever starting a batch there, and a
// MANUAL run must always do the thing it was pressed for.
async function rightSizedBatchCount(settings, perBatch) {
  const fallback = { count: perBatch, pair: null, trimmed: false };
  if (!settings || !settings.rightSizeSearchBatch) return fallback;

  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  if (!stats || typeof stats.at !== "number") return fallback;
  if (localDayKey(new Date(stats.at)) !== localDayKey()) return fallback;

  const pair = progressPair(stats.searchPoints);
  if (!pair) return fallback;

  const remaining = pair[1] - pair[0];
  if (remaining <= 0) return fallback;

  const needed = Math.ceil(remaining / POINTS_PER_SEARCH);
  if (needed >= perBatch) return { count: perBatch, pair, trimmed: false };

  return { count: needed, pair, trimmed: true };
}

// A skipped step says so in the Activity section, in its own row where it
// has one. The search step owns no row (its rows show the last query, which
// a skip must not fabricate), so its note lands in the Tabs row — the
// routine's news row, which already carries the end-of-routine sweep line.
async function reportSkippedStep(id, reason) {
  const labels = {
    search: "Search",
    claim: "Claim",
    dailySet: "Daily set",
    imageSearch: "Image search"
  };
  const detail = `${labels[id] || id} — skipped, ${reason}`;
  if (id === "claim" || id === "dailySet") {
    await setLastRewards(detail, null);
  } else if (id === "imageSearch") {
    await reportImageSearch(`skipped, ${reason}`, null);
  } else {
    await setLastTabAction(detail, null);
  }
  // The finish page names what was skipped (user request, 2026-09-05): the
  // record rides in storage because the post-search tail finishes in a later
  // worker instance, and endRoutine() consumes it when the page opens.
  const store = await chrome.storage.local.get(ROUTINE_SKIPPED);
  const skipped = Array.isArray(store[ROUTINE_SKIPPED]) ? store[ROUTINE_SKIPPED] : [];
  await chrome.storage.local.set({
    [ROUTINE_SKIPPED]: [...skipped, { id, reason }]
  });
}

async function runStartupSequence() {
  const settings = await getSettings();

  // A stop during an earlier step must also cancel the steps not started yet:
  // stopAllActivity() bumps this token, and a mismatch means "stopped".
  const myToken = await currentActivityToken();

  // A sequence interrupted by the last shutdown must not resume now that a
  // fresh one is starting, and tab ids from the last session are meaningless.
  // ROUTINE_DAY goes too: whatever it held belongs to the dead sequence.
  await chrome.storage.local.remove(PENDING_STARTUP_STEPS);
  await chrome.storage.local.remove([ROUTINE_ACTIVE, ROUTINE_DAY, ROUTINE_PENDING_TABS, ROUTINE_SKIPPED]);
  await resetTabCapture();

  if (!settings.startupEnabled) return;

  // Once per day: if the routine already completed today, don't redo it on a
  // second browser launch. The stale-key cleanup above has already run by
  // here, which is what we want either way — the skip is the whole routine.
  if (settings.startupOncePerDay) {
    const { [LAST_ROUTINE_DAY]: lastDay } = await chrome.storage.local.get(
      LAST_ROUTINE_DAY
    );
    if (lastDay === localDayKey()) {
      console.log("Startup: routine already ran today — skipping.");
      return;
    }
  }

  // Last gate: with "Ask before running" on, the user gets a 15s window to
  // cancel before a single tab opens. It sits after the once-per-day skip on
  // purpose — there is nothing to ask about when the routine would not run
  // anyway — and before ROUTINE_ACTIVE is set, so a cancel leaves nothing
  // routine-shaped behind.
  if (settings.confirmBeforeRoutine && !(await confirmRoutineStart())) {
    // Cancel: same shape as the once-per-day skip above — stale keys away,
    // status stays idle. lastRoutineDay is NOT written: today does not count
    // as done, so the next launch retries the routine.
    await chrome.storage.local.remove(PENDING_STARTUP_STEPS);
    await chrome.storage.local.remove([ROUTINE_ACTIVE, ROUTINE_DAY, ROUTINE_PENDING_TABS, ROUTINE_SKIPPED]);
    await resetTabCapture();
    console.log("Startup: routine cancelled at the confirm dialog.");
    return;
  }

  const queue = normalizeStartupOrder(settings.startupOrder).filter(
    id => settings[STARTUP_STEPS[id].enabledKey]
  );

  // Marks every step below as part of the routine, so in routine mode their
  // tabs are stashed for endRoutine() instead of closed per step. The start
  // day is captured here so endRoutine() can credit THAT day, even if the
  // sequence finishes after midnight in a later worker instance.
  await chrome.storage.local.set({
    [ROUTINE_ACTIVE]: true,
    [ROUTINE_DAY]: localDayKey()
  });

  // The stats read and the redeem watch are steps now (STARTUP_STEPS.stats →
  // runStartupReads): the queue runs them like any other step, so turning the
  // step off skips the reads, and a stop during a read is caught by the loop's
  // token checkpoint below plus the readers' own stop handling.

  // A fresh read before the steps (user request, 2026-09-05): the
  // skip-when-done verdicts below must judge the dashboard as it is NOW, not
  // as an older same-day read left it — a morning's "0 pending" must not skip
  // an evening claim that has points waiting. The stats step IS that read
  // when it leads the queue (the default order); when it is turned off or
  // moved later, the read runs here instead, so every verdict is made on
  // current numbers either way. No verdict-carrying step in the queue → no
  // extra read.
  if (queue[0] !== "stats" && queue.some(id => STEP_DONE_CHECKS[id])) {
    await refreshStats();
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];

    // Stop checkpoint: a bumped token means the remaining steps, this one
    // included, are cancelled.
    if ((await currentActivityToken()) !== myToken) break;

    // Skip-when-done (2026-09-05, user request): a step whose today's read
    // already shows complete never runs — no search batch at 60/60, no claim
    // at 0 pending. Checked before the search branch on purpose: a skipped
    // search means the rest of the sequence simply continues inline, with no
    // batch to hand the tail to.
    const skipReason = await routineStepSkipped(id);
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`);
      await reportSkippedStep(id, skipReason);
      continue;
    }

    // The batch runs for minutes after startSearchBatch() resolves, so the rest
    // of the sequence is handed to finishBatch() instead of racing it. The
    // routine stays active — endRoutine() is runPendingStartupSteps' business.
    if (id === "search") {
      const rest = queue.slice(i + 1);
      try {
        if (rest.length) {
          await chrome.storage.local.set({ [PENDING_STARTUP_STEPS]: rest });
        }
        await startSearchBatch();
        return;
      } catch (e) {
        console.warn("Startup: web search batch failed to start:", e);
        await chrome.storage.local.remove(PENDING_STARTUP_STEPS);
        continue; // nothing to wait for; keep going inline
      }
    }

    try {
      await STARTUP_STEPS[id].run();
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e);
    }
  }

  // The sequence ran to its end inline — no search batch to wait for. A no-op
  // after a stop: stopAllActivity() cleared ROUTINE_ACTIVE, so the stashed
  // tabs are never swept.
  await endRoutine();
}

// The tail of the startup sequence, once the web search batch has finished.
async function runPendingStartupSteps() {
  const stored = await chrome.storage.local.get(PENDING_STARTUP_STEPS);
  const queue = Array.isArray(stored[PENDING_STARTUP_STEPS])
    ? stored[PENDING_STARTUP_STEPS]
    : [];
  // Also reached when the batch was the last step: the queue is empty but the
  // routine flag is still up, and the stashed tabs still need their sweep.
  if (!queue.length) {
    await endRoutine();
    return;
  }

  // Same stop checkpoint as the main sequence. Captured BEFORE the queue is
  // claimed below: a stop landing between the claim and the capture would
  // bump the token into myToken, and the whole tail would then run after the
  // stop it was supposed to see.
  const myToken = await currentActivityToken();

  // Claim the queue before running it: a step that starts another batch must
  // not be able to trigger this a second time.
  await chrome.storage.local.remove(PENDING_STARTUP_STEPS);

  // The tail re-reads before judging the claim (user request, 2026-09-05):
  // the search batch just spent minutes earning points, and "ready to claim"
  // is the one verdict-carrying number those searches can move — an answer
  // captured before the batch must not skip a claim the batch itself earned.
  // The other verdicts (daily set, visual search) are untouched by web
  // searches, and a stats step leading this tail queue is itself the read.
  if (queue.includes("claim") && queue[0] !== "stats") {
    await refreshStats();
  }

  for (const id of queue) {
    if ((await currentActivityToken()) !== myToken) break;

    const step = STARTUP_STEPS[id];
    if (!step || id === "search") continue;

    // Same skip-when-done verdict as the main loop — the post-search tail
    // holds steps too, and a fresh claim/daily-set/image-search answer in
    // today's read skips them here exactly as it would have inline.
    const skipReason = await routineStepSkipped(id);
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`);
      await reportSkippedStep(id, skipReason);
      continue;
    }

    try {
      await step.run();
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e);
    }
  }

  // A no-op after a stop: stopAllActivity() cleared ROUTINE_ACTIVE, so the
  // stashed tabs stay open with everything else.
  await endRoutine();
}

// Revive an interrupted batch (also fires on the normal schedule).
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SEARCH_ALARM) tick();
});

// The routine's confirm dialog closing without an answer. The buttons resolve
// through handleMessage() below; this is the other way the prompt can end,
// and the awaiting confirmRoutineStart() is a separate function, so the
// outcome crosses through the module-level resolver above. Guarded like the
// prompt itself — a Chrome without the windows API must still run.
if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener(windowId => {
    if (windowId !== routineConfirmWindowId || !routineConfirmResolver) return;
    // Dismissing the dialog is an explicit gesture, so closing the window
    // counts as Cancel — only the 15s timeout (user away) proceeds on its
    // own.
    routineConfirmResolver(false);
  });
}

// Messages from popup: manual controls
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(e => {
      console.error("Message handling failed:", e);
      sendResponse({ ok: false, error: String(e) });
    });

  return true; // keep the response channel open for the async reply
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "START_SEARCH_BATCH":
      await startSearchBatch();
      return { ok: true };
    case "RUN_DAILY_SET":
      // Long-running; don't hold the popup's callback open for it.
      openDailySetOnRewardsDashboard();
      return { ok: true };
    case "RUN_KEEP_EARNING":
      openKeepEarningActivities();
      return { ok: true };
    case "RUN_CLAIM":
      // Long-running; don't hold the popup's callback open for it.
      runManualClaim();
      return { ok: true };
    case "REFRESH_STATS":
      // Same reasoning as the daily set: worst case the read waits out a slow
      // dashboard for ~30s, longer than the popup's response channel should
      // be held open. The popup learns the outcome from lastStats instead.
      refreshStats();
      return { ok: true };
    case "REFRESH_REDEEM":
      // Same fire-and-forget reasoning as REFRESH_STATS above: the watch can
      // wait out a slow redeem page for well over the popup's patience. The
      // popup learns the outcome from lastRedeem instead.
      checkRedeemAvailability();
      return { ok: true };
    case "REDEEM_OVERWATCH":
      // The popup's Redeem button: a user-initiated spend, so unlike the
      // watch above this is NOT background — the tab opens foreground where
      // the user watches their own transaction. Fire-and-forget like the
      // other manual runs: the outcome is the page the user is looking at.
      redeemOverwatchCoins(message.url, message.label);
      return { ok: true };
    case "CLAIM_COUPONS":
      // Experimental (Settings → Experimental features): the popup's
      // Coupons button. Foreground for the same reason as the redeem button
      // — the coupon panel is the user's own to watch — and fire-and-forget
      // the same way: the outcome is the page the user is looking at.
      claimCoupons();
      return { ok: true };
    case "STOP_BATCH":
      await stopAllActivity();
      return { ok: true };
    case "OPEN_ROUTINE_DONE":
      // Developer Option only (2026-09-04): the popup's routine-done opener —
      // same page, same summary, as the genuine endRoutine call, so the
      // preview is the real thing. The extra dev=1 flag turns on the page's
      // own preview bar (one button per render condition); endRoutine never
      // sets it, so a real finish still opens the honest page. Fire-and-
      // forget: the outcome is the page itself.
      try {
        const summary = await routineSummaryQuery();
        // Whatever skip list is still stored joins the preview (a finished
        // routine's list was consumed by its own endRoutine — usually empty
        // here, and honest when it isn't).
        const { [ROUTINE_SKIPPED]: skipped } = await chrome.storage.local.get(
          ROUTINE_SKIPPED
        );
        const params = new URLSearchParams({ dev: "1" });
        if (summary) params.set("q", summary);
        const skippedQuery = routineSkippedQuery(skipped);
        if (skippedQuery) params.set("s", skippedQuery);
        await chrome.tabs.create({
          url: `${ROUTINE_DONE_URL}?${params.toString()}`,
          active: true
        });
      } catch (e) {
        console.warn("Could not open the routine-done page:", e);
      }
      return { ok: true };
    case "RESET_ROUTINE_DAY":
      // Developer Option only (2026-09-05, user request): the popup's dev
      // button — clears the once-per-day done-mark, so the next browser
      // launch runs the startup routine again, as if it had never run today.
      // Only the done-mark goes: the keys of a routine running right now are
      // not this button's business (and that routine's own endRoutine will
      // re-mark its day when it finishes — it did run).
      await chrome.storage.local.remove(LAST_ROUTINE_DAY);
      await setLastTabAction("Dev — routine will run on the next browser start", true);
      return { ok: true };
    case "RUN_IMAGE_SEARCH":
      runRandomImageSearch();
      return { ok: true };
    case "CLEAR_ALL_TABS":
      return await clearAllTabs(message.windowId);
    case "routineConfirmAnswer":
      // The routine's confirm dialog reporting its buttons. A stale message
      // after the prompt settled finds a nulled resolver and is a no-op.
      if (routineConfirmResolver) routineConfirmResolver(message.proceed === true);
      return { ok: true };
    default:
      return { ok: false, error: "unknown message type" };
  }
}

// ---------- Batch scheduling ----------

function cancelSchedule() {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  chrome.alarms.clear(SEARCH_ALARM);
  stopKeepAlive();
}

// ---------- Activity lifecycle ----------
//
// Manual runners mark themselves as the current activity so the popup's Stop
// button covers them too. A running search batch owns the status (tick()
// depends on status.running), so a concurrent manual activity must neither
// clobber it on the way in nor clear it on the way out.

async function beginActivity(label) {
  const status = await getStatus();
  if (!status.running) {
    await setStatus({ running: true, label, remaining: 0, nextRunAt: null });
  }
  return currentActivityToken();
}

async function endActivity(label) {
  const status = await getStatus();
  // Strict label match: a null label means a search batch owns the status, and
  // clearing it on a manual run's way out would kill the batch's tick().
  if (status.running && status.label === label) {
    await setStatus({ running: false, label: null, remaining: 0, nextRunAt: null });
  }
}

// Stop whatever is currently running: the search batch, a manual run, or the
// startup routine.
async function stopAllActivity() {
  // Bump the token first so every runner, whatever it is mid-way through,
  // abandons at its next checkpoint.
  const token = await currentActivityToken();
  await chrome.storage.local.set({ [ACTIVITY_TOKEN]: token + 1 });
  cancelSchedule();
  // Stopping cancels the rest of the startup sequence with it, and with it the
  // routine's tab sweep: the tabs stay open with the rest. The start day goes
  // too — stopping is not finishing, so the next launch retries the routine.
  await chrome.storage.local.remove(PENDING_STARTUP_STEPS);
  await chrome.storage.local.remove([ROUTINE_ACTIVE, ROUTINE_DAY, ROUTINE_PENDING_TABS, ROUTINE_SKIPPED]);
  // A stopped batch is not a finished one, but its verification loop must not
  // survive the stop either — a later batch starts a loop of its own.
  await chrome.storage.local.remove(SEARCH_RIGHT_SIZE_RUN);
  // Stopping is not finishing: the user asked for a halt, so leave the tabs
  // open rather than closing them out from under them. Clearing all capture
  // bookkeeping (not just the search step's) also makes any runner's late
  // closeCapturedTabs() a no-op.
  await resetTabCapture();
  await setStatus({ running: false, label: null, remaining: 0, nextRunAt: null });
}

// Start a new batch of web searches
async function startSearchBatch() {
  cancelSchedule(); // a second Start must not leave two loops running

  // Stop checkpoint, covering both callers: a stop landing between the
  // routine's own checkpoint (or the popup's click) and the setStatus below
  // would otherwise resurrect a batch the user just stopped. The token is
  // stable across the setup awaits unless a stop actually happened.
  const myToken = await currentActivityToken();

  const settings = await getSettings();
  const previous = await getStatus();
  const perBatch = Math.max(1, Math.floor(settings.searchesPerBatch) || 1);

  // Right-sizing (2026-09-05): a FRESH read first — the user's spec is
  // "check how many points there are before it starts the batch", not "trust
  // whatever the last read happened to leave". Rounds 2+ of the verification
  // loop skip it: the read that started them is seconds old (freshAt).
  const runStore = await chrome.storage.local.get(SEARCH_RIGHT_SIZE_RUN);
  const priorRun = runStore[SEARCH_RIGHT_SIZE_RUN];
  const continuingRun =
    priorRun &&
    Number.isFinite(priorRun.freshAt) &&
    Date.now() - priorRun.freshAt < 120000
      ? priorRun
      : null;

  let sized = { count: perBatch, pair: null, trimmed: false };
  if (settings.rightSizeSearchBatch) {
    if (!continuingRun) {
      await refreshStats();
      // A stop during the read must not go on to open a batch.
      if ((await currentActivityToken()) !== myToken) {
        console.log("Search batch: stopped during the pre-batch read.");
        return;
      }
    }
    sized = await rightSizedBatchCount(settings, perBatch);
  }

  // The loop's state: written whenever the batch started from a readable
  // partial pair (trimmed or not — "some searches do not count" needs
  // verifying either way), cleared when sizing is off or the read couldn't
  // produce a pair.
  if (settings.rightSizeSearchBatch && sized.pair) {
    await chrome.storage.local.set({
      [SEARCH_RIGHT_SIZE_RUN]: {
        round: continuingRun ? continuingRun.round : 1,
        pair: sized.pair
      }
    });
  } else {
    await chrome.storage.local.remove(SEARCH_RIGHT_SIZE_RUN);
  }

  const { count: batchCount, pair, trimmed } = sized;
  if (trimmed) {
    // The search step owns no Activity row, so its news rides the Tabs row —
    // the same row its skip note lands in.
    await setLastTabAction(
      `Search — right-sized to ${batchCount} of ${perBatch} searches (${pair[0]}/${pair[1]} points)`,
      null
    );
  }

  await beginTabCapture("search");
  const tabId = await ensureBingTab(previous.tabId);
  await claimTab("search", tabId);

  if ((await currentActivityToken()) !== myToken) {
    // Stopped during the setup awaits. Release the capture but leave the tabs
    // open — stopping is not finishing — and never mark the batch running.
    await endTabCapture("search");
    console.log("Search batch: stopped while starting; no searches will run.");
    return;
  }

  await setStatus({
    running: true,
    label: null, // the batch owns the status; a null label is what marks that
    remaining: batchCount,
    tabId,
    nextRunAt: Date.now(),
    runId: (previous.runId || 0) + 1
  });

  startKeepAlive();
  tick(); // deliberately not awaited: the batch outlives this call
}

// Reuse the previous batch's tab if it is still open, so repeated batches
// don't pile up tabs.
async function ensureBingTab(existingTabId) {
  if (existingTabId != null) {
    try {
      const tab = await chrome.tabs.get(existingTabId);
      // Only reclaim it if it's still a Bing tab — the user may have navigated
      // it somewhere else since the last batch.
      if (tab && String(tab.url || "").startsWith("https://www.bing.com/")) {
        await chrome.tabs.update(existingTabId, { url: "https://www.bing.com/" });
        return existingTabId;
      }
    } catch (e) {
      // Tab is gone; fall through and make a new one.
    }
  }

  const tab = await chrome.tabs.create({ url: "https://www.bing.com/" });
  return tab.id;
}

function schedule(delayMs) {
  const wait = Math.max(0, delayMs);

  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    tick();
  }, wait);

  // Alarms can't fire sooner than 30s, so this is a backstop for an evicted
  // worker rather than the primary schedule. tick() waits out any remainder.
  chrome.alarms.create(SEARCH_ALARM, {
    delayInMinutes: Math.max(0.5, (wait + WATCHDOG_PAD_MS) / 60000)
  });
}

function startKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    // Any extension API call resets the worker's idle timer.
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, KEEPALIVE_MS);
}

function stopKeepAlive() {
  // cancelSchedule() drops the keep-alive whenever a batch ends, which would
  // also cut short the tab-closing grace period running alongside it.
  if (keepAliveHolds > 0) return;

  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// Counted, because holds overlap: the tail of a batch can be closing its tabs
// while the next startup step is already running.
function holdKeepAlive() {
  keepAliveHolds++;
  startKeepAlive();
}

function releaseKeepAlive() {
  keepAliveHolds = Math.max(0, keepAliveHolds - 1);
  if (keepAliveHolds === 0) stopKeepAlive();
}

// A batch that was stopped or superseded must not keep running.
async function isStale(runId) {
  const status = await getStatus();
  return !status.running || status.runId !== runId;
}

// The post-batch half of right-sizing: re-read the points the batch actually
// reached and, if the cap is still short but the points MOVED, start another
// right-sized batch (some searches not counting is exactly the case the
// pre-batch arithmetic can't see). Returns "continue" when it started one —
// the caller must then not run the normal batch-end path, because that
// batch's own finishBatch owns it now.
//
// The loop ends at the cap, at no movement between reads (the searches have
// stopped counting — more of them cannot fix that), or at
// RIGHT_SIZE_MAX_ROUNDS; every ending clears SEARCH_RIGHT_SIZE_RUN so a
// later batch starts a loop of its own.
async function settleRightSizedRun() {
  const settings = await getSettings();
  if (!settings.rightSizeSearchBatch) return "done";

  const store = await chrome.storage.local.get(SEARCH_RIGHT_SIZE_RUN);
  const run = store[SEARCH_RIGHT_SIZE_RUN];
  if (!run || !Array.isArray(run.pair)) return "done";

  const myToken = await currentActivityToken();

  await new Promise(resolve => setTimeout(resolve, RIGHT_SIZE_SETTLE_MS));
  if ((await currentActivityToken()) !== myToken) return "stopped";

  await refreshStats();
  if ((await currentActivityToken()) !== myToken) return "stopped";

  const { [LAST_STATS]: stats } = await chrome.storage.local.get(LAST_STATS);
  const nowPair = stats ? progressPair(stats.searchPoints) : null;
  await chrome.storage.local.remove(SEARCH_RIGHT_SIZE_RUN);

  if (!nowPair) return "done"; // unreadable now — nothing left to judge

  if (nowPair[0] >= nowPair[1]) {
    await setLastTabAction(
      `Search — ${nowPair[0]}/${nowPair[1]} points, the cap is reached`,
      true
    );
    return "done";
  }

  if (run.round >= RIGHT_SIZE_MAX_ROUNDS) {
    await setLastTabAction(
      `Search — stopped at ${nowPair[0]}/${nowPair[1]} points after ${run.round} batches`,
      null
    );
    return "done";
  }

  if (nowPair[0] <= run.pair[0]) {
    // Not one point since this loop's batch started: the searches are not
    // counting (app-only credit, a rate change, the dashboard's own lag), and
    // another batch would only repeat that.
    await setLastTabAction(
      `Search — searches stopped counting at ${nowPair[0]}/${nowPair[1]} points`,
      false
    );
    return "done";
  }

  // Short of the cap, but the points moved: run what's still needed. The
  // round-1 tabs are dealt with exactly as any finished search step's are
  // (perStep closes them; routine mode stashes them for the end sweep), and
  // freshAt tells startSearchBatch its read is seconds old.
  const more = Math.ceil((nowPair[1] - nowPair[0]) / POINTS_PER_SEARCH);
  await setLastTabAction(
    `Search — ${nowPair[0]}/${nowPair[1]} points after the batch, ${more} more ${more === 1 ? "search" : "searches"}`,
    null
  );
  await closeCapturedTabs("search", "closeTabsAfterSearch");
  await chrome.storage.local.set({
    [SEARCH_RIGHT_SIZE_RUN]: {
      round: run.round + 1,
      pair: nowPair,
      freshAt: Date.now()
    }
  });
  await startSearchBatch();
  return "continue";
}

async function finishBatch() {
  cancelSchedule();

  // cancelSchedule() just dropped the keep-alive, and the verification below
  // (a settle wait plus a dashboard read) runs long enough that the worker
  // could be evicted mid-flight — the loop would die with the batch's status
  // still "running".
  holdKeepAlive();
  try {
    // The verification loop (2026-09-05): a right-sized batch re-reads what
    // it reached and may start another. On "continue" this finishBatch is
    // done — the new batch's own finishBatch runs the normal end path.
    const verdict = await settleRightSizedRun().catch(e => {
      console.warn("Search verification failed:", e);
      return "done";
    });
    if (verdict === "continue") return;

    // label: null keeps the "the batch owns the status" marker consistent.
    await setStatus({ running: false, label: null, remaining: 0, nextRunAt: null });

    // The remaining startup steps run long enough that the worker could be
    // evicted mid-flight.
    await closeCapturedTabs("search", "closeTabsAfterSearch");
    await runPendingStartupSteps();
  } finally {
    releaseKeepAlive();
  }
}

async function tick() {
  // Re-entrancy guard: skip a tick that arrives while one is still running
  // (see tickInFlight above). Safe to skip — the in-flight tick's own tail
  // calls schedule(), so the batch is never left without a next beat.
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const status = await getStatus();

    if (!status.running) {
      cancelSchedule();
      return;
    }

    if (status.remaining <= 0) {
      await finishBatch();
      return;
    }

    // The watchdog alarm may arrive before the intended moment.
    const remainingWait = (status.nextRunAt || 0) - Date.now();
    if (remainingWait > 500) {
      startKeepAlive();
      schedule(remainingWait);
      return;
    }

    const runId = status.runId;
    startKeepAlive();

    let tabId = status.tabId;
    try {
      await chrome.tabs.get(tabId);
    } catch (e) {
      const tab = await chrome.tabs.create({ url: "https://www.bing.com/" });
      tabId = tab.id;
      await claimTab("search", tabId);
      await setStatus({ tabId });
    }

    // The previous search navigated this tab; the box isn't there until it loads.
    await waitForTabComplete(tabId);
    if (await isStale(runId)) return;

    const { query, api } = await nextQuery();
    await chrome.storage.local.set({ lastQuery: { api, text: query } });

    let busyMs = 0;
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: performHumanTypedSearchOnBing,
        args: [query]
      });
      busyMs = Number(injection && injection.result) || 0;
    } catch (e) {
      console.warn("Search injection failed:", e);
    }

    if (await isStale(runId)) return;

    const current = await getStatus();
    const remaining = Math.max(0, current.remaining - 1);

    if (remaining <= 0) {
      await finishBatch();
      return;
    }

    const settings = await getSettings();
    const delay = busyMs + randomDelayMillis(settings.minDelaySec, settings.maxDelaySec);

    await setStatus({ remaining, nextRunAt: Date.now() + delay });
    schedule(delay);
  } finally {
    tickInFlight = false;
  }
}

// ---------- Random image visual search ----------

function bytesToBase64(uint8) {
  let binary = "";
  // 4 KB chunks: String.fromCharCode.apply with tens of thousands of arguments
  // overflows the call stack on larger images.
  const chunkSize = 4096;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadImage(url, timeoutMs = 8000) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  if (!blob.size) throw new Error("empty response body");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mimeType: blob.type || "image/jpeg"
  };
}

async function fetchPicsumImage() {
  return downloadImage(`https://picsum.photos/600/400.jpg?random=${Date.now()}`);
}

async function fetchCatImage() {
  const res = await fetchWithTimeout(
    "https://api.thecatapi.com/v1/images/search?size=small&mime_types=jpg,png",
    8000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const url = String((Array.isArray(data) && data[0] && data[0].url) || "");

  // The API hands back a CDN URL; make sure it's still on their domain before
  // we fetch it.
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error("unexpected payload");
  }
  if (parsed.protocol !== "https:" || !/(^|\.)thecatapi\.com$/i.test(parsed.hostname)) {
    throw new Error(`unexpected image host: ${parsed.hostname}`);
  }

  return downloadImage(url);
}

// Last resort: draw a landscape locally. No network, no host permission,
// always works, so a dead image host can never block the visual search.
async function generateLocalImage() {
  const width = 600;
  const height = 400;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const horizon = height * (0.55 + Math.random() * 0.15);
  const skyHue = 190 + Math.random() * 40;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${skyHue}, 65%, ${35 + Math.random() * 20}%)`);
  sky.addColorStop(1, `hsl(${skyHue + 30}, 70%, 78%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  // Sun
  ctx.fillStyle = `hsla(${40 + Math.random() * 20}, 95%, 70%, 0.9)`;
  ctx.beginPath();
  ctx.arc(
    width * (0.15 + Math.random() * 0.7),
    horizon * (0.2 + Math.random() * 0.5),
    18 + Math.random() * 22,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Mountain ranges, far to near
  const ranges = 3;
  for (let r = 0; r < ranges; r++) {
    const depth = (r + 1) / ranges;
    ctx.fillStyle = `hsl(${skyHue - 10 + r * 12}, ${25 + r * 12}%, ${52 - r * 14}%)`;
    ctx.beginPath();
    ctx.moveTo(0, horizon);

    const peaks = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p <= peaks; p++) {
      ctx.lineTo((width / peaks) * p, horizon - (40 + Math.random() * 90) * depth);
    }

    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();
  }

  const groundHue = 95 + Math.random() * 30;
  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, `hsl(${groundHue}, 35%, 30%)`);
  ground.addColorStop(1, `hsl(${groundHue}, 40%, 16%)`);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, height - horizon);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mimeType: blob.type || "image/jpeg"
  };
}

const IMAGE_SOURCES = [
  { name: "picsum.photos (photos)", get: fetchPicsumImage },
  { name: "thecatapi.com (cats)", get: fetchCatImage },
  { name: "locally drawn landscape", get: generateLocalImage }
];

// Returns { base64, mimeType, source } or { error } naming every source that
// failed and why, so the popup can say more than "could not fetch".
async function fetchRandomImageData() {
  const failures = [];

  for (const source of IMAGE_SOURCES) {
    try {
      const data = await source.get();
      if (data && data.base64) return { ...data, source: source.name };
      failures.push(`${source.name}: no data`);
    } catch (e) {
      const reason = (e && e.message) || String(e);
      console.warn(`Image source ${source.name} failed:`, e);
      failures.push(`${source.name}: ${reason}`);
    }
  }

  return { error: failures.join("; ") };
}

// Open a new Bing tab, click the visual-search (camera) icon, then hand the
// upload dialog a random image.
//
// Bing renders that dialog inside an iframe, so the file input does not exist
// in the top frame. Phase 1 clicks the icon in the top frame; phase 2 probes
// every frame until one of them exposes an upload target, then hands the
// image to that frame alone.
const VISUAL_SEARCH_ATTEMPTS = 24;
const VISUAL_SEARCH_INTERVAL_MS = 500;

async function runRandomImageSearch() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity("Image search");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  try {
    await reportImageSearch("fetching a random image");

    const imgData = await fetchRandomImageData();
    if (!imgData.base64) {
      await reportImageSearch(`failed - every image source failed (${imgData.error})`, false);
      return;
    }

    // Stop checkpoint before any tab work: nothing has been opened yet, so
    // stopping here leaves nothing behind at all.
    if (await stopped()) {
      await reportImageSearch("stopped", false);
      return;
    }

    await reportImageSearch(`got image from ${imgData.source}, opening Bing`);

    await beginTabCapture("imageSearch");
    try {
      await attachImageOnBing(imgData, stopped);
    } finally {
      await closeCapturedTabs("imageSearch", "closeTabsAfterImageSearch");
    }
  } finally {
    await endActivity("Image search");
  }
}

// The caller passes its stopped() helper so a mid-poll stop is honored here.
async function attachImageOnBing(imgData, stopped) {
  const bingTab = await chrome.tabs.create({ url: "https://www.bing.com/" });
  await claimTab("imageSearch", bingTab.id);

  const loaded = await waitForTabComplete(bingTab.id);
  if (!loaded) console.warn("Image search: tab did not finish loading in time.");

  // Phase 1: press the camera icon in the top frame.
  let clicked = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: bingTab.id, frameIds: [0] },
      func: clickVisualSearchButton
    });
    clicked = injection && injection.result;
  } catch (e) {
    console.warn("Image search: camera click injection failed:", e);
  }

  if (!clicked || !clicked.ok) {
    const why = (clicked && clicked.detail) || "injection failed";
    await reportImageSearch(`failed - camera icon not found (${why})`, false);
    return;
  }

  await reportImageSearch(`clicked camera (${clicked.detail}), waiting for dialog`);

  // Phase 2: wait for the dialog and give it the image. Two-phase on purpose:
  // the base64 image is tens of KB, and marshalling it into every frame on
  // every attempt is pure waste — a cheap argless probe finds the frame
  // first, and only that frame ever receives the payload.
  for (let attempt = 1; attempt <= VISUAL_SEARCH_ATTEMPTS; attempt++) {
    // Stop checkpoint: attempt 1 follows the pre-capture check in the caller
    // closely enough, but the poll itself can run for ~12s — without this, a
    // stopped run would keep injecting until a frame accepts the image.
    if (attempt > 1 && (await stopped())) {
      await reportImageSearch("stopped", false);
      return;
    }

    // Hold the drag-drop and paste routes back until the end: neither can be
    // verified, so guessing early would stop us before the iframe appears.
    const allowFallbacks = attempt > VISUAL_SEARCH_ATTEMPTS - 4;

    let probes = [];
    try {
      probes = await chrome.scripting.executeScript({
        target: { tabId: bingTab.id, allFrames: true },
        func: probeVisualSearchTarget,
        args: [allowFallbacks]
      });
    } catch (e) {
      console.warn("Image search: probe injection failed:", e);
      break;
    }

    // A real file input beats an unverifiable fallback in another frame, so
    // prefer a frame that reported one; execution results carry their
    // frameId, which is what targets the payload injection below.
    const candidate =
      probes.find(r => r && r.result && r.result.hasFileInput) ||
      probes.find(r => r && r.result && r.result.candidate);

    if (candidate) {
      let results = [];
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId: bingTab.id, frameIds: [candidate.frameId] },
          func: attachRandomImageToVisualSearch,
          args: [imgData.base64, imgData.mimeType, allowFallbacks]
        });
      } catch (e) {
        console.warn("Image search: attach injection failed:", e);
        break;
      }

      const wins = results
        .filter(r => r && r.result && r.result.ok)
        .map(r => r.result);
      // A real file input beats an unverifiable fallback.
      const win = wins.find(w => w.detail.includes("file input")) || wins[0];

      if (win) {
        await reportImageSearch(`image handed to Bing via ${win.detail}`, true);
        return;
      }
    }

    await new Promise(resolve => setTimeout(resolve, VISUAL_SEARCH_INTERVAL_MS));
  }

  await reportImageSearch("failed - no frame exposed a file input", false);
}

// Mirrored into the popup so a silent failure is diagnosable.
async function reportImageSearch(detail, ok = null) {
  console.log("Image search:", detail);
  await chrome.storage.local.set({
    lastImageSearch: { detail, ok, at: new Date().toISOString() }
  });
}

// Runs in the top frame of https://www.bing.com/ — finds and presses the
// camera icon that opens Bing's "search using an image" dialog.
function clickVisualSearchButton() {
  // Bing's markup varies by page and A/B experiment, so try stable ids first.
  const SELECTORS = [
    "#sbsbi",                  // camera on the Bing homepage
    "#sb_sbi",                 // camera in the results-page search box
    "#sbi_b",
    ".sbihpicn[role='button']",
    ".sbicampl",
    "[aria-label*='search using an image' i]",
    "[aria-label*='search by image' i]",
    "[aria-label*='visual search' i]",
    "[title*='search using an image' i]",
    "[title*='visual search' i]"
  ];

  // Whole phrases only. A bare "image" would match the Images nav link and
  // navigate the tab away instead of opening the dialog.
  const LABEL_PHRASES = [
    "search using an image",
    "search by image",
    "search with an image",
    "visual search",
    "باستخدام صورة" // ar: "using an image"
  ];

  // Clicking a <label> bound to a file input opens the OS file picker, which
  // an extension cannot drive — that would hang the whole flow.
  function opensOsPicker(el) {
    if (!el) return true;
    if (el.tagName === "LABEL") return true;
    if (typeof el.querySelector === "function" && el.querySelector('input[type="file"]')) {
      return true;
    }
    const forId = el.getAttribute && el.getAttribute("for");
    if (forId) {
      const bound = document.getElementById(forId);
      if (bound && bound.type === "file") return true;
    }
    return false;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function findButton() {
    for (const selector of SELECTORS) {
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        continue; // selector syntax unsupported here
      }

      const usable = matches.filter(el => !opensOsPicker(el));
      const hit = usable.find(isVisible) || usable[0];
      if (hit) return { el: hit, detail: selector };
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "button, a, div[role='button'], span[role='button']"
      )
    );

    for (const el of candidates) {
      const label = (
        el.getAttribute("aria-label") ||
        el.title ||
        el.innerText ||
        ""
      ).toLowerCase();

      if (LABEL_PHRASES.some(phrase => label.includes(phrase)) && !opensOsPicker(el)) {
        return { el, detail: `label "${label.trim().slice(0, 40)}"` };
      }
    }

    return null;
  }

  const found = findButton();
  if (!found) return { ok: false, detail: "no camera icon in the top frame" };

  found.el.scrollIntoView({ block: "center" });
  // Exactly one click: some Bing handlers toggle the dialog, so a synthetic
  // pointerdown followed by a click would open and immediately close it.
  found.el.click();

  return { ok: true, detail: found.detail };
}

// Runs in EVERY frame of the Bing tab, but carries no payload: it only
// reports whether this frame holds something attachRandomImageToVisualSearch
// below could use, so the worker can marshal the base64 image into the one
// frame that answered yes instead of into all of them on every attempt.
function probeVisualSearchTarget(allowFallbacks) {
  const byId = ["sb_fileinput", "sbfileinput", "sbi_file", "vs_fileinput"]
    .map(id => document.getElementById(id))
    .filter(el => el && el.type === "file");

  const all = Array.from(document.querySelectorAll('input[type="file"]'));
  const ordered = byId.concat(all.filter(el => !byId.includes(el)));
  const fileInput =
    ordered.find(el => !el.accept || /image/i.test(el.accept)) || ordered[0];

  if (fileInput) return { candidate: true, hasFileInput: true };
  if (!allowFallbacks) return { candidate: false, hasFileInput: false };

  // With fallbacks allowed every frame is a candidate: the paste route below
  // needs only a text field, or failing that the body — exactly the frames
  // the attach function would have tried anyway.
  return { candidate: true, hasFileInput: false };
}

// Runs in the ONE frame the probe flagged as holding the upload dialog.
function attachRandomImageToVisualSearch(imageBase64, mimeType, allowFallbacks) {
  function frameNote() {
    return window.top === window
      ? "top frame"
      : `iframe ${location.host}${location.pathname}`;
  }

  function makeFile() {
    const binary = atob(imageBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType || "image/jpeg" });
    return new File([blob], "random-image.jpg", { type: blob.type });
  }

  function transferWith(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    return dt;
  }

  const byId = ["sb_fileinput", "sbfileinput", "sbi_file", "vs_fileinput"]
    .map(id => document.getElementById(id))
    .filter(el => el && el.type === "file");

  const all = Array.from(document.querySelectorAll('input[type="file"]'));
  const ordered = byId.concat(all.filter(el => !byId.includes(el)));
  const target =
    ordered.find(el => !el.accept || /image/i.test(el.accept)) || ordered[0];

  if (target) {
    try {
      target.files = transferWith(makeFile()).files;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        ok: true,
        detail: `file input${target.id ? " #" + target.id : ""} in ${frameNote()}`
      };
    } catch (e) {
      return { ok: false, detail: `file input rejected the image: ${e}` };
    }
  }

  if (!allowFallbacks) {
    return { ok: false, detail: `no file input in ${frameNote()}` };
  }

  // The dialog also takes a dragged or pasted image. Neither route reports
  // back, so these are last-resort attempts and flagged unverified.
  const dropTarget =
    document.querySelector(
      "[data-drop-target], .vs_dropzone, #sb_vsdrop, [class*='dropzone' i], [class*='drop-zone' i]"
    ) ||
    Array.from(document.querySelectorAll("div, section, form")).find(el => {
      // The children count is the cheap test, so it gates the text read; and
      // textContent rather than innerText — innerText forces a layout per
      // element, which this scan must not do in the user's tab.
      if (el.children.length >= 30) return false;
      const text = (el.textContent || "").toLowerCase();
      return text.includes("drag") && text.includes("drop");
    });

  if (dropTarget) {
    const dt = transferWith(makeFile());
    for (const type of ["dragenter", "dragover", "drop"]) {
      dropTarget.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
    }
    return { ok: true, detail: `drop target in ${frameNote()} (unverified)` };
  }

  try {
    const pasteTarget =
      document.querySelector("input[type='text'], textarea") || document.body;
    pasteTarget.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transferWith(makeFile()),
        bubbles: true,
        cancelable: true
      })
    );
    return { ok: true, detail: `paste into ${frameNote()} (unverified)` };
  } catch (e) {
    return {
      ok: false,
      detail: `no file input, drop target, or paste route in ${frameNote()}`
    };
  }
}

// ---------- Daily set / Rewards dashboard ----------

// Both Rewards entry points serve the same app, but which section renders on
// which has moved around — so each section carries its own order of URLs to try
// rather than the whole feature betting on one.
const REWARDS_DASHBOARD = "https://rewards.bing.com/dashboard";
const REWARDS_EARN = "https://rewards.bing.com/earn";
// The catalog page the Overwatch-coins watch reads. The page's own search box
// narrows it down to the digital-code cards; without one, the whole catalog is
// scanned for matching titles instead.
const REDEEM_URL = "https://rewards.bing.com/redeem";
// What the watch searches for. Phrased product-first on purpose:
// readRedeemOptions matches cards on the query's first word, which has to
// survive translation verbatim ("Overwatch" does; "digital code" would
// false-positive on every gift card in the catalog).
const REDEEM_QUERY = "overwatch coins digital code";

// How long the page-side claim routine waits for the panel's verdict after
// clicking the claim card before reporting "unknown" — the click may still
// have gone through, so an honest "don't know" beats a false "failed".
const CLAIM_TIMEOUT_MS = 15000;
// How long the page-side stats reader waits for the React app to hydrate
// before reporting whatever it could find. The cards render first, the
// activity tiles slightly later, so the poll outlives "complete" alone.
const STATS_HYDRATION_MS = 12000;
// How long each injected half of the redeem watch waits: the search box and
// the result cards both render after "complete", and a search-triggered
// navigation adds a full page load on top of the hydration wait.
const REDEEM_HYDRATION_MS = 12000;
// The coupon count rides on a dashboard tab the stats reader has already
// waited out (STATS_HYDRATION_MS above), so its own poll only needs to
// cover the trigger's late render — not a full hydration.
const COUPON_READ_MS = 5000;

// The two Rewards sections differ only in what they are called, how many tiles
// they hold and where they are most likely to be found, so they share one runner
// and one injected finder.
const REWARDS_SECTIONS = {
  dailySet: {
    label: "Daily set",
    // Matched case-insensitively against the headings on the page.
    names: ["daily set", "daily sets"],
    maxKey: "dailySetMaxTiles",
    closeKey: "closeTabsAfterDailySet",
    urls: [REWARDS_DASHBOARD, REWARDS_EARN]
  },
  keepEarning: {
    label: "Keep earning",
    names: ["keep earning", "more activities", "more ways to earn"],
    maxKey: "keepEarningMaxTiles",
    closeKey: "closeTabsAfterKeepEarning",
    urls: [REWARDS_EARN, REWARDS_DASHBOARD],
    // 2026-09-05: tiles that are completed or "reward up only" are skipped
    // outright instead of the conservative blind-click the daily set keeps —
    // see openRewardsSectionTiles.
    skipSpent: true
  }
};

function openDailySetOnRewardsDashboard() {
  return runRewardsSection("dailySet");
}

function openKeepEarningActivities() {
  return runRewardsSection("keepEarning");
}

async function runRewardsSection(stepId) {
  const section = REWARDS_SECTIONS[stepId];
  const settings = await getSettings();

  // 0, blank or unreadable means "open however many are there" — which is the
  // point for Keep earning, where the number of activities changes daily.
  const configured = Math.floor(Number(settings[section.maxKey]));
  const maxTiles = Number.isFinite(configured) && configured > 0 ? configured : 0;

  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity(section.label);
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  // From here until closeCapturedTabs() below, every new tab is attributed to
  // this step — which is how the tabs the tiles open get cleaned up too.
  await beginTabCapture(stepId);

  try {
    const rewardsTab = await chrome.tabs.create({
      url: section.urls[0],
      pinned: false
    });
    await claimTab(stepId, rewardsTab.id);

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open, the injection never runs, and the stopped report
    // below replaces the normal one.
    let halted = false;
    if (await stopped()) {
      await setLastRewards(`${section.label} — stopped`, false);
      halted = true;
    }

    // -1 means the page stopped being readable, which a tile click can cause by
    // navigating it away mid-script. That counts as done, not as "nothing here".
    let opened = -1;

    for (let i = 0; i < section.urls.length; i++) {
      if (!halted && (await stopped())) {
        await setLastRewards(`${section.label} — stopped`, false);
        halted = true;
      }
      if (halted) break;

      if (i > 0) {
        console.log(
          `${section.label}: nothing on the last page, trying ${section.urls[i]}.`
        );
        try {
          await chrome.tabs.update(rewardsTab.id, { url: section.urls[i] });
        } catch (e) {
          console.warn(`${section.label}: could not navigate to the fallback:`, e);
          break;
        }
      }

      const loaded = await waitForTabComplete(rewardsTab.id);
      if (!loaded) {
        console.warn(`${section.label}: page did not finish loading in time.`);
      }

      // Stop checkpoint after the load wait: the injection (and its tile
      // clicks) is the part a stop is meant to prevent.
      if (await stopped()) {
        await setLastRewards(`${section.label} — stopped`, false);
        halted = true;
        break;
      }

      opened = -1;
      try {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: rewardsTab.id },
          func: openRewardsSectionTiles,
          args: [section.names, maxTiles, section.label, section.skipSpent === true]
        });
        const value = injection && injection.result;
        opened = typeof value === "number" ? value : -1;
      } catch (e) {
        console.warn(`${section.label} injection ended early:`, e);
      }

      // Only a definite zero means "this section is not on this page".
      if (opened !== 0) break;
    }

    // The stopped report replaces the normal one, and a stopped run does not
    // sit out the post-click grace sleep.
    if (!halted) {
      await reportRewardsRun(section.label, opened);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } finally {
    // A no-op after a stop: stopAllActivity() cleared the capture bookkeeping,
    // so the tabs stay open.
    await closeCapturedTabs(stepId, section.closeKey);
    await endActivity(section.label);
  }
}

async function reportRewardsRun(label, opened) {
  if (opened > 0) {
    const noun = opened === 1 ? "activity" : "activities";
    await setLastRewards(`${label} — opened ${opened} ${noun}`, true);
  } else if (opened === 0) {
    await setLastRewards(`${label} — no activities found`, false);
  } else {
    // Tiles were clicked; the page moved on before they could be counted.
    await setLastRewards(`${label} — ran, count unavailable`, null);
  }
}

// ---------- Claim pending dashboard points ----------

// Maps a claimDashboardPoints result to the Activity line. Every outcome —
// including a missing one (the page never answered) — has a line here, so no
// caller needs to try/catch around a report. The result's dump (and, for a
// result that never came back, the injected error text) travels with the line
// as the row's hover text: all errors belong in the Activity section, not in
// a service worker console the user cannot open.
async function reportClaimResult(result, fallbackDump) {
  const outcome = result && result.outcome;
  const dump =
    (result && typeof result.dump === "string" && result.dump) ||
    (typeof fallbackDump === "string" && fallbackDump) ||
    "";

  if (outcome === "claimed") {
    const points = result.points;
    await setLastRewards(
      points != null
        ? `Claim — ${points} points claimed`
        : "Claim — points claimed",
      true
    );
  } else if (outcome === "nothing") {
    await setLastRewards("Claim — nothing to claim", null);
  } else if (outcome === "unknown") {
    // The click may still have gone through; report honestly rather than
    // guessing either way.
    await setLastRewards(
      "Claim — still processing when we stopped watching",
      false,
      dump
    );
  } else {
    const reason = (result && result.reason) || "did not report back";
    await setLastRewards(`Claim — ${reason}`, false, dump);
  }
}

// Worker side of a claim: inject the page routine and report what came back.
// Never throws — executeScript failures and missing results are outcomes too.
async function runClaimFlow(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: claimDashboardPoints,
      args: [CLAIM_TIMEOUT_MS]
    });
    await reportClaimResult(injection && injection.result);
  } catch (e) {
    console.warn("Claim injection ended early:", e);
    // The injection error is the only evidence this branch has — it becomes
    // the row's dump instead of dying in the console.
    await reportClaimResult(null, String((e && e.message) || e));
  }
}

// A manual claim from the popup: open the dashboard, press the claim card,
// report, then close the tab it opened. closeTabsAfterClaim governs the
// startup step below, not this — a manual claim closes its own tab because
// the tab was opened for this one purpose (approved design, tasks/current.md
// Task 4). The one exception is a stop: stopping is not finishing, so a
// stopped run leaves the tab open like every other runner.
async function runManualClaim() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity("Claim");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  try {
    await beginTabCapture("claim");

    const rewardsTab = await chrome.tabs.create({
      url: REWARDS_DASHBOARD,
      pinned: false
    });
    await claimTab("claim", rewardsTab.id);

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open and the injection never runs.
    if (await stopped()) {
      await setLastRewards("Claim — stopped", false);
      return;
    }

    const loaded = await waitForTabComplete(rewardsTab.id);
    if (!loaded) console.warn("Claim: page did not finish loading in time.");

    if (await stopped()) {
      await setLastRewards("Claim — stopped", false);
      return;
    }

    await runClaimFlow(rewardsTab.id);
  } finally {
    // Not closeCapturedTabs(): that helper branches on the tab-close mode and
    // a per-step setting, neither of which applies here. endTabCapture()
    // hands back the ids directly instead; a stopped run leaves them open
    // (stopAllActivity() already wiped the bookkeeping, so this is doubly a
    // no-op after a stop).
    const ids = await endTabCapture("claim");

    if (ids.length && !(await stopped())) {
      const settings = await getSettings();

      // Same shape as closeCapturedTabs()'s tail: the settle wait is long
      // enough that the worker would otherwise be evicted mid-close.
      holdKeepAlive();
      try {
        // Let the panel's success state settle before the tab goes away.
        await new Promise(resolve => setTimeout(resolve, 2000));
        // A stop that lands during the settle must not close the tab out
        // from under it: stopping is not finishing. The else is an else (not
        // a return) so endActivity() below still runs.
        if (await stopped()) {
          console.log("Claim: stopped during the settle wait; tab left open.");
        } else {
          const closed = await closeTabs(ids, settings.keepPinnedTabs);
          if (closed) console.log(`Closed ${closed} tab(s) opened by "claim".`);
        }
      } finally {
        releaseKeepAlive();
      }
    }

    await endActivity("Claim");
  }
}

// The claim step of the startup sequence. Same flow as the manual claim above,
// but as a startup step its tab is NOT closed here: closeCapturedTabs() below
// defers to the tab-close mode and the closeTabsAfterClaim toggle, exactly like
// every other step — that is the manual run's "always close" behavior above
// diverging from the step's, on purpose.
async function runStartupClaim() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity("Claim");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  try {
    await beginTabCapture("claim");

    const rewardsTab = await chrome.tabs.create({
      url: REWARDS_DASHBOARD,
      pinned: false
    });
    await claimTab("claim", rewardsTab.id);

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open and the injection never runs.
    if (await stopped()) {
      await setLastRewards("Claim — stopped", false);
      return;
    }

    const loaded = await waitForTabComplete(rewardsTab.id);
    if (!loaded) console.warn("Claim: page did not finish loading in time.");

    // Stop checkpoint after the load wait: the injection is the part a stop is
    // meant to prevent.
    if (await stopped()) {
      await setLastRewards("Claim — stopped", false);
      return;
    }

    await runClaimFlow(rewardsTab.id);
  } finally {
    // A no-op after a stop: stopAllActivity() cleared the capture bookkeeping,
    // so the tab stays open.
    await closeCapturedTabs("claim", "closeTabsAfterClaim");
    await endActivity("Claim");
  }
}

// ---------- Rewards stats ----------

// Reads the Rewards stats into LAST_STATS: the four top cards plus today's
// progress on four activity streaks. The 2026-09 redesign split the values
// across pages (the user confirmed 2026-09-03: the dashboard keeps the top
// cards and the stamp bonus card, the streak cards live only on the Earn
// page), so this reads BOTH pages and merges them (mergeStats above) — the
// dashboard with waitMode "cards", the Earn page with "streaks", each
// returning as soon as its own half hydrates.
//
// Runs as the first action of the startup routine and on demand from the
// popup's Refresh button. Never throws — a stats read is a convenience, not a
// routine step that can fail the sequence, so a page that won't load costs
// one console.warn and leaves the last stats untouched.
//
// The tab handling follows the manual claim above, not closeCapturedTabs():
// there is no per-step close toggle for a read (nothing is being earned, so
// there is nothing to give a grace period to), and the tabs were opened for
// this one read. The one exception is the same too — a stopped run leaves
// them open, because stopping is not finishing.
async function refreshStats() {
  if (READ_RUN_GUARDS.stats) {
    console.log("Stats: a read is already running; skipping.");
    return;
  }
  READ_RUN_GUARDS.stats = true;

  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity("Stats");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  // The tabs this run opened (closed in the finally). Same reasoning as the
  // redeem watch's own-tab tail: the shared capture list is reset by every
  // new run, so two overlapping bursts used to sweep each other's tabs.
  const ownTabIds = [];

  // One page of the two-page read. Returns { tabId, stats } — stats may be
  // null when the page never answered — or null outright when the run was
  // stopped (the merge and the dump both treat that as "no page").
  async function readPage(url, waitMode, label) {
    // Background tab: a read is never meant to be seen (the tab closes when
    // the read finishes), and an active tab would steal focus — which closes
    // an open popup mid-refresh (user report 2026-09-03, the day the popup
    // started auto-refreshing on open).
    const tab = await chrome.tabs.create({ url, pinned: false, active: false });
    ownTabIds.push(tab.id);

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open and the injection never runs.
    if (await stopped()) {
      console.log(`Stats: stopped while opening the ${label} tab.`);
      return null;
    }

    const loaded = await waitForTabComplete(tab.id, 15000);
    if (!loaded) console.warn(`Stats: ${label} page did not finish loading in time.`);

    // Stop checkpoint after the load wait: the injection is the part a stop is
    // meant to prevent.
    if (await stopped()) {
      console.log(`Stats: stopped before the ${label} reader could run.`);
      return null;
    }

    // The visibility escalation (live 2026-09-05, the "presses=9
    // everExpanded=false visibility=hidden" dump): nine real-mouse presses on
    // the Today's points tile in a 12 s read and the flyout never opened —
    // a hidden tab never gets a render pass, and whatever the live page's
    // modal path needs (its own rAF, an animation to start, a visibility
    // check), it does not happen in a tab the browser will not draw. While
    // the read runs, this watcher probes the read's own press log
    // (window.__meowPointsPress, updated every poll); once several presses
    // have been made and the card still shows no sign of opening, the tab is
    // moved into a small unfocused popup window — focused:false, so the
    // user's focus (and an open popup) is not stolen — which makes the
    // document visible without reloading it. The read keeps running; the
    // next 1 s-throttled press lands in a tab that renders, and the read
    // still closes the tab in its own sweep. If even a visible tab never
    // opens the flyout, the dump proves it (pressVisibility=visible,
    // everExpanded=false) — that would be an untrusted-event guard, and a
    // different fix (trusted input via chrome.debugger) would need the
    // user's sign-off on a new permission.
    let escalation = null;
    const watcher = setInterval(async () => {
      try {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const log = window.__meowPointsPress;
            return log
              ? {
                  presses: log.presses,
                  everExpanded: !!log.everExpanded,
                  visibility: document.visibilityState
                }
              : null;
          }
        });
        const seen = probe && probe.result;
        if (
          seen &&
          seen.presses >= 3 &&
          !seen.everExpanded &&
          seen.visibility === "hidden"
        ) {
          clearInterval(watcher);
          escalation = chrome.windows
            .create({ tabId: tab.id, type: "popup", focused: false })
            .catch(e =>
              console.warn(`Stats: could not show the ${label} tab:`, e)
            );
        }
      } catch (e) {
        // The tab closed mid-read (the sweep, a stop) — nothing to escalate.
        clearInterval(watcher);
      }
    }, 2000);

    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readRewardsStats,
        args: [STATS_HYDRATION_MS, waitMode]
      });
      return { tabId: tab.id, stats: (injection && injection.result) || null };
    } catch (e) {
      console.warn(`Stats: ${label} injection ended early:`, e);
      return { tabId: tab.id, stats: null };
    } finally {
      clearInterval(watcher);
      await escalation;
    }
  }

  // The dump contract, same as the claim and redeem readers: when the Earn
  // page answers none of the four streaks, warn the markup the reader was
  // staring at — the live page drifts under a passing suite, and this is the
  // only channel that shows what it actually looked like. The tab is still
  // open at this point; it closes in the finally below. The evidence is
  // also RETURNED — the Activity row (setLastStatsLog) carries it as hover
  // text, so it reaches the user without devtools.
  async function dumpEarnEvidence(tabId) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const section =
            document.getElementById("streaks") ||
            document.querySelector(".react-aria-DisclosurePanel") ||
            document.body;
          return {
            url: location.href,
            streaksMarkup: section.outerHTML.slice(0, 1500)
          };
        }
      });
      if (injection && injection.result) {
        console.warn(
          "Stats: the Earn page answered no streaks. Markup (report to dev):",
          injection.result
        );
      }
      return injection && injection.result;
    } catch (e) {
      console.warn("Stats: could not dump the Earn page markup:", e);
      return null;
    }
  }

  // The search-points breakdown refinement loop: the reader's shape-based
  // matcher was written without a capture of the expanded panel, so a miss
  // (merged.searchPoints == null) dumps the Today's points card — expanded
  // by the read's own click — from every read tab that still carries one.
  // The next matcher revision gets written against that markup.
  async function dumpPointsEvidence(tabId) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const labels = Array.from(
            document.querySelectorAll("p.text-labelControl")
          );
          const label = labels.find(el =>
            /^today.?s points$/i.test(
              (el.textContent || "").replace(/\s+/g, " ").trim()
            )
          );
          const card = label ? label.closest("a, button") : null;
          if (!card) return null;
          const controlled = card.getAttribute("aria-controls");
          const panel = controlled ? document.getElementById(controlled) : null;
          // The read's own press record (window.__meowPointsPress, set by the
          // read's poll) plus the tab's visibility — the two facts that split
          // "the press never registered" from "the flyout opened and closed
          // again" from "hidden tab" on the next live miss.
          const press =
            typeof window.__meowPointsPress !== "undefined"
              ? window.__meowPointsPress
              : null;
          return {
            url: location.href,
            expanded: card.getAttribute("aria-expanded"),
            visibility: document.visibilityState,
            presses: press ? press.presses : 0,
            everExpanded: press ? !!press.everExpanded : false,
            everControlled: press ? !!press.everControlled : false,
            pressVisibility: press ? press.visibility || "" : "",
            cardMarkup: card.outerHTML.slice(0, 2000),
            panelMarkup: panel ? panel.outerHTML.slice(0, 2000) : null
          };
        }
      });
      if (injection && injection.result) {
        console.warn(
          "Stats: the search-points breakdown did not answer. Markup (report to dev):",
          injection.result
        );
      }
      return injection && injection.result;
    } catch (e) {
      // A tab that already closed (the read's own sweep, a stop) is not a
      // refinement lead worth a warning of its own.
      console.warn("Stats: could not dump the points card markup:", e);
      return null;
    }
  }

  try {
    // Both pages at once (2026-09-05, the user's "the refresh is too slow"
    // report): the reads are independent — separate tabs, separate
    // injections, each returning as soon as its own half hydrates — so the
    // refresh costs the SLOWER page's time, not the sum of both. The streak
    // cards are Earn-only (2026-09 redesign), so the Earn read is what
    // answers the four activity stats; the merge and every guard below are
    // unchanged (a stopped or failed read is null either way).
    const [dashboardRead, earnRead] = await Promise.all([
      readPage(REWARDS_DASHBOARD, "cards", "dashboard"),
      readPage(REWARDS_EARN, "streaks", "Earn")
    ]);
    if (
      (dashboardRead === null || earnRead === null) &&
      (await stopped())
    ) {
      return;
    }

    const dashboardStats = dashboardRead && dashboardRead.stats;
    const earnStats = earnRead && earnRead.stats;

    // The coupon trigger ("Coupon (N)") lives on this same dashboard tab,
    // so the count rides along before the tab closes. A null answer (markup
    // the reader didn't recognize) is not an error — the last good count in
    // LAST_COUPONS stays, and the reader dumps what it saw to console.warn.
    if (dashboardRead) {
      try {
        const [couponInjection] = await chrome.scripting.executeScript({
          target: { tabId: dashboardRead.tabId },
          func: readCouponCount,
          args: [COUPON_READ_MS]
        });
        const couponCount = couponInjection && couponInjection.result;
        if (typeof couponCount === "number") {
          await chrome.storage.local.set({
            [LAST_COUPONS]: { at: Date.now(), available: couponCount }
          });
        }
      } catch (e) {
        console.warn("Stats: the coupon count read ended early:", e);
      }
    }

    // The Activity row's evidence (2026-09-05, user request — the redeem
    // row's pattern): every miss reports WHY, not just that, and carries the
    // markup its reader stared at (the ADR-010 dump contract) as the row's
    // hover text.
    const problems = [];
    const dumps = [];
    if (dashboardStats == null) problems.push("the dashboard page did not answer");
    if (earnStats == null) problems.push("the Earn page did not answer");

    if (
      earnRead &&
      Object.values((earnStats && earnStats.activities) || {}).every(
        v => v == null
      )
    ) {
      const evidence = await dumpEarnEvidence(earnRead.tabId);
      if (evidence) dumps.push(evidence.streaksMarkup || "");
      // Only when the page answered at all — a null read already reported
      // itself above as "did not answer".
      if (earnStats) problems.push("the Earn page answered no streaks");
    }

    const merged = mergeStats(dashboardStats, earnStats);

    // The breakdown refinement loop (dumpPointsEvidence above): only when
    // neither page's panel answered, and only on tabs still alive — the
    // dump returns null on a page without the card. The PROBLEM is only
    // named when a page actually answered — two pages that never answered
    // already said so, and nothing could have read the breakdown anyway.
    if (merged != null && merged.searchPoints == null) {
      for (const read of [dashboardRead, earnRead]) {
        if (!read) continue;
        const evidence = await dumpPointsEvidence(read.tabId);
        if (evidence) {
          dumps.push(
            "expanded=" + evidence.expanded + " " +
              "visibility=" + evidence.visibility + " " +
              "presses=" + (evidence.presses || 0) + " " +
              "everExpanded=" + !!evidence.everExpanded + " " +
              "everControlled=" + !!evidence.everControlled + " " +
              (evidence.pressVisibility
                ? "pressVisibility=" + evidence.pressVisibility + " "
                : "") +
              (evidence.panelMarkup || evidence.cardMarkup || "")
          );
        }
      }
      if (dashboardStats != null || earnStats != null) {
        problems.push("the search-points breakdown did not answer");
      }
    }

    // An all-null merge is two pages that never answered, not a Rewards
    // account with nothing to show — store nothing rather than overwriting
    // the last good stats with empties and a fresh timestamp.
    const found =
      merged != null &&
      (merged.availablePoints != null ||
        merged.readyToClaim != null ||
        merged.dailyStreak != null ||
        merged.stampBonus != null ||
        merged.searchPoints != null ||
        Object.values(merged.activities || {}).some(v => v != null));

    if (found) {
      await chrome.storage.local.set({ [LAST_STATS]: { ...merged, at: Date.now() } });
      console.log("Stats: read the dashboard and the Earn page.");
    } else {
      console.warn("Stats: the readers found nothing; keeping the last stats.");
    }

    // The row itself — but stopping is not failing: a stopped run reports
    // nothing (the user cancelled it; there is no outcome to log).
    if (!(await stopped())) {
      await setLastStatsLog(
        problems.length
          ? "Stats — " + problems.join("; ") + "."
          : found
            ? "Stats — read the dashboard and the Earn page."
            : "Stats — the readers found nothing; kept the last stats.",
        problems.length === 0 && found,
        dumps.join("\n")
      );
    }
  } finally {
    // Closes only the tabs THIS run opened (same reasoning as the redeem
    // watch's tail: the shared per-step list cannot be trusted across
    // overlapping runs). A stopped run leaves them open — stopping is not
    // finishing.
    if (ownTabIds.length && !(await stopped())) {
      const settings = await getSettings();
      const closed = await closeTabs(ownTabIds, settings.keepPinnedTabs);
      if (closed) console.log(`Closed ${closed} tab(s) opened by "stats".`);
    }

    await endActivity("Stats");
    READ_RUN_GUARDS.stats = false;
  }
}

// ---------- Redeem availability watch ----------

// Reads which Overwatch-coins digital codes the Rewards catalog currently
// offers into LAST_REDEEM: opens /redeem, drives the page's own search box
// with REDEEM_QUERY, then reads the matching catalog cards' title, price and
// stock state. On demand from the popup's Refresh button, and as the second
// half of the routine's stats step (runStartupReads).
//
// Availability is a heuristic for now: the unauthenticated page carries no
// stock markup at all (a card is a plain anchor), so the reader marks a card
// sold out only on explicit disabled/out-of-stock markers and dumps any card
// it cannot classify to console.warn — the first real logged-in run reveals
// the actual stock markup so the heuristic can be refined.
//
// Runs as the second half of the routine's stats step (runStartupReads) and on
// demand from the popup's Refresh button. Never throws — same reasoning as
// refreshStats(): a convenience read, not a step that can fail the sequence,
// so a redeem page that won't cooperate costs one console.warn and
// leaves the last read untouched.
//
// The injection is three-phase because the search and the tile-click are both
// navigations, which would kill an in-page wait: phase 1 searches and resolves
// as soon as the query is submitted (performHumanTypedSearchOnBing resolves
// early for the same reason), the load wait between the phases absorbs the
// navigation, and phase 2 reads whatever the tab ended up showing. Phase 3
// then navigates the same tab to the first matching card's sku page — the
// user's "press that tile" — and reads the variant select there
// (readRedeemVariants), storing the list as `variants` alongside the catalog
// `options` in LAST_REDEEM. Both halves keep their last good read when the
// new one comes back empty.
//
// Tab handling: the run closes only the tab it opened itself, and refuses to
// start while another redeem read is in flight (see the in-flight guards
// above). Nothing is being earned, so there is nothing to give a grace
// period to, and a stopped run leaves the tab open — stopping is not
// finishing.
// In-flight guards for the two read runners. A burst (Refresh button,
// popup-open refresh, the routine's stats step) fires REFRESH_STATS and
// REFRESH_REDEEM together, and nothing stops a SECOND burst from starting
// while the first still reads — the popup's pending guard covers one popup
// session only. Two overlapping runs used to sweep each other's read tabs
// through the shared capture lists (beginTabCapture resets the step's list,
// so the first run's tail popped and closed the second run's tab mid-read —
// live report 2026-09-03: "The catalog read failed early: No tab with id"),
// so each runner now refuses to double up and closes only the tab(s) it
// opened itself. One mutable object (not two `let`s) so the extracted-source
// test harnesses can inject and observe the flags.
const READ_RUN_GUARDS = { redeem: false, stats: false };

async function checkRedeemAvailability() {
  if (READ_RUN_GUARDS.redeem) {
    console.log("Redeem watch: a read is already running; skipping.");
    return;
  }
  READ_RUN_GUARDS.redeem = true;

  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned token tells this run when it has been stopped.
  const myToken = await beginActivity("Redeem watch");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  // The only tab this run owns (closed in the finally). Kept in a variable
  // the finally can see even if the create throws.
  let redeemTabId = null;

  try {
    // Background tab, same reasoning as refreshStats' readPage: the redeem
    // read must not steal focus from an open popup.
    const redeemTab = await chrome.tabs.create({
      url: REDEEM_URL,
      pinned: false,
      active: false
    });
    redeemTabId = redeemTab.id;

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open and the injections never run.
    if (await stopped()) {
      console.log("Redeem watch: stopped while opening the redeem tab.");
      return;
    }

    const loaded = await waitForTabComplete(redeemTab.id, 15000);
    if (!loaded) console.warn("Redeem watch: page did not finish loading in time.");

    // Stop checkpoint after the load wait: the injections are the part a stop
    // is meant to prevent.
    if (await stopped()) {
      console.log("Redeem watch: stopped before the search could run.");
      return;
    }

    // Phase 1 — search. Resolves false when the page shows no search box,
    // which is fine: the reader then scans the catalog page as-is. A rejection
    // means the page navigated mid-script (the search trigger does a full
    // navigation), which the load wait below absorbs the same way.
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: redeemTab.id },
        func: searchRedeemFor,
        args: [REDEEM_QUERY, REDEEM_HYDRATION_MS]
      });
      if (!(injection && injection.result === true)) {
        console.log("Redeem watch: no search box on the page; reading the catalog as-is.");
      }
    } catch (e) {
      console.warn("Redeem search injection ended early:", e);
    }

    if (await stopped()) {
      console.log("Redeem watch: stopped before the reader could run.");
      return;
    }

    // Let a search-triggered navigation start before waiting it out; a
    // same-document re-render just costs this settle.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const resultsLoaded = await waitForTabComplete(redeemTab.id, 15000);
    if (!resultsLoaded) {
      console.warn("Redeem watch: results page did not finish loading in time.");
    }

    // Stop checkpoint after the results load: the reader is the part a stop is
    // meant to prevent.
    if (await stopped()) {
      console.log("Redeem watch: stopped before the reader could run.");
      return;
    }

    // Phase 2 — read. The result outlives its try block: phase 3 needs it to
    // know which card to visit. The reader resolves { list, dump } — the dump
    // is the ADR-010 markup slice it stared at when the list came back empty.
    let options = null;
    let optionsDump = "";
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: redeemTab.id },
        func: readRedeemOptions,
        args: [REDEEM_QUERY, REDEEM_HYDRATION_MS]
      });
      const read = injection && injection.result;
      options = read && read.list;
      optionsDump = (read && read.dump) || "";

      // An empty list means the page never showed a matching card — more
      // likely a page problem than a delisted catalog, so keep the last good
      // read rather than storing a fresh nothing (same reasoning as the
      // all-null stats case in refreshStats). The variants and detail-page
      // URL from the previous read ride along for the same reason: phase 3
      // replaces them only when it actually reads a new list.
      if (Array.isArray(options) && options.length) {
        const stored = await chrome.storage.local.get(LAST_REDEEM);
        const prev = stored[LAST_REDEEM] || {};
        await chrome.storage.local.set({
          [LAST_REDEEM]: {
            at: Date.now(),
            query: REDEEM_QUERY,
            options,
            variants: Array.isArray(prev.variants) ? prev.variants : [],
            variantUrl: typeof prev.variantUrl === "string" ? prev.variantUrl : ""
          }
        });
        console.log(`Redeem watch: read ${options.length} option(s).`);
      } else {
        console.warn("Redeem watch: no Overwatch cards found; keeping the last read.");
        await setLastRedeemLog(
          "No Overwatch cards in the catalog — kept the last read.",
          false,
          optionsDump
        );
      }
    } catch (e) {
      console.warn("Redeem read injection ended early:", e);
      await setLastRedeemLog(`The catalog read failed early: ${e && e.message}`, false);
    }

    // Phase 3 — the detail page: the tile's destination, where the variant
    // select lives. Navigating the already-captured tab to the card's sku URL
    // is the deterministic equivalent of pressing the tile (a synthesized
    // click could open a new tab or land mid-hydration), and the tab id never
    // changes, so the closeTabs tail below covers the detail visit too.
    // The family's tiles are sibling skus, so WHICH one gets opened matters:
    // prefer the first that actually shows a price and isn't marked sold out
    // — the unpriced carousel duplicate of the same sku would otherwise win
    // by DOM order. The available flag now comes from the RSC payload when
    // it knows the sku (verbatim capture 2026-09-03: …004 at 4,800 pts is
    // SOLD OUT — isDisabled in the payload, restocking note on its detail
    // page — while …005 at 9,800 is in stock), so this preference skips the
    // restocking sku and its payload-less fallback (any priced card) only
    // kicks in when nothing better is known.
    const target =
      (Array.isArray(options) &&
        options.find(
          opt =>
            opt &&
            typeof opt.href === "string" &&
            opt.href &&
            opt.points &&
            opt.available !== false
        )) ||
      (Array.isArray(options) &&
        options.find(opt => opt && typeof opt.href === "string" && opt.href));
    if (target) {
      try {
        const detailUrl = new URL(target.href, REDEEM_URL).toString();
        await chrome.tabs.update(redeemTab.id, { url: detailUrl });

        if (await stopped()) {
          console.log("Redeem watch: stopped before the detail page could be read.");
          return;
        }

        // Same settle-then-wait as between the search and the catalog read:
        // tabs.update resolves before the navigation starts, so an immediate
        // waitForTabComplete could see the OLD page still "complete".
        await new Promise(resolve => setTimeout(resolve, 1500));
        const detailLoaded = await waitForTabComplete(redeemTab.id, 15000);
        if (!detailLoaded) {
          console.warn("Redeem watch: detail page did not finish loading in time.");
        }

        if (await stopped()) {
          console.log("Redeem watch: stopped before the variants reader could run.");
          return;
        }

        const [injection] = await chrome.scripting.executeScript({
          target: { tabId: redeemTab.id },
          func: readRedeemVariants,
          args: [REDEEM_HYDRATION_MS]
        });
        const read = injection && injection.result;
        const variants = read && read.list;

        // Same last-good rule as the options above: an empty variant list is
        // more likely a markup surprise than a product with no variants, so
        // it keeps the previous read (and the dump tells us why).
        if (Array.isArray(variants) && variants.length) {
          const stored = await chrome.storage.local.get(LAST_REDEEM);
          const record = stored[LAST_REDEEM];
          if (record) {
            // Stock-change news (user request 2026-09-03): an amount that
            // flipped between reads — restocked, or newly sold out — is what
            // the user wants to hear about at the top of the popup, not just
            // in the card's rows. One record per direction for the two
            // banners. The banners are NOT dismissible (user's call): a
            // record clears only when the amount flips back, which also moves
            // it into the opposite record. The previous read is the baseline;
            // a first-ever read has no "before" to compare against, so it
            // only establishes one. Labels match case-insensitively, same as
            // the redeem button's own label lookup.
            const prevByLabel = new Map(
              (Array.isArray(record.variants) ? record.variants : [])
                .filter(v => v && typeof v.label === "string")
                .map(v => [v.label.toLowerCase(), v.available !== false])
            );
            const restocked = [];
            const soldOut = [];
            for (const variant of variants) {
              if (!variant || typeof variant.label !== "string") continue;
              const key = variant.label.toLowerCase();
              if (!prevByLabel.has(key)) continue;
              const isAvailable = variant.available !== false;
              const wasAvailable = prevByLabel.get(key);
              if (isAvailable && !wasAvailable) restocked.push(variant.label);
              else if (!isAvailable && wasAvailable) soldOut.push(variant.label);
            }
            if (restocked.length || soldOut.length) {
              const news = await chrome.storage.local.get([
                REDEEM_RESTOCK_NEWS,
                REDEEM_SOLD_OUT_NEWS
              ]);
              // Every flipped amount leaves the opposite record: a coin that
              // restocks stops being "no longer available", and one that
              // sells out stops being "available".
              const flipped = new Set(
                [...restocked, ...soldOut].map(label => String(label).toLowerCase())
              );
              const keepLabels = recordNews =>
                (recordNews && Array.isArray(recordNews.labels)
                  ? recordNews.labels
                  : []
                ).filter(label => !flipped.has(String(label).toLowerCase()));

              const restockKept = keepLabels(news[REDEEM_RESTOCK_NEWS]);
              const soldOutKept = keepLabels(news[REDEEM_SOLD_OUT_NEWS]);
              if (restocked.length || restockKept.length) {
                await chrome.storage.local.set({
                  [REDEEM_RESTOCK_NEWS]: {
                    at: Date.now(),
                    labels: [...restockKept, ...restocked]
                  }
                });
              } else {
                await chrome.storage.local.remove(REDEEM_RESTOCK_NEWS);
              }
              if (soldOut.length || soldOutKept.length) {
                await chrome.storage.local.set({
                  [REDEEM_SOLD_OUT_NEWS]: {
                    at: Date.now(),
                    labels: [...soldOutKept, ...soldOut]
                  }
                });
              } else {
                await chrome.storage.local.remove(REDEEM_SOLD_OUT_NEWS);
              }
              if (restocked.length) {
                console.log(`Redeem watch: restocked — ${restocked.join(", ")}.`);
              }
              if (soldOut.length) {
                console.log(`Redeem watch: sold out — ${soldOut.join(", ")}.`);
              }
            }
            await chrome.storage.local.set({
              [LAST_REDEEM]: { ...record, variants, variantUrl: detailUrl }
            });
            console.log(`Redeem watch: read ${variants.length} variant(s) on the detail page.`);
            await setLastRedeemLog(
              `Read ${options.length} option(s) and ${variants.length} amount(s).`,
              true
            );
          }
        } else {
          console.warn("Redeem watch: no variants found on the detail page; keeping the last read.");
          await setLastRedeemLog(
            "The product page showed no coin amounts — kept the last read.",
            false,
            (read && read.dump) || ""
          );
        }
      } catch (e) {
        console.warn("Redeem variants injection ended early:", e);
        await setLastRedeemLog(`The amounts read failed early: ${e && e.message}`, false);
      }
    }
  } finally {
    // Closes only the tab THIS run opened (user report 2026-09-03: "No tab
    // with id"). The former endTabCapture("redeem") popped the shared
    // per-step list, which a newer overlapping run had already reset — so
    // this tail could hand back and close the OTHER run's mid-read tab. A
    // stopped run still leaves its tab open: stopping is not finishing.
    if (redeemTabId != null && !(await stopped())) {
      const settings = await getSettings();
      const closed = await closeTabs([redeemTabId], settings.keepPinnedTabs);
      if (closed) console.log(`Closed the tab opened by "redeem".`);
    }

    await endActivity("Redeem watch");
    READ_RUN_GUARDS.redeem = false;
  }
}

// The popup's Redeem button (auto-press revived 2026-09-03, one step past
// the navigate-only stopgap): opens the chosen amount's sku page in the
// FOREGROUND and, once it settles, presses the page's own Redeem Now — but
// ONLY when the page enables the button. A disabled Redeem Now (the balance
// can't cover it, or the amount is sold out) resolves without a press; the
// page stays open for the user and the outcome lands in the Activity →
// Redeem row (the user has no console to read — same reasoning as the watch
// readers). Each denomination of the family is its own sku (…004 = 500
// coins, …005 = 1000 coins in the capture), so the variant's payload href
// lands the page with that amount already selected; without a payload the
// fallback is the detail page the watch last read (LAST_REDEEM.variantUrl)
// and the picker does the selecting there.
//
// Deliberately no activity token and no tab capture: there is nothing to
// stop mid-run that matters — a stray press can't happen because the picker
// refuses disabled buttons — and the tab is the user's from the moment it
// appears, never closed by us in any outcome.
async function redeemOverwatchCoins(url, label) {
  if (typeof url !== "string" || !url || !String(label || "").trim()) {
    console.warn("Redeem: no page to open — run the stats read first.");
    await setLastRedeemLog("The redeem press did not run — no page was read yet.", false);
    return;
  }

  // Prefer the chosen variant's own sku href from the last read: opening the
  // family page would show whatever amount the watch happened to read on.
  let target = url;
  try {
    const stored = await chrome.storage.local.get(LAST_REDEEM);
    const variants = stored[LAST_REDEEM] && stored[LAST_REDEEM].variants;
    const match = (Array.isArray(variants) ? variants : []).find(
      v =>
        v &&
        typeof v.label === "string" &&
        v.label.toLowerCase() === String(label).toLowerCase()
    );
    if (match && typeof match.href === "string" && match.href) {
      target = new URL(match.href, REDEEM_URL).toString();
    }
  } catch (e) {
    // A storage miss only means the fallback page opens; never fatal.
  }

  // active: true on purpose — the opposite reasoning of the watch's read
  // tab. This is a user action on their own points, and whatever the page
  // shows next (the Redeem press, a confirmation, the code) is theirs.
  const tab = await chrome.tabs.create({ url: target, pinned: false, active: true });
  console.log(`Redeem: opened ${target} for "${label}".`);

  try {
    const loaded = await waitForTabComplete(tab.id, 15000);
    if (!loaded) console.warn("Redeem: the page did not finish loading in time.");

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: redeemOnDetailPage,
      args: [label, REDEEM_HYDRATION_MS]
    });
    const result = injection && injection.result;

    if (result && result.clicked) {
      console.log(`Redeem: pressed Redeem Now for "${label}".`);
      await setLastRedeemLog(
        `"${label}": Redeem Now was pressed — the page takes it from there.`,
        true
      );
      return;
    }

    // A refusal, never an error: the page is open, the user can see why.
    // The reason strings come from redeemOnDetailPage; matched on their
    // stable parts so a label tweak there doesn't silence this.
    const reason = (result && result.reason) || "no result from the page";
    console.warn("Redeem: nothing pressed —", reason);
    const text = String(reason);
    let detail;
    if (text.includes("sold out")) {
      detail = `"${label}" is sold out — the page says it's restocking.`;
    } else if (
      text.includes("not enough points") ||
      text.includes("stayed disabled")
    ) {
      detail = `"${label}" costs more than your points right now.`;
    } else if (text.includes("not found in the picker")) {
      detail = `"${label}" was not on the page's picker.`;
    } else if (text.includes("timed out")) {
      detail = `The page never showed a pressable Redeem Now for "${label}".`;
    } else {
      detail = `Redeem Now was not pressed: ${text}.`;
    }
    await setLastRedeemLog(`${detail} The page stayed open.`, false);
  } catch (e) {
    console.warn("Redeem: the press failed:", e);
    await setLastRedeemLog(
      `The redeem press failed early: ${e && e.message}. The page stayed open.`,
      false
    );
  }
}

// ---------- Experimental: coupons ----------

// The popup's Coupons button (Settings → Experimental features). Opens the
// Rewards dashboard in the foreground, clicks the "Coupon (N)" trigger and
// then presses every "Apply coupon" in the panel that opens. Experimental
// because no live coupon has been run through it yet: the panel's markup is
// in no capture (it renders only after the trigger is clicked), so the
// page-side claimer follows the dump contract (ADR-010) — anything it
// doesn't recognize lands in console.warn with the page text.
async function claimCoupons() {
  const myToken = await beginActivity("Coupons");
  const stopped = () => currentActivityToken().then(v => v !== myToken);

  try {
    await beginTabCapture("coupons");

    // active: true for the same reason as the redeem button's tab: a
    // user-initiated action on their own account. The tab stays open
    // afterwards in every outcome — the panel is theirs to look at.
    const tab = await chrome.tabs.create({
      url: REWARDS_DASHBOARD,
      pinned: false,
      active: true
    });
    await claimTab("coupons", tab.id);

    if (await stopped()) {
      console.log("Coupons: stopped while opening the page.");
      return;
    }

    const loaded = await waitForTabComplete(tab.id, 15000);
    if (!loaded) console.warn("Coupons: the dashboard did not finish loading in time.");

    if (await stopped()) {
      console.log("Coupons: stopped before the panel could be opened.");
      return;
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: claimDashboardCoupons,
      args: [REDEEM_HYDRATION_MS]
    });
    const result = injection && injection.result;

    if (result && result.opened) {
      // Everything the panel had is now applied (or already was); the button
      // grays until the next stats read sees a fresh coupon.
      await chrome.storage.local.set({
        [LAST_COUPONS]: { at: Date.now(), available: 0 }
      });
      console.log(`Coupons: applied ${result.claimed} coupon(s).`);
    } else if (result && result.reason === "no coupons") {
      await chrome.storage.local.set({
        [LAST_COUPONS]: { at: Date.now(), available: 0 }
      });
      console.log("Coupons: none available to apply.");
    } else {
      console.warn(
        "Coupons: could not claim —",
        (result && result.reason) || "no result from the page"
      );
    }
  } catch (e) {
    console.warn("Coupons: failed:", e);
  } finally {
    // Dropped on purpose, same as the redeem button's tail: the tab stays
    // open in every outcome.
    await endTabCapture("coupons");
    await endActivity("Coupons");
  }
}

// Reads the coupon count off the dashboard's "Coupon (N)" trigger into a
// plain number. Injected into the stats read's dashboard tab. Resolves null
// when the page shows nothing it recognizes (dumped to console.warn per the
// ADR-010 contract) — the caller then keeps the last good count.
function readCouponCount(timeoutMs) {
  return new Promise(resolve => {
    const POLL_MS = 500;
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 5000);
    // The trigger's own label: "Coupon (2)". Anchored end-to-end so the
    // i18n payload inside <script> tags (which innerText skips anyway) and
    // unrelated marketing copy can't match.
    const TRIGGER = /^coupon\s*\((\d+)\)$/i;
    const NO_COUPONS = /no coupon available/i;

    const textOf = el => ((el && (el.innerText || el.textContent)) || "").trim();

    function poll() {
      const trigger = Array.from(
        document.querySelectorAll('button, [role="button"], a')
      ).find(el => TRIGGER.test(textOf(el)));
      if (trigger) {
        resolve(Number(TRIGGER.exec(textOf(trigger))[1]));
        return;
      }
      // Below the eligibility line the trigger is replaced by a plain
      // "no coupons" title (the page's own i18n: "No coupon available!").
      if (NO_COUPONS.test(textOf(document.body))) {
        resolve(0);
        return;
      }
      if (Date.now() >= deadline) {
        console.warn(
          "Coupons: no trigger on the dashboard (report to dev):",
          document.body.innerText.slice(0, 800)
        );
        resolve(null);
        return;
      }
      setTimeout(poll, POLL_MS);
    }
    poll();
  });
}

// Page-side half of the Coupons button: click the trigger, then press every
// enabled "Apply coupon" in the panel (skipping buttons already showing
// "Applied"). Resolves { opened, claimed, reason? }. The panel re-renders
// after each apply, so the scan repeats until it finds no more apply buttons.
function claimDashboardCoupons(timeoutMs) {
  return new Promise(resolve => {
    const POLL_MS = 500;
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 12000);
    const TRIGGER = /^coupon\s*\((\d+)\)$/i;
    const APPLY = /apply coupon/i;
    const APPLIED = /^applied$/i;
    const NO_COUPONS = /no coupon available/i;

    const textOf = el => ((el && (el.innerText || el.textContent)) || "").trim();
    const clickable = () =>
      Array.from(document.querySelectorAll('button, [role="button"]'));
    const applyButtons = () =>
      clickable().filter(
        el =>
          APPLY.test(textOf(el)) &&
          !el.disabled &&
          el.getAttribute("aria-disabled") !== "true"
      );

    let opened = false;
    let sawPanel = false;
    let claimed = 0;

    function finish(extra) {
      resolve({ opened, claimed, ...(extra || {}) });
    }

    function poll() {
      if (Date.now() >= deadline) {
        // Dump contract (ADR-010): report what the page actually showed so
        // the reader can be refined from a real run.
        console.warn(
          "Coupons: timed out (report to dev):",
          document.body.innerText.slice(0, 800)
        );
        finish({ reason: "timed out" });
        return;
      }

      if (!opened) {
        const trigger = clickable().find(el => TRIGGER.test(textOf(el)));
        if (!trigger) {
          if (NO_COUPONS.test(textOf(document.body))) {
            finish({ reason: "no coupons" });
            return;
          }
          setTimeout(poll, POLL_MS);
          return;
        }
        const count = Number((TRIGGER.exec(textOf(trigger)) || [])[1] || 0);
        if (!count) {
          finish({ reason: "no coupons" });
          return;
        }
        trigger.click();
        opened = true;
        setTimeout(poll, POLL_MS);
        return;
      }

      // Panel opened — but it renders after the click, so "no apply buttons
      // yet" must not read as "done". sawPanel turns true at the first
      // button OR the first "Applied" marker; only then does an empty scan
      // mean everything is applied.
      const buttons = applyButtons();
      if (buttons.length) {
        sawPanel = true;
        buttons.forEach(btn => btn.click());
        claimed += buttons.length;
        setTimeout(poll, POLL_MS);
        return;
      }
      if (!sawPanel) {
        if (clickable().some(el => APPLIED.test(textOf(el)))) {
          sawPanel = true;
          finish();
          return;
        }
        setTimeout(poll, POLL_MS);
        return;
      }
      // sawPanel and no apply buttons left: this run did all it could.
      finish();
    }
    poll();
  });
}

// Resolves true once the tab reports "complete", false on timeout.
// Checks the current state first: the tab may already be loaded before the
// listener is attached, which would otherwise hang forever.
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    let settled = false;

    function finish(ok) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") finish(true);
    }

    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => finish(false), timeoutMs);

    chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab && tab.status === "complete") finish(true);
      })
      .catch(() => finish(false));
  });
}

// Retries until the section's heading, its container AND its tiles exist, then
// clicks them. maxOpen <= 0 means "however many are there", which is what Keep
// earning needs — that section holds a different number of activities each day.
// Runs in the page, so it cannot reference anything outside itself.
function openRewardsSectionTiles(names, maxOpen, label, skipSpent) {
  return new Promise(resolve => {
    const MAX_RETRIES = 20;
    const RETRY_INTERVAL_MS = 500;
    const CLICK_DELAY_MS = 800;
    // Backstop for the open-ended case: if the filters below ever go wrong, this
    // is the difference between a few stray tabs and a hundred.
    const HARD_CEILING = 20;
    // When nothing looks incomplete, the tiles get clicked anyway — the
    // "completed" test is only a heuristic. But conservatively, because the
    // other explanation is that today is genuinely finished.
    const BLIND_LIMIT = 3;
    // skipSpent (Keep earning, 2026-09-05): a tile carrying any of these in
    // its body text can no longer earn, so it is skipped outright. "Completed"
    // is the page's own status; "reward up only" is the wording on tiles that
    // only ever paid a capped amount and now pay nothing. The daily set keeps
    // the blind-click fallback above because its "completed" test is only a
    // heuristic there — for Keep earning, a spent tile is just a dead tab.
    const SPENT_MARKERS = ["completed", "reward up only"];

    const requested = Number(maxOpen) > 0 ? Number(maxOpen) : HARD_CEILING;
    const limit = Math.min(requested, HARD_CEILING);
    const wanted = names.map(name => String(name).toLowerCase());

    let attempts = 0;
    let expandedOnce = false;

    const textOf = el =>
      (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();

    function scheduleRetry(reason) {
      console.warn(reason);
      if (attempts < MAX_RETRIES) {
        setTimeout(tryFindAndClick, RETRY_INTERVAL_MS);
      } else {
        console.warn(`${label}: giving up after retries.`);
        resolve(0);
      }
    }

    // Exact match first, so "Keep earning" can't lose to a heading that merely
    // mentions it.
    function findHeading() {
      const headings = Array.from(
        document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')
      );
      const tests = [
        h => wanted.includes(textOf(h)),
        h => wanted.some(name => textOf(h).startsWith(name)),
        h => wanted.some(name => textOf(h).includes(name))
      ];

      for (const test of tests) {
        const found = headings.find(test);
        if (found) return found;
      }
      return null;
    }

    // A nest of clickables is one tile, not several: keeping only the outermost
    // of each nest is what stops a single card being clicked twice.
    //
    // react-aria renders the Rewards tiles as <span role="link"> rather than
    // <a href>, so [role="link"] has to be in the selector or the /earn page
    // yields no candidates at all.
    function isDisabled(el) {
      return (
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("data-disabled")
      );
    }

    function candidatesIn(scope) {
      const all = Array.from(
        scope.querySelectorAll(
          'a[href], button, div[role="button"], [role="link"]'
        )
      );
      return all.filter(el => !all.some(other => other !== el && other.contains(el)));
    }

    // The daily set sits in a react-aria Disclosure. Keep earning may not, so
    // fall back to the nearest ancestor that actually holds several tiles.
    function findScope(heading) {
      const disclosure = heading.closest(".react-aria-Disclosure");
      if (disclosure) {
        const panel = disclosure.querySelector(".react-aria-DisclosurePanel");
        if (panel) return { scope: panel, panelId: panel.id, disclosure };
      }

      let node = heading.parentElement;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        const own = candidatesIn(node).filter(
          el => !el.contains(heading) && !heading.contains(el)
        );
        if (own.length >= 2) return { scope: node, panelId: "", disclosure: null };
      }
      return null;
    }

    // A collapsed section renders no tiles at all. Only touched when the page
    // itself says it is shut, and only once.
    function expandIfCollapsed(disclosure) {
      if (expandedOnce || !disclosure) return false;
      const toggle = disclosure.querySelector('[aria-expanded="false"]');
      if (!toggle || typeof toggle.click !== "function") return false;

      expandedOnce = true;
      toggle.click();
      return true;
    }

    function tryFindAndClick() {
      attempts++;

      const heading = findHeading();
      if (!heading) {
        scheduleRetry(`${label}: heading not found yet, retrying...`);
        return;
      }

      const found = findScope(heading);
      if (!found) {
        scheduleRetry(`${label}: section container not found yet, retrying...`);
        return;
      }

      const candidates = candidatesIn(found.scope);
      console.log(`${label}: clickable candidates:`, candidates.length);

      if (!candidates.length) {
        if (expandIfCollapsed(found.disclosure)) {
          scheduleRetry(`${label}: section was collapsed, expanding it...`);
        } else {
          scheduleRetry(`${label}: no clickable candidates yet, retrying...`);
        }
        return;
      }

      const tiles = candidates.filter(el => {
        const body = textOf(el);
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const controls = el.getAttribute("aria-controls") || "";

        // The section's own header toggle and its "about" button are not tiles.
        const isSectionChrome =
          (found.panelId && controls === found.panelId) ||
          el.contains(heading) ||
          heading.contains(el) ||
          wanted.some(name => aria.includes(name));

        // "Expires in" marks a tile's metadata, and the section's own collapse
        // button carries the section name as its label. Both are skipped — but
        // a tile's body text mentioning the name is not, on its own, enough to
        // drop it: only buttons were ever the risky case.
        const isMeta =
          body.includes("expires in") ||
          (el.tagName === "BUTTON" && wanted.some(name => body.includes(name)));

        // Completed tiles render aria-disabled — they won't earn anything and
        // their handlers may not even fire.
        //
        // The Image Creator tile ("create your own wallpaper" and friends)
        // earns its points only on the Image Creator page itself, which a plain
        // click doesn't complete — so opening it just leaves a dead tab behind.
        const href = (el.getAttribute("href") || "").toLowerCase();
        const isImageCreator =
          href.includes("bing.com/images/create") ||
          body.includes("image creator") ||
          body.includes("create and download");

        return (
          !isSectionChrome && !isMeta && !isDisabled(el) && !isImageCreator
        );
      });

      if (!tiles.length) {
        // Candidates exist but none are clickable: the section rendered, its
        // tiles are just all completed or disabled. Retrying won't change that,
        // so report "none" now rather than spinning out the full 10s of retries.
        if (candidates.length) {
          console.warn(
            `${label}: ${candidates.length} candidates, none usable (completed or disabled).`
          );
          resolve(0);
          return;
        }
        scheduleRetry(`${label}: no tiles in the section yet, retrying...`);
        return;
      }

      // With skipSpent, spent tiles are dropped before the pool: "completed"
      // and "reward up only" both mean the tile cannot earn. Without it (the
      // daily set), the old incomplete/blind split stands.
      const unspent = skipSpent
        ? tiles.filter(
            el => !SPENT_MARKERS.some(marker => textOf(el).includes(marker))
          )
        : tiles.filter(el => !textOf(el).includes("completed"));

      if (skipSpent && !unspent.length) {
        // Every tile is spent — retrying cannot change that. "0" reports the
        // section as having nothing to open, which is exactly true.
        console.warn(
          `${label}: ${tiles.length} tiles, all spent (completed or reward up only) — nothing to open.`
        );
        resolve(0);
        return;
      }

      const pool = unspent.length ? unspent : tiles;
      const cap = unspent.length ? limit : Math.min(limit, BLIND_LIMIT);
      const toClick = pool.slice(0, cap);

      if (pool.length > toClick.length) {
        console.warn(
          `${label}: ${pool.length} activities available, opening ${toClick.length} (limit).`
        );
      }
      console.log(`${label}: clicking ${toClick.length} of ${tiles.length} tiles.`);

      toClick.forEach((el, idx) => {
        setTimeout(() => {
          if (el && typeof el.click === "function") {
            el.click();
          }
        }, idx * CLICK_DELAY_MS);
      });

      setTimeout(
        () => resolve(toClick.length),
        toClick.length * CLICK_DELAY_MS + 500
      );
    }

    tryFindAndClick();
  });
}

// Claims the Rewards Dashboard's pending points: the "Ready to claim" tile
// opens a react-aria side panel (section[role="dialog"]) whose claim card is
// one big button — clicking it claims everything pending at once. Runs in the
// page, so it cannot reference anything outside itself; same polling idiom as
// openRewardsSectionTiles above.
//
// The UI strings matched here ("Ready to claim", "Claim points", the outcome
// texts) are English-only — the same limitation openRewardsSectionTiles
// already accepts when it matches on the section headings.
//
// The tile click is retried while the page still shows the tile collapsed
// and no dialog is open at all — a click lost to a react-aria re-render or a
// not-yet-hydrated tree would otherwise leave the panel forever shut (live
// regression, 2026-09-03: "panel did not open"). Every failure branch dumps
// the markup it was staring at to this console, the same contract as the
// redeem watch, because this DOM is unreachable from the test fixtures: the
// dashboard redesign of 2026-09 (Tailwind streak cards) proved the live
// markup can drift under a passing suite.
//
// Resolves one of:
//   { outcome: "claimed", points }   — the panel said "Successfully claimed!"
//   { outcome: "nothing" }           — no pending points (the tile/verdict said so)
//   { outcome: "failed", reason }    — the panel never opened / the card was
//                                      missing / the panel reported an error
//   { outcome: "unknown", points }   — clicked, but no verdict before timeout
// The failed and unknown outcomes also carry `dump` — the markup the branch
// was staring at — which reportClaimResult forwards into the Activity row
// (the same contract as the redeem watch and the stats read).
function claimDashboardPoints(timeoutMs) {
  return new Promise(resolve => {
    const TILE_POLL_ATTEMPTS = 20;  // ~10s for the dashboard to hydrate — the
                                    // stats reader waits 12s for the same
                                    // reason, and a slow tile render would
                                    // otherwise read as "nothing to claim"
    const PANEL_WAIT_MS = 10000;    // the panel slides in; give it time
    const BUTTON_POLL_ATTEMPTS = 6; // the card renders with the panel
    const POLL_INTERVAL_MS = 500;

    const waitMs = Math.max(1000, Number(timeoutMs) || 15000);
    const deadline = Date.now() + waitMs;

    const textOf = el =>
      (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();

    function after(ms, fn) {
      setTimeout(fn, ms);
    }

    // Press the way a real mouse does (the stats read's pressButton, copied
    // here because an injected function must be self-contained): a
    // pointerdown/pointerup pair with a mouse pointerType, the element's own
    // center as the coordinates, and non-zero size and pressure (react-aria
    // reads a zero-sized pointer event as a screen-reader tap and ignores the
    // sequence), then the plain click. The live dashboard's current build
    // ignores bare element.click() on its react-aria controls (proven by the
    // search-points flyout, 2026-09-05), and the claim's "still processing
    // when we stopped watching" report is the same signature: the panel was
    // open (the dashboard renders it open), the claim card was found and
    // virtually pressed, the page ignored it, no verdict ever rendered. The
    // trailing click keeps click-only handlers (every static fixture)
    // working, and inside usePress the whole sequence is exactly one press.
    function click(el) {
      if (!el || typeof el.click !== "function") return;
      const rect = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        composed: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      };
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...at,
            buttons: 1,
            width: 1,
            height: 1,
            pressure: 0.5
          })
        );
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            ...at,
            buttons: 0,
            width: 1,
            height: 1,
            pressure: 0
          })
        );
      }
      el.click();
    }

    // The tile is a <button>; the sibling "Available points" tile is an <a>
    // whose label says "Redeem", so the text match can't pick it up. The
    // 2026-09 redesign renders its cards as plain divs whose only click
    // affordance is Tailwind's cursor-pointer class, so those are searched
    // too — buttons first, because the older markup must keep matching.
    function findTile() {
      const buttons = Array.from(
        document.querySelectorAll("button[aria-controls], button")
      );
      const byButton = buttons.find(el =>
        textOf(el).includes("ready to claim")
      );
      if (byButton) return byButton;
      const cards = Array.from(document.querySelectorAll("div.cursor-pointer"));
      return cards.find(el => textOf(el).includes("ready to claim")) || null;
    }

    // Prefer a dialog that says "Claim points"; fall back to whatever dialog
    // is open while the tile says it is expanded — the 2026-09 redesign
    // changed panel headings once already, and the tile's aria-expanded is
    // the page's own answer to "did the click work?".
    function findDialog(tile) {
      const dialogs = Array.from(
        document.querySelectorAll('section[role="dialog"], [role="dialog"]')
      );
      const byText = dialogs.find(el => textOf(el).includes("claim points"));
      if (byText) return byText;
      if (
        tile &&
        tile.getAttribute("aria-expanded") === "true" &&
        dialogs.length
      ) {
        return dialogs[0];
      }
      return null;
    }

    function isDismiss(el) {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      return aria === "close" || aria === "dismiss";
    }

    // The claim card is the panel's big <button>. The h2 title is not a
    // button, and the Close button carries its label in aria-label rather
    // than text, so the text filter excludes both — the aria-label check is
    // belt-and-braces. Redesigned panels may render the card as a
    // role="button" div or a cursor-pointer card (like the streak tiles), so
    // those are fallbacks behind the buttons, matched on "claim" alone (no
    // word boundaries: adjacent text nodes can concatenate to
    // "…pointsClaim") in case the label drifted from "Claim points".
    function findClaimButton(dialog) {
      const buttons = Array.from(dialog.querySelectorAll("button"));
      const byText = buttons.find(
        el => !isDismiss(el) && textOf(el).includes("claim points")
      );
      if (byText) return byText;
      const byWord = buttons.find(
        el => !isDismiss(el) && /claim/i.test(textOf(el))
      );
      if (byWord) return byWord;
      const others = Array.from(
        dialog.querySelectorAll('[role="button"], div.cursor-pointer')
      );
      return (
        others.find(el => !isDismiss(el) && /claim/i.test(textOf(el))) || null
      );
    }

    function isDisabled(el) {
      return (
        el.disabled === true ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("data-disabled")
      );
    }

    // The pending points sit inside the card, e.g. "456 Pending Claim points"
    // — the pageHeader <p> holds the number when the class is present.
    function pointsIn(card) {
      const para = card.querySelector("p.text-pageHeader");
      const source = para ? textOf(para) : textOf(card);
      const match = source.match(/\d+/);
      return match ? Number(match[0]) : null;
    }

    // Step 1: the tile. It does not render at all when nothing is pending, so
    // "never appeared" and "nothing to claim" are the same thing.
    function waitForTile(attempt) {
      const tile = findTile();
      if (tile) {
        openPanel(tile);
        return;
      }
      if (attempt < TILE_POLL_ATTEMPTS) {
        after(POLL_INTERVAL_MS, () => waitForTile(attempt + 1));
      } else {
        console.warn("Claim: no 'Ready to claim' tile on the page.");
        resolve({ outcome: "nothing" });
      }
    }

    // Step 2: the panel. It may already be open when we arrive, in which case
    // the tile is left unclicked.
    function openPanel(tile) {
      const dialog = findDialog(tile);
      if (dialog) {
        waitForClaimButton(dialog, 0);
        return;
      }
      click(tile);
      waitForPanel(0);
    }

    // The tile click can be lost twice over: fired into a not-yet-hydrated
    // tree, or onto a node a react-aria re-render swapped out. So the wait
    // re-clicks the tile (at most every 1.5s) while the page still shows it
    // collapsed AND no dialog is open at all. Both guards matter: a click
    // that landed flips the tile's aria-expanded, and re-clicking into an
    // opening panel would toggle it shut again.
    function waitForPanel(waitedMs) {
      // Re-query each time: react-aria re-renders can replace the node.
      const tile = findTile();
      const dialog = findDialog(tile);
      if (dialog) {
        waitForClaimButton(dialog, 0);
        return;
      }
      if (waitedMs < PANEL_WAIT_MS) {
        const pageShowsNothingOpen =
          !document.querySelector('[role="dialog"]') &&
          (!tile || tile.getAttribute("aria-expanded") !== "true");
        if (tile && waitedMs > 0 && waitedMs % 1500 === 0 && pageShowsNothingOpen) {
          click(tile);
        }
        after(POLL_INTERVAL_MS, () => waitForPanel(waitedMs + POLL_INTERVAL_MS));
      } else {
        // Same contract as the redeem watch: this DOM is unreachable from
        // the fixtures, so a real failure ships us the markup to fix against.
        // The dump also travels in the result (result.dump) into the popup's
        // Activity row, because the service worker console is not a place
        // the user can go ("all errors should be available at the Activity
        // section", 2026-09-05).
        const anyDialog = document.querySelector('[role="dialog"]');
        const parts = [];
        if (tile) {
          console.warn(
            "Claim: tile markup (report to dev):",
            tile.outerHTML.slice(0, 1500)
          );
          parts.push("tile: " + tile.outerHTML.slice(0, 1500));
        }
        if (anyDialog) {
          console.warn(
            "Claim: dialog markup (report to dev):",
            anyDialog.outerHTML.slice(0, 1500)
          );
          parts.push("dialog: " + anyDialog.outerHTML.slice(0, 1500));
        }
        console.warn("Claim: the claim panel did not open.");
        resolve({
          outcome: "failed",
          reason: "panel did not open",
          dump: parts.join(" ")
        });
      }
    }

    // Step 3: the claim card inside the panel.
    function waitForClaimButton(dialog, attempt) {
      const button = findClaimButton(dialog);
      if (button && !isDisabled(button)) {
        claimIt(dialog, button);
        return;
      }

      // A panel with nothing pending says so in words rather than offering a
      // card, and a disabled card that never recovers is the same verdict.
      if (textOf(dialog).includes("no points to claim")) {
        resolve({ outcome: "nothing" });
        return;
      }

      if (attempt < BUTTON_POLL_ATTEMPTS) {
        after(POLL_INTERVAL_MS, () => waitForClaimButton(dialog, attempt + 1));
      } else {
        console.warn(
          "Claim: panel markup (report to dev):",
          dialog.outerHTML.slice(0, 1500)
        );
        console.warn("Claim: claim card not found in the panel.");
        resolve({
          outcome: "failed",
          reason: "claim button not found",
          dump: dialog.outerHTML.slice(0, 1500)
        });
      }
    }

    // Steps 4+5: capture the points, click once, poll for the verdict.
    function claimIt(dialog, button) {
      const points = pointsIn(button);
      click(button);
      waitForOutcome(dialog, points);
    }

    function waitForOutcome(dialog, points) {
      // Re-query so a re-render can't leave us reading a detached node — and
      // a panel that vanished entirely is no longer a "fall back to the
      // stale one" case: a successful claim can close the panel (react-aria
      // unmounts it) and put its verdict anywhere else on the page, and the
      // old watch polled the dead node's frozen text forever — the live
      // "still processing when we stopped watching" report (2026-09-05,
      // three times: the watch itself was blind to every outcome outside
      // the panel). The tile is handed to findDialog for the same reason
      // openPanel hands it over: a redesigned panel without a "Claim
      // points" heading is only identifiable by the expanded tile.
      const tile = findTile();
      const live = findDialog(tile);
      const panel = live ? textOf(live) : "";
      // The verdict scan covers the whole rendered page. innerText, not
      // textContent: the page's RSC payloads inside <script> tags are
      // textContent but never rendered, and must not answer.
      const page = ((document.body && document.body.innerText) || "")
        .replace(/\s+/g, " ")
        .toLowerCase();

      if (
        panel.includes("successfully claimed") ||
        page.includes("successfully claimed")
      ) {
        resolve({ outcome: "claimed", points });
        return;
      }
      if (panel.includes("no points to claim") || page.includes("no points to claim")) {
        resolve({ outcome: "nothing" });
        return;
      }
      if (panel.includes("error claiming") || page.includes("error claiming")) {
        resolve({
          outcome: "failed",
          reason: "error message shown",
          dump: (live || document.body).outerHTML.slice(0, 1500)
        });
        return;
      }

      if (!live) {
        // The panel is gone. The "Ready to claim" tile only renders while
        // points are pending, so tile and panel both gone is the page's
        // own "done": the claim went through.
        if (!tile) {
          resolve({ outcome: "claimed", points });
          return;
        }
        // The panel shut but the tile still offers points: keep waiting — a
        // re-render may re-open it with the verdict. The deadline branch
        // dumps the page if it never does.
      }

      // Anything else — "Claiming" in progress, the card gone or disabled
      // with no verdict yet — is still worth waiting for.
      if (Date.now() >= deadline) {
        // With the panel gone there is no panel markup to dump; the rendered
        // page is the evidence (what the page chose to show instead).
        const dump = live
          ? live.outerHTML.slice(0, 1500)
          : "page: " + page.slice(0, 1500);
        console.warn("Claim: panel markup at timeout (report to dev):", dump);
        console.warn("Claim: timed out waiting for the outcome.");
        resolve({ outcome: "unknown", points, dump });
        return;
      }
      after(POLL_INTERVAL_MS, () => waitForOutcome(live || dialog, points));
    }

    try {
      waitForTile(0);
    } catch (e) {
      // Never throw to the caller: an unreadable page reports failure instead.
      resolve({ outcome: "failed", reason: String((e && e.message) || e) });
    }
  });
}

// Reads the Rewards pages' stats: the four top cards (Available points,
// Ready to claim, Daily streak, Stamp bonus) and the four activity streak
// cards — Bing, Daily Set, Mobile App and Visual Search; Edge is deliberately
// skipped (the user did not ask for it). Runs in the page, so it cannot
// reference anything outside itself; same polling idiom as
// claimDashboardPoints above, because the React app hydrates after "complete".
//
// The activity values come from the 2026-09 streak cards (live capture,
// 2026-09-03): each card titles itself in a p.text-globalBody2Strong and
// carries two values — the day count in a screen-reader-only line ("Day 4 of
// 7 streak completed.", the dots being decorative) and today's progress in
// its footer ("Search: 1/1"). Both are shown ("Day 4 of 7 · 1/1"). The older
// progressbar tiles are kept as a fallback for the day the cards are absent.
// The stamp bonus prefers the redesigned card's star grid (11 lit cells →
// "11/12", same capture) over the older "1,000 pts" card.
//
// The 2026-09 redesign split the two halves across pages (the user confirmed
// it 2026-09-03): the dashboard keeps the top cards and the stamp bonus card,
// while the streak cards live only on the Earn page — so the caller reads
// BOTH pages and merges (mergeStats below). waitMode says which half to poll
// for, so each page's read returns as soon as its own values hydrate instead
// of burning the whole timeout on the other page's missing half:
//   "cards"   — wait for the top cards (dashboard read)
//   "streaks" — wait for the four activity values (Earn read)
//   omitted   — wait for both (single-page behavior, what the older
//               fixtures exercise)
//
// The UI strings matched here ("Available points", "Day N of M", the card
// titles) are English-only — the same limitation claimDashboardPoints already
// accepts.
//
// Resolves with display strings exactly as the dashboard shows them ("4,509",
// "6 days", "1/1"…) and null for every value it could not find — never throws,
// never resolves without an answer:
//   { availablePoints, readyToClaim, dailyStreak, stampBonus, searchPoints,
//     activities: { bingSearch, dailySet, bingApp, visualSearch } }
function readRewardsStats(timeoutMs, waitMode) {
  return new Promise(resolve => {
    const POLL_INTERVAL_MS = 500;

    const waitMs = Math.max(1000, Number(timeoutMs) || 12000);
    const startedAt = Date.now();
    const deadline = startedAt + waitMs;

    const textOf = el =>
      (el.textContent || "").replace(/\s+/g, " ").trim();

    function emptyStats() {
      return {
        availablePoints: null,
        readyToClaim: null,
        dailyStreak: null,
        stampBonus: null,
        searchPoints: null,
        activities: {
          bingSearch: null,
          dailySet: null,
          bingApp: null,
          visualSearch: null
        }
      };
    }

    // The top cards each carry their label in a p.text-labelControl — the same
    // hook the claim finder matches the "Ready to claim" tile by. The label's
    // nearest a/button ancestor is the card, and the value is the card's
    // p.text-pageHeader ("4,509", "456", "6 days").
    function findCard(labelText) {
      const labels = Array.from(
        document.querySelectorAll("p.text-labelControl")
      );
      const hit = labels.find(el => textOf(el).toLowerCase() === labelText);
      return hit ? hit.closest("a, button") : null;
    }

    function cardValue(labelText) {
      const card = findCard(labelText);
      if (!card) return null;
      const para = card.querySelector("p.text-pageHeader");
      return para ? textOf(para) : null;
    }

    // The 2026-09-05 dashboard redesign (the user's dash.html capture) removed
    // the Available points card — the balance now lives in the page header, a
    // bare comma-grouped number sitting immediately before the membership
    // medal's img ("Gold Member"). The medal adjacency is the row test: the
    // same page carries other bare numbers (the flyout's History table —
    // "This month 997") that must never answer. Old-design pages keep the
    // card read; this is the fallback.
    function headerPointsBalance() {
      const medals = Array.from(
        document.querySelectorAll("img[alt]")
      ).filter(el => /member/i.test(el.getAttribute("alt") || ""));
      for (const medal of medals) {
        const sibling = medal.previousElementSibling;
        if (sibling && /^\s*\d{1,3}(,\d{3})+\s*$|^\s*\d{3,6}\s*$/.test(textOf(sibling))) {
          return textOf(sibling).trim();
        }
      }
      return null;
    }

    // Stamp bonus is the one card whose value is not a pageHeader: it sits in
    // the label's own header row, gradient-clipped ("1,000 pts"). Take the <p>
    // next to the label in that row — the one that is not the label.
    function stampBonusValue() {
      const card = findCard("stamp bonus");
      if (!card) return null;
      const labels = Array.from(card.querySelectorAll("p.text-labelControl"));
      const label = labels.find(el => textOf(el).toLowerCase() === "stamp bonus");
      if (!label || !label.parentElement) return null;

      const paras = Array.from(label.parentElement.querySelectorAll("p"));
      const value = paras.find(p => p !== label && textOf(p));
      return value ? textOf(value) : null;
    }

    // The redesigned stamp bonus card (Earn page, live capture 2026-09-03)
    // counts progress in a grid of twelve star cells: a lit cell sits on the
    // brand background (bg-bgCtrlBrandRest), an unlit one is merely outlined
    // (border-strokeDividerBrand). The user asked for the lit count ("out of
    // 12, how many stars are light"), so it wins over the older "1,000 pts"
    // card read, which stays as the fallback. The cell count is read from the
    // grid rather than hardcoded to 12, in case the card ever grows.
    function stampBonusStars() {
      const paras = Array.from(document.querySelectorAll("p"));
      const callout = paras.find(el => /earn \d+ stamps/i.test(textOf(el)));
      if (!callout) return null;

      const card =
        callout.closest("button, div.cursor-pointer") ||
        callout.parentElement;
      if (!card) return null;

      const grid = Array.from(card.querySelectorAll("div")).find(el =>
        String(el.className).includes("grid-cols-6")
      );
      if (!grid) return null;

      const cells = Array.from(grid.children);
      if (!cells.length) return null;
      const lit = cells.filter(el =>
        String(el.className).includes("bg-bgCtrlBrandRest")
      ).length;
      return lit + "/" + cells.length;
    }

    // The Bing-search "out of 60" — the Today's points card's breakdown
    // (the user's pointer, 2026-09-04; the expanded panel captured verbatim
    // 2026-09-05, html2.html). The card is a react-aria DialogTrigger button:
    // collapsed it carries no aria-controls at all — the attribute and the
    // flyout appear together once it opens — so the read clicks it open once
    // (expandPointsBreakdownIfCollapsed below) and then hunts the panel for
    // the search row. The live panel is a side drawer (a section[role=dialog]
    // holding a table), so the matcher stays shape-based:
    //   - a bare "X/Y" text whose max is >= 4 (the streak footers answer /1
    //     and /3, dates and "Earned last month: 420/420" never render as a
    //     bare pair) in a row labeled "search" — the live table splits the
    //     value across two sibling spans ("60" + "/60", so the pair only
    //     exists at their parent div) and lays each row out as label-div
    //     then value-div siblings, or
    //   - a role="progressbar" labeled with "search" and a max >= 4 (the
    //     streak bar carries "Search: 1/1" — max 1, kept out).
    function findPointsCard() {
      const labels = Array.from(
        document.querySelectorAll("p.text-labelControl")
      );
      // Apostrophe tolerant: the capture uses the straight form, the live
      // page could typographically curl it.
      const label = labels.find(el => /^today.?s points$/i.test(textOf(el)));
      return label ? label.closest("a, button") : null;
    }

    function searchPointsValue() {
      // The breakdown lives ONLY inside the flyout: the expanded button's
      // aria-controls -> #id (absent while collapsed — the DialogTrigger
      // adds it on open). When the card exists but its flyout is not open,
      // the answer is null, NOT a document-wide hunt: the live dashboard's
      // page body carries other "X/Y" progress numbers near search-labeled
      // things, and that fallback answered a wrong "100" on the user's
      // first live run (2026-09-05). A closed flyout lets the caller's dump
      // collect the card's markup instead. Only a page with NO card at all
      // (the old design) falls back to the document, for the progressbar
      // read below.
      let scope = document;
      const card = findPointsCard();
      if (card) {
        const controlled = card.getAttribute("aria-controls");
        const panel = controlled ? document.getElementById(controlled) : null;
        if (!panel) return null;
        scope = panel;
      }

      const cells = Array.from(scope.querySelectorAll("span, p, div"));
      const pairs = cells.filter(el => {
        const t = textOf(el);
        if (!/^\d+\s*\/\s*\d+$/.test(t)) return false;
        return Number(t.match(/(\d+)\s*\/\s*(\d+)/)[2]) >= 4;
      });
      for (const el of pairs) {
        // The live table's row test: the label ("Bing search") is the pair's
        // immediately preceding sibling. It must be the deciding evidence
        // when present — the ancestor walk alone would answer for ANY row of
        // the table, because the grid ancestor carries every row's text
        // (including "Bing search"), and the table can hold other max>=4
        // rows (an Edge "0/30" minutes row).
        const labelCell = el.previousElementSibling;
        if (labelCell && textOf(labelCell)) {
          if (/search/i.test(textOf(labelCell))) {
            return textOf(el).replace(/\s+/g, "");
          }
          continue;
        }
        // Unknown markup: a short bounded walk up — older designs put the
        // label and the value in one shared row element.
        let row = el.parentElement;
        for (let hops = 0; hops < 5 && row; hops++) {
          if (/search/i.test(textOf(row))) {
            return textOf(el).replace(/\s+/g, "");
          }
          row = row.parentElement;
        }
      }

      // The progressbar shape, for a panel that renders bars like the streak
      // cards do. Fractional valuenows (the page uses them elsewhere) round
      // to the whole points the row displays.
      const bars = Array.from(scope.querySelectorAll('[role="progressbar"]'));
      const bar = bars.find(el => {
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        if (!label.includes("search")) return false;
        const max = Number(el.getAttribute("aria-valuemax"));
        return Number.isFinite(max) && max >= 4;
      });
      if (bar) {
        const now = Number(bar.getAttribute("aria-valuenow"));
        const max = Number(bar.getAttribute("aria-valuemax"));
        if (Number.isFinite(now) && Number.isFinite(max)) {
          return `${Math.round(now)}/${Math.round(max)}`;
        }
      }
      return null;
    }

    // A streak card ("Bing Search Streak") carries two values: the day count    // in a screen-reader-only line ("Day 4 of 7 streak completed.") and
    // today's progress in the footer ("Search: 1/1" — the max differs per
    // streak, 1 or 3). Both are shown ("Day 4 of 7 · 1/1"); a missing half
    // is dropped rather than guessed. The title pattern picks the card, then
    // the nearest ancestor holding a .sr-only line is its scope — the title
    // and the dots row are siblings, but the card root has no stable hook
    // beyond the (shared) cursor-pointer class. Bounded walk so a card
    // without its own sr-only can't reach into a sibling card's.
    function streakCardValue(titlePattern) {
      const titles = Array.from(
        document.querySelectorAll("p.text-globalBody2Strong")
      );
      const title = titles.find(el => titlePattern.test(textOf(el)));
      if (!title) return null;

      let scope = title.parentElement;
      for (let hops = 0; hops < 4 && scope; hops++) {
        if (scope.querySelector(".sr-only")) break;
        scope = scope.parentElement;
      }
      if (!scope || !scope.querySelector(".sr-only")) return null;

      const lines = Array.from(scope.querySelectorAll(".sr-only")).map(textOf);
      const dayLine = lines.find(line => /day \d+ of \d+/i.test(line));
      const day = dayLine
        ? dayLine.match(/day \d+ of \d+/i)[0].replace(/\s+/g, " ")
        : null;

      // The footer line lives outside the title's own column (the live card
      // puts it in a sibling of the column the title and dots sit in), so
      // the progress is searched in the card root: the nearest ancestor
      // marked clickable, which on this design is the card itself. If no
      // such ancestor exists, the tight sr-only scope is the best guess.
      let cardRoot = scope;
      for (let hops = 0; hops < 6 && cardRoot; hops++) {
        if (cardRoot.classList && cardRoot.classList.contains("cursor-pointer")) break;
        cardRoot = cardRoot.parentElement;
      }
      const progressScope = cardRoot || scope;

      // The footer cell is the card's own "Name: X/Y" line — the same shape
      // the progressbar tiles carried, on a div this time.
      const cells = Array.from(progressScope.querySelectorAll("div, span, p"));
      const progressCell = cells.find(el =>
        /^[a-z' -]+:\s*\d+\s*\/\s*\d+$/i.test(textOf(el))
      );
      const progress = progressCell
        ? (textOf(progressCell).match(/\d+\s*\/\s*\d+/) || [null])[0].replace(
            /\s+/g,
            ""
          )
        : null;

      if (day && progress) return day + " · " + progress;
      return day || progress || null;
    }

    // Each activity tile holds a role="progressbar" whose aria-label is the
    // tile's name. The page holds other progressbars ("Points", "Refreshing
    // Gold"), so the name has to match exactly rather than by containment.
    // Today's progress is the tile's metadata line ("Search: 1/1"); the prefix
    // is the dashboard's wording, not the stat's, so only the "X/Y" survives.
    function activityValue(name) {
      const wanted = String(name).trim().toLowerCase();
      const bars = Array.from(document.querySelectorAll('[role="progressbar"]'));
      const bar = bars.find(
        el => (el.getAttribute("aria-label") || "").trim().toLowerCase() === wanted
      );
      if (!bar) return null;

      const scope = bar.closest("button") || bar;
      const line = Array.from(scope.querySelectorAll("span")).find(el =>
        /^[a-z' -]+:\s*\d+\s*\/\s*\d+$/i.test(textOf(el))
      );
      if (line) {
        const match = textOf(line).match(/\d+\s*\/\s*\d+/);
        if (match) return match[0].replace(/\s+/g, "");
      }

      // No metadata line (renamed markup): the bar's own numbers still say it.
      const now = bar.getAttribute("aria-valuenow");
      const max = bar.getAttribute("aria-valuemax");
      if (now != null && max != null) return `${now}/${max}`;
      return null;
    }

    // The Earn page's streak cards sit in a react-aria Disclosure that can
    // load collapsed — and a collapsed panel renders no cards at all. Same
    // move as the keep-earning step's expandIfCollapsed, one shot: click the
    // section's own toggle. The toggle is identified structurally — a button
    // whose aria-controls points at a .react-aria-DisclosurePanel and whose
    // label says "streaks" — because the "About Streaks" info button next to
    // it also carries aria-expanded="false" and must not be the one clicked.
    function streaksToggles() {
      return Array.from(
        document.querySelectorAll("button[aria-controls]")
      ).filter(el => {
        const label = el.getAttribute("aria-label") || textOf(el) || "";
        if (!label.toLowerCase().includes("streak")) return false;
        const panel = document.getElementById(
          el.getAttribute("aria-controls") || ""
        );
        return !!panel && panel.classList.contains("react-aria-DisclosurePanel");
      });
    }

    // A press the way a real mouse delivers it: pointerdown, pointerup, click,
    // with the button's own center as the coordinates. Added for the live
    // 2026-09-05 failure the dump caught — twelve retried clicks on the
    // tile and the flyout never opened. react-aria's usePress answers a
    // bare element.click() as a "virtual" press (click detail 0 — its own
    // source says so), but the live tile runs custom code on a newer React
    // build than any capture, and something there does not honor the
    // virtual path. The pointer pair carries a real mouse pointerType, so a
    // pointer-guarded handler registers it too; usePress turns the full
    // sequence into exactly one onPress (its 80 ms self-click fallback is
    // cancelled by the click we dispatch), and the trailing element.click()
    // keeps click-only handlers (every static fixture) working.
    function pressButton(el) {
      const rect = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        composed: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      };
      if (typeof PointerEvent === "function") {
        // Non-zero size and pressure matter: react-aria reads a zero-sized
        // pointer event as a screen-reader tap and ignores the sequence.
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...at,
            buttons: 1,
            width: 1,
            height: 1,
            pressure: 0.5
          })
        );
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            ...at,
            buttons: 0,
            width: 1,
            height: 1,
            pressure: 0
          })
        );
      }
      el.click();
    }

    // The evidence for the next live miss: how many presses were made on the
    // points card, whether the card ever answered (aria-expanded flips to
    // "true" and aria-controls appears when the flyout opens — even briefly),
    // and the tab's visibility at the last press. Lives on window so the
    // caller's dump injection — a separate executeScript in this same
    // isolated world — can read it after the read resolves. everExpanded
    // true + expanded false at dump time means the flyout opened and then
    // closed again; presses > 0 with both false means the press never
    // registered at all — and pressVisibility=visible with both false would
    // prove the press is being ignored, not lost (an untrusted-event guard).
    const pressLog = {
      presses: 0,
      everExpanded: false,
      everControlled: false,
      visibility: ""
    };

    // A click that lands flips the toggle's aria-expanded — the page's own
    // answer to "did that work?" — so a registered click is never repeated
    // (re-clicking an open disclosure would collapse it again). But a click
    // fired into a not-yet-hydrated tree is swallowed and the attribute stays
    // "false", so the reader retries at most every 1 s — the same lost-click
    // recovery as the claim tile (ADR-010 §1).
    let lastStreaksClickAt = 0;
    function expandStreaksIfCollapsed() {
      const toggle = streaksToggles().find(
        el => el.getAttribute("aria-expanded") === "false"
      );
      if (!toggle || typeof toggle.click !== "function") return;
      if (Date.now() - lastStreaksClickAt < 1000) return;
      lastStreaksClickAt = Date.now();
      pressButton(toggle);
    }

    // The breakdown opens as a MODAL flyout — the live capture (html2.html,
    // 2026-09-05) shows the page shell going inert while it is open — and a
    // click on an inert element never fires. The Streaks disclosure's own
    // click must therefore land first. A collapsed not-yet-clicked toggle on
    // the page makes this poll wait (expandStreaksIfCollapsed runs first in
    // poll(), so the retry usually passes on the very next line); a toggle
    // that has not RENDERED yet cannot be waited on directly — the streaks
    // section streams after the tile in the RSC payload — so a streaks-mode
    // read gives it a 1s head start. The dashboard read has no streaks
    // section at all and never waits.
    function streaksResolvedBeforeFlyout() {
      if (lastStreaksClickAt) return true; // a click is registered — done
      const toggles = streaksToggles();
      if (toggles.some(el => el.getAttribute("aria-expanded") !== "false")) {
        return true; // already open — nothing left to click
      }
      if (toggles.length) return false; // collapsed and unclickable: never mind
      return waitMode !== "streaks" || Date.now() - startedAt > 1000;
    }

    // The Today's points card's breakdown, same retry move: the card is its
    // own toggle (a button carrying aria-expanded, per the captures), and the
    // breakdown flyout only renders once it opens. Only a collapsed BUTTON is
    // ever clicked — a card that renders as an anchor navigates instead of
    // disclosing, and must be left alone — and only while it is still
    // collapsed: a click that landed flips aria-expanded, and re-clicking an
    // open tile would toggle the flyout shut. The retry exists because the
    // one-shot version was the live "it shows —" bug (2026-09-05): the read's
    // single click fired before React hydrated the button, was swallowed, and
    // the flyout never opened — the stat then honestly read null. The
    // timestamp of the last click feeds the read's completion window
    // (complete() below).
    let lastPointsClickAt = 0;
    let expandedPointsAt = 0;
    function expandPointsBreakdownIfCollapsed() {
      if (!streaksResolvedBeforeFlyout()) return;
      const card = findPointsCard();
      if (!card) return;
      if (card.tagName !== "BUTTON") return;
      if (card.getAttribute("aria-expanded") !== "false") return;
      if (typeof card.click !== "function") return;
      if (Date.now() - lastPointsClickAt < 1000) return;
      lastPointsClickAt = Date.now();
      expandedPointsAt = Date.now();
      pressLog.presses++;
      pressLog.visibility = document.visibilityState;
      pressButton(card);
    }

    function readAll() {
      return {
        // The card first (old design); the header pill answers the redesign
        // (the Available points card is gone — headerPointsBalance).
        availablePoints: cardValue("available points") || headerPointsBalance(),
        readyToClaim: cardValue("ready to claim"),
        dailyStreak: cardValue("daily streak"),
        // The star count is the redesigned card's own progress read; the
        // older gradient-clipped "1,000 pts" card answers on the old design.
        stampBonus: stampBonusStars() || stampBonusValue(),
        // The search-points cap from the Today's points breakdown — read
        // best-effort, never blocking on its own (the window lives in
        // complete()).
        searchPoints: searchPointsValue(),
        activities: {
          // Streak cards first (they say how many days the streak has run —
          // what the stat means); the progressbar tiles are the fallback.
          bingSearch: streakCardValue(/bing search/i) || activityValue("bing"),
          dailySet: streakCardValue(/daily set/i) || activityValue("daily set"),
          bingApp:
            streakCardValue(/(bing|mobile) app/i) || activityValue("mobile app"),
          visualSearch:
            streakCardValue(/visual search/i) ||
            activityValue("visual search")
        }
      };
    }

    // Keep polling until the half this read is waiting for answers — the
    // values render after "complete". "Ready to claim" and "Stamp bonus" are
    // read but never waited for: the claim tile legitimately stays absent when
    // nothing is pending, and waiting on it would burn the whole timeout on a
    // healthy page. The points breakdown gets a window instead — but the
    // give-up bound only applies while the tile still shows the click did not
    // land (collapsed): once the tile shows OPEN, the panel is the page's own
    // pending state — a slow breakdown stream is a delay, not a miss (proven
    // 2026-09-05: a table rendering 3 s after a landed click read null under
    // the flat 2.5 s bound, the live "it doesn't work" report) — so the read
    // then waits for it up to the same deadline every other value gets (and
    // the caller dumps the panel's markup if even that runs out).
    function complete(stats) {
      const cardsAnswered =
        stats.availablePoints != null && stats.dailyStreak != null;
      const streaksAnswered = Object.values(stats.activities).every(
        value => value != null
      );
      let breakdownAnswered = stats.searchPoints != null;
      if (!breakdownAnswered && expandedPointsAt) {
        const card = findPointsCard();
        const landed =
          !!card && card.getAttribute("aria-expanded") === "true";
        if (!landed && Date.now() - expandedPointsAt > 2500) {
          breakdownAnswered = true; // the click never landed — stop waiting
        }
      } else if (!breakdownAnswered) {
        breakdownAnswered = true; // never clicked: no card, or not a button
      }
      if (waitMode === "cards") return cardsAnswered && breakdownAnswered;
      if (waitMode === "streaks") return streaksAnswered && breakdownAnswered;
      return cardsAnswered && streaksAnswered && breakdownAnswered;
    }

    function poll() {
      // Before each read: a collapsed Streaks disclosure is worth clicking
      // (a collapsed panel renders none of the cards we are after) — and so
      // is the Today's points card's collapsed breakdown. The ORDER is
      // load-bearing: the breakdown's flyout is modal (the shell goes inert),
      // so the streaks click must land first — see
      // streaksResolvedBeforeFlyout.
      expandStreaksIfCollapsed();
      expandPointsBreakdownIfCollapsed();

      // The press log watches every poll, so a flyout that opens and closes
      // again between polls still leaves its trace (everExpanded). Pinned to
      // window for the caller's dump injection — see pressLog above.
      const watchedCard = findPointsCard();
      if (watchedCard) {
        if (watchedCard.getAttribute("aria-expanded") === "true") {
          pressLog.everExpanded = true;
        }
        if (watchedCard.getAttribute("aria-controls") != null) {
          pressLog.everControlled = true;
        }
        window.__meowPointsPress = pressLog;
      }

      let stats;
      try {
        stats = readAll();
      } catch (e) {
        // Never throw to the caller: an unreadable page reports its misses.
        console.warn("Stats: read failed:", e);
        stats = emptyStats();
      }

      if (complete(stats) || Date.now() >= deadline) {
        resolve(stats);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
  });
}

// Combines the two page reads behind the stats panel: the dashboard's and the
// Earn page's. The 2026-09 redesign split them (the user confirmed
// 2026-09-03): the dashboard keeps the top cards (Available points, Ready to
// claim, Daily streak) and the stamp bonus card, while the four streak cards
// live only on the Earn page. The top cards keep the dashboard's answer; the
// four activity keys take the Earn page's (its streak cards carry both
// values, the dashboard's old tiles only the progress half); the stamp bonus
// takes whichever answer is the star count ("11/12") over the older "1,000
// pts" read. In every case a page that failed to load, or a reader that
// found nothing on it, never erases what the other page did find. Pure on
// purpose: the popup tests exercise it against the captured fixtures.
function mergeStats(dashboard, earn) {
  const a = dashboard || {};
  const b = earn || {};

  function firstNonNull(key, left, right) {
    if (left[key] != null) return left[key];
    if (right[key] != null) return right[key];
    return null;
  }

  const activities = {};
  const aActs = a.activities || {};
  const bActs = b.activities || {};
  // The activities are the one pair where the EARN read (b) wins: its streak
  // cards carry both values ("Day 4 of 7 · 1/1"), while the dashboard's
  // progressbar tiles only ever answer the progress half ("1/1") — with
  // dashboard-first order the tiles' shorter answer shadowed the richer Earn
  // value (exactly what the user's first live run of the two-page read
  // showed: every streak displayed "1/1" with no day count). The tiles
  // remain the fallback for an Earn page that renders no cards.
  for (const key of ["bingSearch", "dailySet", "bingApp", "visualSearch"]) {
    activities[key] = firstNonNull(key, bActs, aActs);
  }

  // The stamp bonus follows the same rule by VALUE, not by page: a
  // slash-shaped answer ("11/12") is the redesigned star count the user
  // asked for, while "1,000 pts" is the older card's points read — the
  // dashboard still answers the old shape, and dashboard-first order showed
  // "1,000 pts" instead of the lit-star count on the user's live run.
  function pickStampBonus() {
    const isStarCount = v => typeof v === "string" && /^\d+\/\d+$/.test(v);
    if (isStarCount(a.stampBonus)) return a.stampBonus;
    if (isStarCount(b.stampBonus)) return b.stampBonus;
    return firstNonNull("stampBonus", a, b);
  }

  return {
    availablePoints: firstNonNull("availablePoints", a, b),
    readyToClaim: firstNonNull("readyToClaim", a, b),
    dailyStreak: firstNonNull("dailyStreak", a, b),
    stampBonus: pickStampBonus(),
    // The search-points cap: both pages can carry the Today's points card,
    // and both answers are today's truth — whichever page's breakdown
    // answered wins, a miss never erasing the other page's find.
    searchPoints: firstNonNull("searchPoints", a, b),
    activities
  };
}

// Phase 1 of the redeem watch: types the query into the page's own search box
// and submits. The authenticated page's box is unknown to us — the
// unauthenticated capture renders no input at all, only a "Search"-labeled
// anchor that navigates to the shop — so the box is hunted by selector and by
// label (English or Arabic), and that trigger is clicked once if no box shows
// up on its own. Resolves true once the query is submitted, false when no box
// ever appeared — the caller then reads the catalog page as-is. Runs in the
// page, so it cannot reference anything outside itself.
//
// The native value-setter below is the trick from
// performHumanTypedSearchOnBing: the catalog is a React app, and assigning
// .value directly bypasses the property setter React hooks, so the page's
// state would never see the query.
function searchRedeemFor(query, timeoutMs) {
  return new Promise(resolve => {
    const POLL_INTERVAL_MS = 500;
    const TRIGGER_AFTER_MS = 3000;

    const waitMs = Math.max(1000, Number(timeoutMs) || 12000);
    const deadline = Date.now() + waitMs;

    // Covers both languages the session may render in.
    const SEARCH_LABEL = /search|بحث/i;

    function findSearchBox() {
      const byType = document.querySelector(
        'input[type="search"], input[role="searchbox"], input[name="q"]'
      );
      if (byType) return byType;
      return (
        Array.from(document.querySelectorAll("input")).find(
          el =>
            SEARCH_LABEL.test(el.getAttribute("aria-label") || "") ||
            SEARCH_LABEL.test(el.getAttribute("placeholder") || "")
        ) || null
      );
    }

    // The toolbar trigger that opens the search UI. Matched on aria-label
    // only — a text match would fire on nav links and headings that merely
    // mention the word "search".
    function findSearchTrigger() {
      return (
        Array.from(
          document.querySelectorAll('button, a, [role="button"]')
        ).find(el => SEARCH_LABEL.test(el.getAttribute("aria-label") || "")) ||
        null
      );
    }

    function submit(input) {
      const form = input.form;
      const button =
        form &&
        form.querySelector('input[type="submit"], button[type="submit"], button');
      if (button) {
        button.click();
        return;
      }
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return;
      }
      // No form at all: the page listens for Enter on the input itself.
      ["keydown", "keypress", "keyup"].forEach(type => {
        input.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
      });
    }

    let triggerClicked = false;

    function poll(startedAt) {
      const input = findSearchBox();

      if (input) {
        const nativeValue = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value"
        );
        if (nativeValue && nativeValue.set) nativeValue.set.call(input, String(query));
        else input.value = String(query);
        input.focus();
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: String(query)
          })
        );
        submit(input);
        resolve(true);
        return;
      }

      // No box yet: after a short grace, open the search UI once — the
      // catalog only mounts its box after the trigger is clicked.
      if (!triggerClicked && Date.now() - startedAt >= TRIGGER_AFTER_MS) {
        const trigger = findSearchTrigger();
        if (trigger && typeof trigger.click === "function") {
          triggerClicked = true;
          trigger.click();
        }
      }

      if (Date.now() >= deadline) {
        console.warn("Redeem watch: no search box found on the page.");
        resolve(false);
        return;
      }
      setTimeout(() => poll(startedAt), POLL_INTERVAL_MS);
    }

    poll(Date.now());
  });
}

// Phase 2 of the redeem watch: scans the page for catalog cards matching the
// query and resolves [{ title, points, available, href }] for each. The card
// structure comes from the real /redeem markup: an <a> (class includes
// group/ctrl) holding the title in a p.line-clamp-2 (mirrored in the img alt),
// the price in a p.text-itemHeader beside a unit p.text-legal. The product
// name is matched on the query's first word — see REDEEM_QUERY — tested
// case-insensitively against both title and alt, which covers the Arabic
// title too ("الرمز الرقمي لعملات Overwatch المعدنية" keeps "Overwatch"
// verbatim). Runs in the page, so it cannot reference anything outside
// itself; same polling idiom as readRewardsStats, because the search results
// render after "complete".
//
// available is the heuristic described in checkRedeemAvailability(): false on
// an explicit disabled control or out-of-stock text, true for a
// normal-looking card (sku link + price), null when the markup gives no
// signal — and then OVERRIDDEN by the RSC item payload when it knows the sku
// (the same payload readRedeemVariants keys by denomination, here keyed by
// sku id): a sold-out tile looks perfectly normal on the catalog too
// (verbatim capture 2026-09-03: …004 at 4,800 pts shows a price, no CTA, no
// progress bar, and no disabled markup — only its payload entry says
// "isDisabled": true). Any null card is dumped to console.warn so the first
// real logged-in run reveals the actual stock markup; so is the page's main
// content when nothing matched at all, so we can see what the search actually
// rendered.
function readRedeemOptions(query, timeoutMs) {
  return new Promise(resolve => {
    const POLL_INTERVAL_MS = 500;

    const waitMs = Math.max(1000, Number(timeoutMs) || 12000);
    const deadline = Date.now() + waitMs;

    const textOf = el => (el.textContent || "").replace(/\s+/g, " ").trim();

    // The product name: the query's first word long enough to be one. An
    // empty match would make the RegExp match everything, so it guards the
    // whole read instead.
    const words = String(query || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const productWord =
      words.find(word => word.replace(/[^a-z0-9]/g, "").length >= 3) || "";
    const product = new RegExp(
      productWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );

    // Stock markers, English and Arabic.
    const OUT_OF_STOCK = /out of stock|sold out|غير متوفر|نفد/i;

    function isDisabled(el) {
      return (
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("data-disabled")
      );
    }

    // Named so QA can exercise it against the fixture: false = marked sold
    // out, true = a normal-looking card, null = no signal either way.
    function availabilityOf(card) {
      if (isDisabled(card) || OUT_OF_STOCK.test(textOf(card))) return false;
      const href = card.getAttribute("href") || "";
      if (href.includes("redeem/sku") && card.querySelector("p.text-itemHeader")) {
        return true;
      }
      return null;
    }

    // Unauthenticated cards degrade to /auth/login; only real sku links are
    // worth reporting.
    function skuHrefOf(card) {
      const href = card.getAttribute("href") || "";
      return href.startsWith("/redeem/sku/") || href.includes("redeem/sku")
        ? href
        : null;
    }

    // The RSC item payload (see readRedeemVariants' itemStock — same flat
    // escaped-JSON objects, same optional-backslash patterns), keyed by sku
    // id instead of denomination. True = disabled (restocking).
    function itemStockById() {
      const html = document.documentElement.innerHTML;
      const stock = new Map();
      const itemRe = /\{\\?"id\\?":\\?"[^{}]*\}/g;
      let m;
      while ((m = itemRe.exec(html))) {
        const item = m[0];
        const id = item.match(/\\?"id\\?":\\?"([^"\\]+)/);
        if (id) {
          stock.set(id[1], /\\?"isDisabled\\?":true/.test(item));
        }
      }
      return stock;
    }

    function readAll() {
      // Keyed by sku id, NOT title: the Overwatch denominations are sibling
      // tiles that all read "Overwatch Coins Digital Code" — their ids differ
      // only in the last digit (…003 = 1,800 pts, …004 = 4,800, …005 =
      // 9,800), so a title key would collapse them into one row. The same
      // sku also renders more than once (an unpriced carousel tile and the
      // priced result tile); among those, the occurrence carrying the price
      // wins. The query string is dropped from the key so "?fallback=…"
      // duplicates resolve to the same sku.
      const bySku = new Map();
      const stockById = itemStockById();

      Array.from(document.querySelectorAll("a")).forEach(card => {
        const titleEl = card.querySelector("p.line-clamp-2");
        const img = card.querySelector("img[alt]");
        const alt = img ? img.alt : "";
        const title = titleEl ? textOf(titleEl) : alt;
        if (!product.test(title) && !product.test(alt)) return;

        const skuHref = skuHrefOf(card);
        const pointsEl = card.querySelector("p.text-itemHeader");
        const points = pointsEl ? textOf(pointsEl) : null;

        const key = (skuHref || "t:" + title.toLowerCase()).replace(/\?.*$/, "");
        const prev = bySku.get(key);
        if (prev && (prev.points || !points)) return;

        // Payload first (it is the page's own stock truth), tile heuristic
        // when the payload doesn't know the sku.
        let available = availabilityOf(card);
        const skuId = skuHref ? skuHref.match(/(\d+)/) : null;
        if (skuId && stockById.has(skuId[1])) {
          available = !stockById.get(skuId[1]);
        }

        bySku.set(key, {
          title,
          points,
          available,
          href: skuHref ? key : null
        });
      });

      return [...bySku.values()];
    }

    function poll() {
      let options;
      try {
        options = readAll();
      } catch (e) {
        // Never throw to the caller: an unreadable page reports nothing.
        console.warn("Redeem watch: read failed:", e);
        options = [];
      }

      if (options.length || Date.now() >= deadline) {
        // The ADR-010 dump travels back WITH the result ({ list, dump }): the
        // read tab is a background tab nobody can open devtools on, so a
        // console.warn there is evidence nobody sees. The service worker
        // relays the dump into the popup's Activity card.
        let dump = "";
        if (!options.length) {
          const main = document.querySelector("main") || document.body;
          dump = main ? main.outerHTML.slice(0, 1500) : "";
          console.warn("Redeem page markup (report to dev):", dump);
        }
        resolve({ list: options, dump });
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    if (!productWord) {
      // No usable keyword: matching everything would be worse than nothing.
      resolve({ list: [], dump: "" });
      return;
    }

    poll();
  });
}

// Phase 3 of the redeem watch: reads the sku DETAIL page — the page a catalog
// card leads to — and resolves [{ label, available }] for every variant the
// product is offered in (the "select option" under the details: each
// denomination of the Overwatch coins digital code, one row per option). The
// real page (verbatim capture 2026-09-03, overwatch-redeem-page.html) has no
// select and no listbox: the amounts are plain buttons ("500 coins", "1000
// coins"), so the reader tries native <select> options first, react-aria
// listboxes ([role="option"]) second, and the coin buttons third. When none is
// found the page's main markup goes to console.warn (ADR-010) so the first
// real run refines the selectors.
//
// available, in order of authority (the capture's lesson: the coin buttons
// are ALWAYS enabled — sold-out-ness lives elsewhere entirely):
// 1. the RSC item payload embedded in the page's <script>s — flat escaped-JSON
//    objects, one per sku, whose "isDisabled": true marks exactly the
//    restocking amounts ("500 coins" in the capture; "1000 coins" carries
//    isDisabled:"$undefined"). Locale-independent, and it covers every
//    amount, not just the selected one.
// 2. the restocking note — the i18n "notAvailable" string ("So popular we're
//    restocking! Back soon!") rendered as a danger-tinted <p> beside the
//    Redeem button, but only for the amount currently selected, so it can
//    only ever condemn the pressed button.
// 3. the old heuristics — a disabled control or an out-of-stock label
//    (English or Arabic). No signal like that exists on the real page's
//    buttons; kept for markup drift.
function readRedeemVariants(timeoutMs) {
  return new Promise(resolve => {
    const POLL_INTERVAL_MS = 500;

    const waitMs = Math.max(1000, Number(timeoutMs) || 12000);
    const deadline = Date.now() + waitMs;

    const textOf = el => (el.textContent || "").replace(/\s+/g, " ").trim();

    // Stock markers, English and Arabic — same set as the catalog reader.
    const OUT_OF_STOCK = /out of stock|sold out|غير متوفر|نفد/i;

    // Coin-amount buttons on the sku detail page: "500 coins", "1000 coins".
    // Anchored at both ends so the points balance ("5,113") and "Redeem now"
    // can't match.
    const COIN_AMOUNT = /^\d[\d.,]*\s+coins?$/i;

    function isDisabled(el) {
      return (
        (el.tagName === "OPTION" && el.disabled) ||
        el.getAttribute("aria-disabled") === "true" ||
        el.hasAttribute("data-disabled")
      );
    }

    // The selected coin button: react-aria's toggle state. The capture shows
    // aria-pressed="true" data-selected="true" on the chosen amount.
    function isSelected(el) {
      return (
        el.getAttribute("aria-pressed") === "true" ||
        el.hasAttribute("data-selected")
      );
    }

    // Authority 1: the RSC item payload. The objects are flat (no nested
    // braces), so this regex can't overrun an item's end; the backslash is
    // optional in every pattern because the payload is escaped JSON in the
    // capture but an unescaped variant must still parse. Keyed by lowercase
    // denomination title; disabled=true means restocking. The href is the
    // amount's OWN sku page (…004 = 500 coins, …005 = 1000 coins in the
    // capture): the navigate-only Redeem button opens it so the page arrives
    // with that amount already selected.
    function itemStock() {
      const html = document.documentElement.innerHTML;
      const stock = new Map();
      const itemRe = /\{\\?"id\\?":\\?"[^{}]*\}/g;
      let m;
      while ((m = itemRe.exec(html))) {
        const item = m[0];
        const denom = item.match(/\\?"denominationTitle\\?":\\?"([^"\\]+)/);
        if (denom) {
          const href = item.match(/\\?"href\\?":\\?"([^"\\]+)/);
          stock.set(denom[1].toLowerCase(), {
            disabled: /\\?"isDisabled\\?":true/.test(item),
            href: href ? href[1] : ""
          });
        }
      }
      return stock;
    }

    // Authority 2: the restocking note. Matched by its danger-tint class
    // (locale-independent — the text itself is translated) or, as a fallback,
    // by the English wording.
    function restockingNoteVisible() {
      return Array.from(document.querySelectorAll("p")).some(p => {
        const cls = typeof p.className === "string" ? p.className : "";
        return (
          cls.includes("statusDangerTint") ||
          /restocking|back soon/i.test(p.textContent || "")
        );
      });
    }

    // Named so QA can exercise it against a fixture.
    function variantOf(el) {
      const label = textOf(el);
      // Placeholder options ("Choose an option…") carry no label worth
      // reporting; an empty match means the same.
      if (!label) return null;
      const available = !(isDisabled(el) || OUT_OF_STOCK.test(label));
      return { label, available };
    }

    function readAll() {
      const seen = new Set();
      const variants = [];

      const push = el => {
        const variant = variantOf(el);
        if (!variant) return;
        // The same denomination can render twice (e.g. hidden duplication in
        // the markup); dedupe on the label, first occurrence wins.
        const key = variant.label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        variants.push(variant);
      };

      // 1. A native <select> — the classic variant picker.
      Array.from(document.querySelectorAll("select")).forEach(select => {
        Array.from(select.options || []).forEach(push);
      });

      // 2. Custom listboxes (react-aria renders [role="option"]).
      if (!variants.length) {
        document.querySelectorAll('[role="option"]').forEach(push);
      }

      // 3. Button pickers — the real sku page's markup (verbatim capture
      //    2026-09-03). Matched by label so nothing else on the page
      //    ("Redeem now", nav links, the points balance) can slip in. A bare
      //    [aria-selected] sweep is deliberately NOT a strategy: on the same
      //    page it matches the site's nav tabs (Dashboard / Earn / Redeem /
      //    About / Refer) and reports them as options — that exact bug, seen
      //    in the capture. Availability follows the authority chain in the
      //    reader's doc comment: payload, then note (selected button only),
      //    then the attribute heuristics.
      if (!variants.length) {
        const stock = itemStock();
        const restocking = restockingNoteVisible();
        const buttons = [];

        Array.from(
          document.querySelectorAll('button, [role="button"]')
        ).forEach(btn => {
          if (!COIN_AMOUNT.test(textOf(btn))) return;
          const label = textOf(btn);
          const item = stock.get(label.toLowerCase());
          let available = !(isDisabled(btn) || OUT_OF_STOCK.test(label));
          if (item) {
            available = !item.disabled;
          } else if (restocking && isSelected(btn)) {
            available = false;
          }
          const key = label.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          // The payload's href rides along when it is known, so the popup's
          // navigate-only Redeem button can open this amount's own sku page;
          // payload-less reads keep the two-field shape (the family page the
          // watch read is the fallback there).
          variants.push(
            item && item.href ? { label, available, href: item.href } : { label, available }
          );
          buttons.push(btn);
        });

        // Dump contract (ADR-010): buttons but no readable payload means
        // availability came from the weakest authority — say so.
        if (buttons.length && !stock.size) {
          console.warn(
            "Redeem variants: coin buttons found but no item payload (report to dev)."
          );
        }
      }

      return variants;
    }

    function poll() {
      let variants;
      try {
        variants = readAll();
      } catch (e) {
        // Never throw to the caller: an unreadable page reports nothing.
        console.warn("Redeem watch: variant read failed:", e);
        variants = [];
      }

      if (variants.length || Date.now() >= deadline) {
        // Same { list, dump } contract as readRedeemOptions: the dump rides
        // back with the result so the popup's Activity row can carry it.
        let dump = "";
        if (!variants.length) {
          const main = document.querySelector("main") || document.body;
          dump = main ? main.outerHTML.slice(0, 1500) : "";
          console.warn("Redeem detail page markup (report to dev):", dump);
        }
        resolve({ list: variants, dump });
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
  });
}

// Injected into the sku detail page by redeemOverwatchCoins(): picks the
// chosen variant in the page's own picker (a native <select> via its value
// setter + a change event, a click on the matching react-aria option, or a
// click on the matching coin button), then presses the page's Redeem
// button. On the per-denomination sku pages the wanted amount usually
// arrives already selected, so the picker half is mostly a no-op there and
// matters for the family-page fallback. Resolves { selected, clicked,
// reason } so the caller can say which half failed.
//
// The disabled-Redeem case has two very different causes on the real page
// (verbatim captures 2026-09-03): the amount is sold out — the restocking
// note is showing — or the balance can't cover it. Both leave the button
// disabled with a variant selected, so the poll loop watches for exactly
// that pair and resolves with the cause instead of grinding to "timed out".
// The dump contract still covers a true timeout: the page's main markup
// goes to console.warn. Runs in the page, so it cannot reference anything
// outside itself.
//
// Matches on trimmed, whitespace-normalized text because the label came from
// this same page's option list (readRedeemVariants textOf) — it round-trips
// byte-for-byte unless the page re-rendered between the reads.
function redeemOnDetailPage(label, timeoutMs) {
  return new Promise(resolve => {
    const POLL_INTERVAL_MS = 500;

    const waitMs = Math.max(1000, Number(timeoutMs) || 12000);
    const deadline = Date.now() + waitMs;

    const textOf = el => (el.textContent || "").replace(/\s+/g, " ").trim();

    // "Redeem now" in an English session; "استرد" covers the Arabic verb's
    // forms. Buttons/role=button/submit only — matching anchors too would
    // fire on the nav's "Redeem" tab link.
    const REDEEM_BUTTON = /redeem|استرد/i;

    // Coin-amount buttons ("500 coins"), the real sku page's picker — must
    // stay in step with the same pattern in readRedeemVariants.
    const COIN_AMOUNT = /^\d[\d.,]*\s+coins?$/i;

    const wanted = String(label || "").trim().toLowerCase();

    function isWanted(el) {
      return Boolean(wanted) && textOf(el).trim().toLowerCase() === wanted;
    }

    // The restocking note — the page's own "sold out" for the selected
    // amount (i18n notAvailable, a danger-tinted <p>). Class-matched so an
    // Arabic session reads the same way; the English wording is the
    // fallback. Same logic as readRedeemVariants' restockingNoteVisible.
    function restockingNoteVisible() {
      return Array.from(document.querySelectorAll("p")).some(p => {
        const cls = typeof p.className === "string" ? p.className : "";
        return (
          cls.includes("statusDangerTint") ||
          /restocking|back soon/i.test(p.textContent || "")
        );
      });
    }

    // Returns true when the picker holds the wanted variant. A page with no
    // picker at all (a single-variant sku shows none) counts as selected —
    // there is nothing to choose, the Redeem button is the only control.
    function selectVariant() {
      const selects = Array.from(document.querySelectorAll("select"));
      for (const select of selects) {
        const options = Array.from(select.options || []);
        if (!options.length) continue;
        const option = options.find(isWanted);
        if (!option) continue;
        const nativeValue = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(select),
          "value"
        );
        if (nativeValue && nativeValue.set) nativeValue.set.call(select, option.value);
        else select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      const customOptions = Array.from(
        document.querySelectorAll('[role="option"]')
      );
      const option = customOptions.find(isWanted);
      if (option && typeof option.click === "function") {
        option.click();
        return true;
      }

      // Button pickers (the real sku page): click the wanted amount — but
      // only if it isn't already the selected one; these are toggle buttons,
      // and a second click would DEselect it (the poll loop re-runs this
      // while waiting for the Redeem button to enable). The Redeem-now
      // button only enables after a choice, so the poll loop below finds it
      // on the next pass once React re-renders.
      const coinButtons = Array.from(
        document.querySelectorAll('button, [role="button"]')
      ).filter(btn => COIN_AMOUNT.test(textOf(btn)));
      if (coinButtons.length) {
        const match = coinButtons.find(isWanted);
        if (!match) return false;
        const alreadySelected =
          match.getAttribute("aria-pressed") === "true" ||
          match.hasAttribute("data-selected");
        if (!alreadySelected && typeof match.click === "function") {
          match.click();
          return true;
        }
        // Already the page's selection: nothing to click, the variant IS
        // picked — the poll loop is only waiting for the Redeem button.
        return alreadySelected;
      }

      // No picker of any kind: a single-variant sku shows none.
      return selects.length === 0 && customOptions.length === 0;
    }

    function findRedeemButton() {
      return (
        Array.from(
          document.querySelectorAll('button, [role="button"], input[type="submit"]')
        ).find(el => {
          if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
          const name =
            textOf(el) || el.getAttribute("aria-label") || el.value || "";
          return REDEEM_BUTTON.test(name);
        }) || null
      );
    }

    // The same button in ANY state — findRedeemButton above is for pressing;
    // this one answers "does a Redeem control exist that refuses to fire?".
    function findAnyRedeemButton() {
      return (
        Array.from(
          document.querySelectorAll('button, [role="button"], input[type="submit"]')
        ).find(el => {
          const name =
            textOf(el) || el.getAttribute("aria-label") || el.value || "";
          return REDEEM_BUTTON.test(name);
        }) || null
      );
    }

    // When the selection is registered but the Redeem button never enables,
    // this is when the stall started — the poll loop gives React a beat (the
    // enable may land in a later commit than the selection) before calling
    // the stall a verdict.
    let stalledSince = 0;

    function poll() {
      if (Date.now() >= deadline) {
        const main = document.querySelector("main") || document.body;
        console.warn(
          "Redeem page markup (report to dev):",
          main ? main.outerHTML.slice(0, 1500) : ""
        );
        resolve({ selected: false, clicked: false, reason: "timed out" });
        return;
      }

      const selected = selectVariant();
      const button = findRedeemButton();
      if (selected && button) {
        button.click();
        resolve({ selected: true, clicked: true });
        return;
      }
      if (!selected && button) {
        // A Redeem button but no matching variant: pressing it would redeem
        // whatever the page has selected instead — refuse and say so.
        resolve({
          selected: false,
          clicked: false,
          reason: `variant "${label}" not found in the picker`
        });
        return;
      }
      // Selected (or nothing to select) and no pressable Redeem button, yet
      // one EXISTS: the page is refusing. Either the amount is sold out (the
      // restocking note is showing) or the balance can't cover it — say
      // which, after the settle window above rules out a late enable.
      if (selected && findAnyRedeemButton()) {
        stalledSince = stalledSince || Date.now();
        if (Date.now() - stalledSince >= 1200) {
          resolve({
            selected: true,
            clicked: false,
            reason: restockingNoteVisible()
              ? `"${label}" is sold out — the page says it's restocking`
              : `"${label}": the Redeem button stayed disabled (not enough points?)`
          });
          return;
        }
      } else {
        stalledSince = 0;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
  });
}

// ---------- Text search logic ----------

// Topic pool for the search queries. Doubles as the seed pool for Bing
// autosuggest, so it lives at module scope instead of inside one function.
const QUERY_SEED_TOPICS = [
  "machine learning",
  "react typescript",
  "node js backend",
  "virtual reality games",
  "linux customization",
  "anime recommendations",
  "competitive gaming strategies",
  "cloud hosting tutorials",
  "saudi arabia technology",
  "data structures algorithms",
  "kubernetes networking",
  "rust programming",
  "home coffee brewing",
  "electric vehicle batteries",
  "astrophotography setup",
  "mechanical keyboards",
  "indoor plant care",
  "personal finance budgeting",
  "photography composition",
  "docker compose",
  "postgres performance tuning",
  "3d printing materials",
  "language learning methods",
  "desert hiking trails"
];

function randomSeedWord() {
  return QUERY_SEED_TOPICS[Math.floor(Math.random() * QUERY_SEED_TOPICS.length)];
}

function generateFallbackQuery() {
  const verbs = [
    "guide",
    "tips",
    "best practices",
    "tutorial",
    "examples",
    "resources",
    "introduction",
    "advanced concepts",
    "common mistakes",
    "comparison",
    "checklist",
    "walkthrough"
  ];

  const extras = [
    "2026",
    "for beginners",
    "step by step",
    "for professionals",
    "free course",
    "documentation",
    "full explanation",
    "explained simply",
    "with examples",
    "cheat sheet",
    "from scratch",
    "real world cases"
  ];

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(QUERY_SEED_TOPICS)} ${pick(verbs)} ${pick(extras)}`;
}

// Bing does not credit very long queries reliably, and typing them out is slow.
function trimQuery(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_QUERY_LEN) return clean;

  const cut = clean.slice(0, MAX_QUERY_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Query sources, tried in order — same shape as the image chain above: each
// helper either returns { query, api } or throws, and a dead host only costs
// one console.warn before the next source takes over.
async function fetchBingAutosuggestQuery() {
  const res = await fetchWithTimeout(
    `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(randomSeedWord())}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Payload is ["seed", ["suggestion", ...]] — grab a random suggestion.
  const data = await res.json();
  const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const query = trimQuery(
    suggestions[Math.floor(Math.random() * suggestions.length)] || ""
  );
  if (!query) throw new Error("no suggestions");
  return { query, api: "Bing autosuggest" };
}

// Trending searches as RSS, two geos a day (rotated by day parity) so the
// endpoint isn't hit per query. Titles are cached for the local day; a failed
// fetch throws before anything is stored, leaving the cache absent so the
// next query retries.
async function fetchGoogleTrendsQuery() {
  const today = localDayKey();
  const { [TRENDS_CACHE]: cached } = await chrome.storage.local.get(TRENDS_CACHE);

  let titles = Array.isArray(cached && cached.titles) ? cached.titles : [];
  if ((cached && cached.day) !== today || !titles.length) {
    const geos = Number(today.slice(8)) % 2 === 0 ? ["US", "GB"] : ["GB", "CA"];

    titles = [];
    for (const geo of geos) {
      const res = await fetchWithTimeout(
        `https://trends.google.com/trending/rss?geo=${geo}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status} for geo ${geo}`);

      const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
      for (const item of doc.querySelectorAll("item > title")) {
        titles.push(trimQuery(item.textContent));
      }
    }

    titles = [...new Set(titles.filter(Boolean))];
    if (!titles.length) throw new Error("no trending titles");

    await chrome.storage.local.set({ [TRENDS_CACHE]: { day: today, titles } });
  }

  return {
    query: titles[Math.floor(Math.random() * titles.length)],
    api: "Google Trends"
  };
}

async function fetchWikipediaQuery() {
  const res = await fetchWithTimeout(
    "https://en.wikipedia.org/api/rest_v1/page/random/summary"
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // The whole extract is a paragraph; only the first sentence reads as a
  // search query. (The 303 redirect to the page is followed by fetch itself.)
  const data = await res.json();
  const query = trimQuery(String(data.extract || "").split(". ")[0]);
  if (!query) throw new Error("no extract");
  return { query, api: "Wikipedia" };
}

async function fetchUselessFactsQuery() {
  const res = await fetchWithTimeout(
    "https://uselessfacts.jsph.pl/random.json?language=en"
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const query = trimQuery(data.text || "");
  if (!query) throw new Error("no fact text");
  return { query, api: "UselessFacts" };
}

// The local generator can never fail, so it rounds off the chain as a source
// like the others rather than a special case after the loop.
async function generateLocalFallbackQuery() {
  return { query: generateFallbackQuery(), api: "local-fallback" };
}

// The query sources, keyed by the ids stored in settings.querySourceOrder.
// popup.html mirrors these ids in each row's data-source attribute. Each
// helper returns { query, api } or throws — same shape as the image chain
// above: a dead host only costs one console.warn before the next source
// takes over.
const QUERY_SOURCES = {
  bingAutosuggest: { name: "Bing autosuggest", get: fetchBingAutosuggestQuery },
  googleTrends: { name: "Google Trends", get: fetchGoogleTrendsQuery },
  wikipedia: { name: "Wikipedia", get: fetchWikipediaQuery },
  uselessFacts: { name: "UselessFacts", get: fetchUselessFactsQuery },
  local: { name: "local-fallback", get: generateLocalFallbackQuery }
};

// Same tolerance as normalizeStartupOrder: unknown ids and duplicates go, and
// anything missing is slotted into its default position. Mirrored in popup.js.
function normalizeQuerySourceOrder(order) {
  const ids = Object.keys(QUERY_SOURCES);
  const known = Array.isArray(order) ? order.filter(id => ids.includes(id)) : [];
  const merged = [...new Set(known)];

  ids.forEach((id, defaultIndex) => {
    if (!merged.includes(id)) {
      merged.splice(Math.min(defaultIndex, merged.length), 0, id);
    }
  });

  return merged;
}

async function generateMeaningfulQuery() {
  const settings = await getSettings();

  for (const id of normalizeQuerySourceOrder(settings.querySourceOrder)) {
    const source = QUERY_SOURCES[id];
    try {
      const result = await source.get();
      if (result && result.query) return result;
      console.warn(`Query source ${source.name} returned nothing usable.`);
    } catch (e) {
      console.warn(`Query source ${source.name} failed:`, e);
    }
  }

  // Unreachable in practice — "local" is always in the order and never fails —
  // but the caller's contract is { query, api }, not undefined.
  return generateLocalFallbackQuery();
}

// Repeat queries don't earn points, so keep a short history and avoid them.
async function nextQuery() {
  const { recentQueries } = await chrome.storage.local.get("recentQueries");
  const recent = Array.isArray(recentQueries) ? recentQueries : [];

  let chosen = await generateMeaningfulQuery();
  for (let i = 0; i < 5 && recent.includes(chosen.query.toLowerCase()); i++) {
    chosen = await generateMeaningfulQuery();
  }

  const key = chosen.query.toLowerCase();
  await chrome.storage.local.set({
    recentQueries: [key, ...recent.filter(q => q !== key)].slice(
      0,
      RECENT_QUERY_MEMORY
    )
  });

  return chosen;
}

function randomDelayMillis(minSec, maxSec) {
  const min = Number.isFinite(minSec) ? Math.max(0, minSec) : 5;
  const max = Number.isFinite(maxSec) ? Math.max(min, maxSec) : 15;
  const randSec = min + Math.random() * (max - min);
  return randSec * 1000;
}

// Typing search queries inside Bing page.
// Resolves with the real elapsed typing time plus the pre-submit pause, and
// resolves *before* submitting so the pending navigation can't kill the reply.
function performHumanTypedSearchOnBing(query) {
  return new Promise(resolve => {
    const input =
      document.querySelector("#sb_form_q") ||
      document.querySelector('input[name="q"]') ||
      document.querySelector('input[type="search"]');

    if (!input) {
      console.warn("Bing search input not found.");
      resolve(0);
      return;
    }

    const form = document.querySelector("#sb_form") || input.form;
    const button =
      document.querySelector("#sb_form_go") ||
      (form && form.querySelector('input[type="submit"], button'));

    // Assigning .value directly bypasses the property setter that page
    // frameworks hook, so the suggestion UI never sees the input.
    const nativeValue = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    const setValue = v => {
      if (nativeValue && nativeValue.set) nativeValue.set.call(input, v);
      else input.value = v;
    };

    function fireKey(type, ch) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: ch,
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
    }

    function submit() {
      if (button) {
        button.click();
      } else if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } else {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
      }
    }

    function randomCharDelay() {
      const base = 80 + Math.random() * 180;
      const longPause = Math.random() < 0.08 ? 200 + Math.random() * 400 : 0;
      return base + longPause;
    }

    setValue("");
    input.focus();

    const startedAt = performance.now();
    let idx = 0;

    function typeNextChar() {
      if (idx >= query.length) {
        const preSubmitPause = 400 + Math.random() * 800;
        const typedMs = performance.now() - startedAt;

        setTimeout(submit, preSubmitPause);
        resolve(typedMs + preSubmitPause);
        return;
      }

      const ch = query[idx++];

      fireKey("keydown", ch);
      fireKey("keypress", ch);
      setValue(input.value + ch);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: ch
        })
      );
      fireKey("keyup", ch);

      setTimeout(typeNextChar, randomCharDelay());
    }

    typeNextChar();
  });
}
