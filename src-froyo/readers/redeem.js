// Reads which Overwatch-coins digital codes the Rewards catalog currently
// offers into LAST_REDEEM: opens /redeem, drives the page's own search box
// with REDEEM_QUERY, then reads the matching catalog cards' title, price and
// stock state. On demand from the popup's Refresh button, and as the second
// half of the routine's stats step.
//
// Availability is a heuristic: the unauthenticated page carries no stock
// markup at all (a card is a plain anchor), so the reader marks a card sold
// out only on explicit disabled/out-of-stock markers — and then the RSC
// payload's isDisabled overrides when it knows the sku. Never throws — same
// reasoning as refreshStats(): a convenience read, not a step that can fail
// the sequence.
//
// The injection is three-phase because the search and the tile-click are both
// navigations, which would kill an in-page wait: phase 1 searches and resolves
// as soon as the query is submitted, the load wait between the phases absorbs
// the navigation, and phase 2 reads whatever the tab ended up showing. Phase 3
// then navigates the same tab to the first matching card's sku page and reads
// the variant select there (readRedeemVariants), storing the list as
// `variants` alongside the catalog `options` in LAST_REDEEM. Both halves keep
// their last good read when the new one comes back empty.
//
// Tab handling: the run closes only the tab it opened itself, and refuses to
// start while another redeem read is in flight (READ_RUN_GUARDS). Nothing is
// being earned, so there is nothing to give a grace period to, and a stopped
// run leaves the tab open — stopping is not finishing.

import { beginActivity, endActivity, currentStopEpoch } from "../lib/run-state.js";
import { sleep } from "../lib/delays.js";
import { closeTabs, waitForTabComplete } from "../lib/tabs.js";
import { setLastRedeemLog } from "../lib/log.js";
import { notify } from "../lib/notify.js";
import { getSettings } from "../lib/settings.js";
import {
  searchRedeemFor,
  readRedeemOptions,
  readRedeemVariants,
  redeemOnDetailPage
} from "../injections/redeem-read.js";
import { READ_RUN_GUARDS } from "./stats.js";

const LAST_REDEEM = "lastRedeem";
const REDEEM_RESTOCK_NEWS = "redeemRestockNews";
const REDEEM_SOLD_OUT_NEWS = "redeemSoldOutNews";

// The catalog page the Overwatch-coins watch reads. The page's own search box
// narrows it down to the digital-code cards; without one, the whole catalog is
// scanned for matching titles instead.
const REDEEM_URL = "https://rewards.bing.com/redeem";
// What the watch searches for. Phrased product-first on purpose:
// readRedeemOptions matches cards on the query's first word, which has to
// survive translation verbatim ("Overwatch" does; "digital code" would
// false-positive on every gift card in the catalog).
const REDEEM_QUERY = "overwatch coins digital code";
// How long each injected half of the redeem watch waits: the search box and
// the result cards both render after "complete", and a search-triggered
// navigation adds a full page load on top of the hydration wait.
const REDEEM_HYDRATION_MS = 12000;

export async function checkRedeemAvailability() {
  if (READ_RUN_GUARDS.redeem) {
    console.log("Redeem watch: a read is already running; skipping.");
    return;
  }
  READ_RUN_GUARDS.redeem = true;

  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned epoch tells this run when it has been stopped.
  const myEpoch = await beginActivity("Redeem watch");
  const stopped = () => currentStopEpoch().then(v => v !== myEpoch);

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
    await sleep(1500);
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
        await sleep(1500);
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
                // The OS notification (ADR-020): a restock is the one flip
                // worth hearing about with the popup closed — the watcher
                // exists so the user stops having to check. The banner above
                // stays the in-popup record either way.
                notify(
                  "Overwatch coins available",
                  `${restocked.join(", ")} — check the Rewards redeem page.`
                );
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
    // with id"). A stopped run still leaves its tab open: stopping is not
    // finishing.
    if (redeemTabId != null && !(await stopped())) {
      const settings = await getSettings();
      const closed = await closeTabs([redeemTabId], settings.keepPinnedTabs);
      if (closed) console.log(`Closed the tab opened by "redeem".`);
    }

    await endActivity("Redeem watch");
    READ_RUN_GUARDS.redeem = false;
  }
}

// The popup's Redeem button: opens the chosen amount's sku page in the
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
// Deliberately no activity epoch and no tab capture: there is nothing to
// stop mid-run that matters — a stray press can't happen because the picker
// refuses disabled buttons — and the tab is the user's from the moment it
// appears, never closed by us in any outcome.
export async function redeemOverwatchCoins(url, label) {
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
