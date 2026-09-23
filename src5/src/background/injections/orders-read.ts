// @ts-nocheck
// The order-history injections — the page-side halves of the Orders sync.
// Built from the live captures of 2026-09-09 (.claude/html-references/
// Orders.html and Orderdetail.html, never to be committed): the rows are
// cards with a
// "View detail" button each, and the detail is a react-aria dialog
// (section[role="dialog"] in a Modal overlay) whose "Rewards details"
// disclosure holds the code and its expiration.
//
// Injected via chrome.scripting.executeScript({func}), which serializes the
// function's source ALONE — every helper it touches must live INSIDE it, or
// the identifier is undefined in the page and the whole read dies silently
// (the root cause of the months-long "no rows" failure, found 2026-09-09:
// textOf/viewDetailButtons/VIEW_DETAIL/RESULTS sat at module level, so the
// injected poll threw instantly and executeScript resolved null — the same
// discipline stats-read.ts always had). The price is deliberate duplication
// between the two exported functions; a shared module scope is exactly what
// we cannot have.

// Reads the whole order list: one row per "View detail" button, the row's card
// parsed from its innerText lines (title / "9,800 pts" / "7/31/2026" /
// "Order no. <uuid>"). The oldest orders render in Arabic, so the date is
// whatever short line is left over — never a format guess. Resolves
// { total, list, dump } — the dump is the ADR-010 evidence slice when no row
// is found.
export function readOrderRows(timeoutMs) {
  // The row button's exact label ("View detail" — singular, verbatim capture)
  // with a tolerant plural, anchored end-to-end so the catalog's "View
  // details" links elsewhere on the page can't match.
  const VIEW_DETAIL = /^view details?$/i;
  // The page's own count line: "Your orders 15 results".
  const RESULTS = /(\d+)\s+results/i;

  const textOf = el => ((el && (el.innerText || el.textContent)) || "").trim();

  function viewDetailButtons() {
    // Anchors included alongside buttons: cheap insurance against a markup
    // tweak on the page (the capture's rows use real <button>s, but the
    // anchored label is what identifies them, not the tag).
    return Array.from(document.querySelectorAll('button, [role="button"], a')).filter(el =>
      VIEW_DETAIL.test(textOf(el)),
    );
  }

  function readRow(btn) {
    // The row card is the nearest ancestor that also carries the order-no
    // line (the button's own wrappers stop short of it).
    let card = btn.parentElement;
    while (card && card !== document.body && !/order no/i.test(textOf(card))) {
      card = card.parentElement;
    }
    const lines = textOf(card)
      .split("\n")
      .map(l => l.trim())
      // The live page glues the View-detail button's label onto the END of
      // the order-no line for some cards (user report, 2026-09-10: the row
      // rendered "Order no. <uuid>View detail"). Trim a trailing button
      // label off every line before anything looks at it — the standalone
      // button line dies in the same filter (it becomes empty), and the
      // order number comes back clean.
      .map(l => l.replace(/\s*view details?\s*$/i, ""))
      .filter(Boolean);
    // "View detail" (and any stray button text) never belongs to the record.
    const rows = lines.filter(l => !VIEW_DETAIL.test(l));
    // The order number is pulled out FIRST, then EVERY "Order no." line is
    // stripped from the body — not just the first one. The live page renders
    // the order number more than once per card (a hidden accessibility twin;
    // user report, 2026-09-10: whichever twin survived the old single-line
    // exclusion was adopted as the title or the date, so the row showed the
    // order id twice and the real date never). A bare uuid line (the twin's
    // other shape) is stripped the same way.
    const isUuid = l =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l);
    const orderNoLine = rows.find(l => /order no/i.test(l));
    const orderNo = orderNoLine ? (orderNoLine.replace(/^.*order no\.?\s*/i, "") || null) : null;
    const body = rows.filter(l => !/order no/i.test(l) && !isUuid(l));
    // "9,800" and "pts" render as separate innerText lines (two sibling <p>s,
    // verbatim capture) — or already joined. Either way the number is the
    // line before/with the pts marker.
    let points = null;
    let ptsLine = null;
    const joined = body.find(l => /^[\d.,]+\s*pts$/i.test(l));
    if (joined) {
      points = joined.replace(/\s*pts$/i, "");
      ptsLine = joined;
    } else {
      const i = body.findIndex(l => /^pts$/i.test(l));
      if (i > 0 && /^[\d.,]+$/.test(body[i - 1])) {
        points = body[i - 1];
        ptsLine = body[i];
      }
    }
    // The date: the one leftover body line that is nothing else (the "|"
    // separator the page shows between points and date included).
    const date =
      body.find(
        l =>
          l !== body[0] &&
          l !== ptsLine &&
          (points == null || l !== points) &&
          l !== "|",
      ) || null;
    return {
      title: body[0] || "",
      points,
      date,
      orderNo,
    };
  }

  return new Promise(resolve => {
    const POLL_MS = 500;
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 12000);

    function poll() {
      const buttons = viewDetailButtons();
      if (buttons.length) {
        const list = buttons.map(readRow);
        // The buttons can render BEFORE the card's own text does (user
        // report, 2026-09-10: "I don't see the date. Also, I don't see the
        // title of the item" — the live page paints its View-detail buttons
        // first and streams the title/points/date in after; the capture is a
        // saved-after-hydration snapshot, so it never showed the gap). A
        // card is complete when it carries its four facts: title, points,
        // date, order number. Only a fully-complete list resolves early —
        // otherwise the poll keeps waiting for the text to land (the
        // deadline still bounds it, and the best-effort list below is what
        // resolves then, never an empty one when buttons exist).
        const complete = list.filter(
          r => r.title && r.points != null && r.date && r.orderNo,
        );
        if (complete.length === buttons.length) {
          const totalMatch = RESULTS.exec(textOf(document.body));
          resolve({
            total: totalMatch ? Number(totalMatch[1]) : buttons.length,
            list,
            dump: "",
          });
          return;
        }
        if (Date.now() >= deadline) {
          console.warn(
            "Orders: " +
              complete.length +
              "/" +
              buttons.length +
              " cards complete when the wait ran out (report to dev):",
            textOf(document.body).slice(0, 800),
          );
          resolve({
            total: buttons.length,
            list,
            dump: "",
          });
          return;
        }
        setTimeout(poll, POLL_MS);
        return;
      }
      if (Date.now() >= deadline) {
        console.warn(
          "Orders: no rows on the page (report to dev):",
          textOf(document.body).slice(0, 800),
        );
        // The evidence slice leads with WHERE the page ended up and what it
        // called itself — a redirect or a sign-in wall shows in the URL long
        // before it shows in the body text (which can be empty on a blank
        // render). The state line adds the two visibility suspects and a
        // button census: if the page defers rendering until the tab is
        // looked at, visibilityState says "hidden" here.
        resolve({
          total: 0,
          list: [],
          dump:
            location.href +
            "\n" +
            document.title +
            "\n[visibility " +
            document.visibilityState +
            " / ready " +
            document.readyState +
            " / " +
            document.querySelectorAll("button").length +
            " buttons]\n" +
            textOf(document.body).slice(0, 800),
        });
        return;
      }
      setTimeout(poll, POLL_MS);
    }
    poll();
  });
}

// Opens the index-th order's detail dialog, expands the "Rewards details"
// disclosure when the page left it collapsed, reads the code, expiration and
// status line, then closes the dialog so the next one can open. Resolves
// { code, expires, status, dump } or { reason } when the row or the dialog
// never appeared.
export function readOrderDetail(index, timeoutMs) {
  const VIEW_DETAIL = /^view details?$/i;

  const textOf = el => ((el && (el.innerText || el.textContent)) || "").trim();

  function viewDetailButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"], a')).filter(el =>
      VIEW_DETAIL.test(textOf(el)),
    );
  }

  // The code's own shape from the capture: GPGN-5HKX-F8FRW-4PGJ-MQV9 —
  // dash-separated groups. Anchored so an order title can't match.
  const CODE = /(?:^|\n)\s*code\s+([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)\s*(?=\n|$)/i;
  const EXPIRES = /expiration date\s+([^\n]+)/i;
  // The status banner ("Your order has been completed.") — matched on the
  // stable "Your order" opening so other statuses still carry.
  const STATUS = /your order[^\n]*/i;

  return new Promise(resolve => {
    const POLL_MS = 400;
    const deadline = Date.now() + Math.max(2000, Number(timeoutMs) || 15000);

    const dialog = () => document.querySelector('[role="dialog"]');

    function closeIfOpen() {
      // One dialog left open blocks the next row's read. No dialog (a "no
      // such row" bail) means nothing to press — a blind selector could hit
      // an unrelated page control.
      if (!dialog()) return false;
      const dlg = dialog();
      const closeBtn =
        document.querySelector('button[aria-label="Close"]') ||
        Array.from(document.querySelectorAll("button")).find(el => /^close$/i.test(textOf(el)));
      if (closeBtn) {
        closeBtn.click();
      } else {
        // A page tweak can rename or drop the labeled Close button;
        // react-aria modals answer Escape even then. Dispatched on the
        // dialog so it bubbles like a real keypress would.
        dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
      return true;
    }

    function readDetail(text) {
      const code = (CODE.exec(text) || [])[1] || null;
      const expires = (EXPIRES.exec(text) || [])[1] || null;
      const status = (STATUS.exec(text) || [])[0] || null;
      if (!code && !expires) {
        return {
          code: null,
          expires: null,
          status,
          dump: text.slice(0, 800),
        };
      }
      return { code, expires, status, dump: "" };
    }

    let opened = false;
    let clickedAt = 0;
    let clicks = 0;
    // The quiet-text settle detector (below): the last dialog text and how
    // many consecutive polls it has held still for.
    let lastText = "";
    let sameText = 0;
    // When the dialog MOUNTED — the codeless fallback (below) measures its
    // patience from here, not from the press.
    let dlgOpenedAt = 0;

    function pressAgain() {
      // The press can be LOST: the page re-renders between the query and the
      // click, so the click lands on a detached node and no dialog will ever
      // answer (user report, 2026-09-09: the NEWEST order showed no details
      // while every later one did — the first detail read runs right after
      // the list read, exactly when hydration is still swapping nodes). So a
      // dialog that hasn't answered in a while gets a fresh query + press,
      // bounded; the deadline still ends the whole read.
      const btn = viewDetailButtons()[Number(index)];
      if (btn) {
        btn.click();
        clickedAt = Date.now();
        clicks++;
      }
    }

    function poll() {
      if (Date.now() >= deadline) {
        closeIfOpen();
        resolve({ reason: "timed out" });
        return;
      }

      const dlg = dialog();

      if (!opened) {
        // A dialog still mounted is a leftover from the PREVIOUS row's read
        // (its close click resolves before react-aria unmounts) — close it
        // and wait; pressing this row's button through an open modal does
        // nothing.
        if (dlg) {
          closeIfOpen();
          setTimeout(poll, POLL_MS);
          return;
        }
        const buttons = viewDetailButtons();
        const btn = buttons[Number(index)];
        if (!btn) {
          // No button (yet): during a re-render the query can transiently
          // come back empty — that is "not here NOW", not "no such row".
          // Only the deadline settles it.
          setTimeout(poll, POLL_MS);
          return;
        }
        btn.click();
        opened = true;
        clickedAt = Date.now();
        clicks = 1;
        setTimeout(poll, POLL_MS);
        return;
      }

      if (!dlg) {
        // The dialog does NOT appear directly on press — the live page
        // takes its time (user's live observation, 2026-09-10: "when you
        // brush it, the detail will not show directly. You have to wait").
        // The wait is patient on purpose: an impatient re-press fights a
        // slow-opening dialog. The first rescue press after 8s covers the
        // genuine lost-press race (the 2026-09-09 detached-node click that
        // landed before hydration finished swapping nodes); a second one at
        // 24s is the "still not giving it enough time" concession (user
        // report, 2026-09-10) for a page this slow. Only the deadline ends
        // the read after that.
        if (clicks < 3 && Date.now() - clickedAt >= (clicks === 1 ? 8000 : 24000)) {
          pressAgain();
        }
        setTimeout(poll, POLL_MS);
        return;
      }

      // The dialog is open — remember when it mounted (the codeless
      // fallback's patience clock).
      if (!dlgOpenedAt) dlgOpenedAt = Date.now();

      // The dialog is open. The "Rewards details" disclosure may start
      // collapsed — expand it before reading. The exact label is the
      // capture's; a page tweak renames it, so a button whose label merely
      // mentions "details" is the fallback (user report, 2026-09-10: "you
      // are not getting the data from view details").
      const labeled = Array.from(dlg.querySelectorAll('button[aria-label]'));
      const disclosure =
        labeled.find(el => /^rewards details$/i.test(el.getAttribute("aria-label") || "")) ||
        labeled.find(el => /details?/i.test(el.getAttribute("aria-label") || ""));
      if (disclosure && disclosure.getAttribute("aria-expanded") !== "true") {
        disclosure.click();
        lastText = "";
        sameText = 0;
        setTimeout(poll, POLL_MS);
        return;
      }

      // Read once the dialog carries the CODE — the code is the point of
      // the read, and everything else renders long before it ("the detail
      // will not show directly. You have to wait… after the details load,
      // you will see the code", the user's live spec; and the 2026-09-10
      // report "you are still not giving it enough time": firing on the
      // STATUS line alone closed dialogs while their codes were still
      // streaming in). A dialog that genuinely has NO code is read only
      // after its text has held still for a long, patient while with real
      // body to it — the status/expiry still carry that way, and the dump
      // keeps the evidence.
      const text = textOf(dlg);
      if (text !== lastText) {
        lastText = text;
        sameText = 0;
      } else {
        sameText++;
      }
      const hasCode = CODE.test(text);
      const codelessSettled =
        !hasCode &&
        Date.now() - dlgOpenedAt >= 10000 &&
        sameText >= 12 &&
        text.length > 40;
      if (!hasCode && !codelessSettled) {
        setTimeout(poll, POLL_MS);
        return;
      }

      // Read BEFORE closing: a close that unmounts the dialog
      // synchronously (the Escape path can) leaves readDetail nothing to
      // query — the text is already in hand.
      const result = readDetail(text);
      closeIfOpen();
      resolve(result);
    }
    poll();
  });
}
