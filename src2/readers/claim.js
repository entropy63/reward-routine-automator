// The claim flow — the manual popup run and the startup step. Both open the
// Rewards dashboard, inject the page-side claim routine, and report the
// outcome; they differ only in what happens to the tab (the manual run always
// closes its own, the step defers to the tab-close mode and toggle).

import { beginActivity, endActivity, currentStopEpoch } from "../lib/run-state.js";
import { sleep } from "../lib/delays.js";
import { holdKeepAlive, releaseKeepAlive } from "../lib/keepalive.js";
import {
  beginTabCapture,
  claimTab,
  closeCapturedTabs,
  closeTabs,
  endTabCapture,
  waitForTabComplete
} from "../lib/tabs.js";
import { setLastRewards } from "../lib/log.js";
import { getSettings } from "../lib/settings.js";
import { claimDashboardPoints } from "../injections/rewards-tiles.js";
import { REWARDS_DASHBOARD } from "./rewards-section.js";

// How long the page-side claim routine waits for the panel's verdict after
// clicking the claim card before reporting "unknown" — the click may still
// have gone through, so an honest "don't know" beats a false "failed".
const CLAIM_TIMEOUT_MS = 15000;

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
export async function runManualClaim() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned epoch tells this run when it has been stopped.
  const myEpoch = await beginActivity("Claim");
  const stopped = () => currentStopEpoch().then(v => v !== myEpoch);

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
    // (the stop write already wiped the bookkeeping, so this is doubly a
    // no-op after a stop).
    const ids = await endTabCapture("claim");

    if (ids.length && !(await stopped())) {
      const settings = await getSettings();

      // Same shape as closeCapturedTabs()'s tail: the settle wait is long
      // enough that the worker would otherwise be evicted mid-close.
      holdKeepAlive();
      try {
        // Let the panel's success state settle before the tab goes away.
        await sleep(2000);
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
export async function runStartupClaim() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned epoch tells this run when it has been stopped.
  const myEpoch = await beginActivity("Claim");
  const stopped = () => currentStopEpoch().then(v => v !== myEpoch);

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
    // A no-op after a stop: the stop write cleared the capture bookkeeping,
    // so the tab stays open.
    await closeCapturedTabs("claim", "closeTabsAfterClaim");
    await endActivity("Claim");
  }
}
