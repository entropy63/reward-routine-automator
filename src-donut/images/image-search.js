// The image-search step: fetch a random image, open a Bing tab, click the
// visual-search (camera) icon, then hand the upload dialog the image.
//
// Bing renders that dialog inside an iframe, so the file input does not exist
// in the top frame. Phase 1 clicks the icon in the top frame; phase 2 probes
// every frame until one of them exposes an upload target, then hands the
// image to that frame alone.

import { beginActivity, endActivity, currentStopEpoch } from "../lib/run-state.js";
import { sleep } from "../lib/delays.js";
import { beginTabCapture, closeCapturedTabs, claimTab, waitForTabComplete } from "../lib/tabs.js";
import { reportImageSearch } from "../lib/log.js";
import { fetchRandomImageData } from "./sources.js";
import {
  clickVisualSearchButton,
  probeVisualSearchTarget,
  attachRandomImageToVisualSearch
} from "../injections/visual-search.js";

const VISUAL_SEARCH_ATTEMPTS = 24;
const VISUAL_SEARCH_INTERVAL_MS = 500;

export async function runRandomImageSearch() {
  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned epoch tells this run when it has been stopped.
  const myEpoch = await beginActivity("Image search");
  const stopped = () => currentStopEpoch().then(v => v !== myEpoch);

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

    await sleep(VISUAL_SEARCH_INTERVAL_MS);
  }

  await reportImageSearch("failed - no frame exposed a file input", false);
}
