// @ts-nocheck
// The coupon injections — the page-side halves of the coupon count read and
// the Coupons button. Ported verbatim from src2/injections/coupons.js
// (2026-09-08): the trigger/apply/applied regexes and the panel re-render
// scan carry over unchanged (see ADR-017).
//
// Injected via chrome.scripting.executeScript({func}), which serializes the
// function's source, so each function must be fully self-contained: no
// imports, no closures over module state.

// Reads the coupon count off the dashboard's "Coupon (N)" trigger into a
// plain number. Injected into the stats read's dashboard tab. Resolves null
// when the page shows nothing it recognizes (dumped to console.warn per the
// ADR-010 contract) — the caller then keeps the last good count.
export function readCouponCount(timeoutMs) {
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
export function claimDashboardCoupons(timeoutMs) {
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
