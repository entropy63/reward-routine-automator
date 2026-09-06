// The redeem-watch injections — the page-side halves of the three-phase
// catalog read and the popup's Redeem button. Injected via
// chrome.scripting.executeScript({func}), which serializes the function's
// source, so each function must be fully self-contained: no imports, no
// closures over module state (see ADR-017).

// Phase 1 of the redeem watch: types the query into the page's own search box
// and submits. The authenticated page's box is unknown to us — the
// unauthenticated capture renders no input at all, only a "Search"-labeled
// anchor that navigates to the shop — so the box is hunted by selector and by
// label (English or Arabic), and that trigger is clicked once if no box shows
// up on its own. Resolves true once the query is submitted, false when no box
// ever appeared — the caller then reads the catalog page as-is.
//
// The native value-setter below is the trick from
// performHumanTypedSearchOnBing: the catalog is a React app, and assigning
// .value directly bypasses the property setter React hooks, so the page's
// state would never see the query.
export function searchRedeemFor(query, timeoutMs) {
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
// verbatim). Same polling idiom as readRewardsStats, because the search
// results render after "complete".
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
export function readRedeemOptions(query, timeoutMs) {
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
      while (m = itemRe.exec(html)) {
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
// card leads to — and resolves [{ label, available, href? }] for every
// variant the product is offered in (the "select option" under the details:
// each denomination of the Overwatch coins digital code, one row per option).
// The real page (verbatim capture 2026-09-03, overwatch-redeem-page.html) has
// no select and no listbox: the amounts are plain buttons ("500 coins", "1000
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
export function readRedeemVariants(timeoutMs) {
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
      while (m = itemRe.exec(html)) {
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
// goes to console.warn.
//
// Matches on trimmed, whitespace-normalized text because the label came from
// this same page's option list (readRedeemVariants textOf) — it round-trips
// byte-for-byte unless the page re-rendered between the reads.
export function redeemOnDetailPage(label, timeoutMs) {
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
