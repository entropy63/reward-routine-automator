// Tab lifecycle: capture bookkeeping, waiting, reuse, closing, and the
// popup's Clear-tabs sweep.
//
// ---------- Capture bookkeeping ----------
// Each feature records the tabs it opens so it can close them again when it
// finishes. Daily set is the reason this can't just remember one id: clicking
// a tile opens further tabs, so anything created while a feature is
// "capturing" counts as belonging to it. In src-donut this lives inside the
// run-state document (captures.capturing / captures.opened) rather than two
// storage keys of its own — the serialization that made the v1 writes safe
// is updateRunState's promise chain now, and a stop clears the bookkeeping
// as part of the one stop write.

import { readRunState, updateRunState, currentStopEpoch } from "./run-state.js";
import { getSettings } from "./settings.js";
import { holdKeepAlive, releaseKeepAlive } from "./keepalive.js";
import { sleep } from "./delays.js";
import { setLastTabAction, STEP_LABEL } from "./log.js";

// Wired to chrome.tabs.onCreated in background.js (the listener belongs to
// the entry point; this is just the bookkeeping). No-ops unless some step is
// capturing — a tab the user opened by hand is nobody's to close.
export function recordOpenedTab(tabId) {
  return updateRunState(state => {
    if (!state.captures.capturing.length) return;
    for (const stepId of state.captures.capturing) {
      const ids = state.captures.opened[stepId] || [];
      if (!ids.includes(tabId)) state.captures.opened[stepId] = ids.concat(tabId);
    }
  });
}

// A tab we opened ourselves, or an existing one we claimed — ensureBingTab
// can reuse a tab, and a reused tab never fires onCreated.
export function claimTab(stepId, tabId) {
  if (tabId == null) return Promise.resolve();
  return updateRunState(state => {
    const ids = state.captures.opened[stepId] || [];
    if (ids.includes(tabId)) return;
    state.captures.opened[stepId] = ids.concat(tabId);
  });
}

export function beginTabCapture(stepId) {
  return updateRunState(state => {
    if (!state.captures.capturing.includes(stepId)) {
      state.captures.capturing = state.captures.capturing.concat(stepId);
    }
    // A fresh run starts from an empty list; the previous run's tabs were
    // already dealt with, or deliberately left alone.
    state.captures.opened[stepId] = [];
  });
}

// Stops capturing and hands back the tabs collected so far.
export function endTabCapture(stepId) {
  let ids = [];
  const done = updateRunState(state => {
    state.captures.capturing = state.captures.capturing.filter(id => id !== stepId);
    ids = state.captures.opened[stepId] || [];
    delete state.captures.opened[stepId];
  });
  return done.then(() => ids);
}

// ---------- Waiting and reuse ----------

// Resolves true once the tab reports "complete", false on timeout or if the
// tab is gone. The immediate tabs.get covers a tab that finished loading
// before we started listening; the timeout keeps a hung page from stalling
// the step.
export function waitForTabComplete(tabId, timeoutMs = 20000) {
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

// Reuse the previous batch's tab if it is still open, so repeated batches
// don't pile up tabs.
export async function ensureBingTab(existingTabId) {
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

// ---------- Closing ----------

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
      // the extension itself created to host one read tab is allowed to close
      // with its tab — keeping it alive would leave a stray blank window
      // behind, and the keep-alive tab opens ACTIVE, stealing focus.
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

export async function closeTabs(ids, keepPinned) {
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
//
// The epoch is captured at entry so the re-check after the grace sleep can
// tell a real stop from anything else; on the normal path it never moves.
export async function closeCapturedTabs(stepId, enabledKey) {
  const myEpoch = await currentStopEpoch();
  const ids = await endTabCapture(stepId);
  const settings = await getSettings();
  if (!ids.length) return 0;

  if (settings.tabCloseMode === "routine") {
    const state = await readRunState();
    if (state.routine) {
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
    if (graceMs) await sleep(graceMs);
    // A stop during the grace period must not close the tabs out from under
    // it: stopping is not finishing. The tabs stay open with the rest.
    if ((await currentStopEpoch()) !== myEpoch) {
      console.log(`Tab close for "${stepId}" skipped: stopped during the grace period.`);
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

// Read-modify-write behind the run-state chain: steps finish concurrently
// with tabs.onCreated capture.
function stashRoutineTabs(ids) {
  return updateRunState(state => {
    if (!state.routine) return; // stopped in between — the sweep is moot
    state.routine.pendingTabs = [...new Set(state.routine.pendingTabs.concat(ids))];
  });
}

// ---------- Clear tabs (the popup's sweep) ----------

// The finish page the routine opens at sequence end; its tab is exempt from
// the Clear-tabs sweep — the user is the only one who takes it down.
const ROUTINE_DONE_URL = "routine-done.html";

function isRoutineDoneTab(tab) {
  const urls = [tab.pendingUrl, tab.url].filter(Boolean);
  return urls.some(url => url.includes(ROUTINE_DONE_URL));
}

// Opens a fresh tab first, then closes everything else in that window, so the
// window never blinks out of existence.
export async function clearAllTabs(windowId) {
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

  // Those tabs are gone; capture bookkeeping and the routine's stash would
  // close tabs that no longer exist, and a batch pointing at one of them has
  // nothing left to type in.
  await updateRunState(state => {
    state.captures = { capturing: [], opened: {} };
    if (state.routine) state.routine.pendingTabs = [];
    if (state.batch && doomed.includes(state.batch.tabId)) state.batch.tabId = null;
  });

  const pinnedKept = keptOut - existing.filter(isRoutineDoneTab).length;
  await setLastTabAction(
    `Cleared ${doomed.length} tab(s)${pinnedKept > 0 ? `, kept ${pinnedKept} pinned` : ""}`,
    true
  );
  return { ok: true, closed: doomed.length, kept: keptOut };
}
