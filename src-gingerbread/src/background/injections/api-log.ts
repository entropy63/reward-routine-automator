// @ts-nocheck
// The Rewards-API probe's ISOLATED-world page halves (Developer Option,
// 2026-09-08). Injected via chrome.scripting.executeScript({func}),
// serialized with .toString(), so each is fully self-contained: no imports,
// no closures over module state (see ADR-017). @ts-nocheck like the engine
// injections — they run against the live page and are validated by live
// runs, not the type-checker; the typed orchestration that injects them
// lives in readers/api-probe.ts.
//
// The fetch/XHR HOOK itself is not here anymore: a post-load injection
// always missed the app's initial authenticated API calls (observed live —
// the first probe captured nothing). The hook now lives in
// content/api-logger.ts, a document_start MAIN-world content script armed
// by the probe's ?meowprobe=1 URL marker. These functions are the DOM-side
// readers and actors the orchestration needs after the page settles.

// The dashboard's "Today's points" card — the flyout the stats reader has to
// click open to see the search-points breakdown. Same label hook
// (p.text-labelControl) the reader matches by, so the probe exercises the
// exact interaction whose API traffic we want to see.
export function clickTodayPointsFlyout() {
  var labels = Array.from(document.querySelectorAll("p.text-labelControl"));
  var label = labels.find(function (el) {
    return /^today.?s points$/i.test((el.textContent || "").replace(/\s+/g, " ").trim());
  });
  var card = label ? label.closest("a, button") : null;
  if (!card) return false;
  card.click();
  return true;
}

// Hydration probe: the cards' label hook has rendered (the page's data calls
// land around the same time, and the document_start hook is already
// recording).
export function pageHasCards() {
  return document.querySelectorAll("p.text-labelControl").length > 0;
}

// Reads the MAIN-world logger's holder — the DOM bridge back.
export function readPageApiLog() {
  var el = document.getElementById("__meow_api_log");
  if (!el) return null;
  try { return JSON.parse(el.textContent || "[]"); } catch (e) { return null; }
}

// Where the page actually ended up — the diagnostics that answer "what did
// the page load, and where did its data come from". The card labels are what
// the page is showing; `resources` is the page's own resource-timing log
// (every request it made, whatever context made it — the ground truth when
// the fetch/XHR hook records nothing); `stateScripts` are the big inline
// <script> blobs — if the data is server-rendered, the JSON state sits in
// one of those and no API is involved at all.
export function pageFacts() {
  var resources = [];
  try {
    resources = performance
      .getEntriesByType("resource")
      .map(function (e) { return e.name; })
      .filter(function (u) {
        return !/\.(png|jpe?g|gif|svg|webp|css|js|mjs|woff2?|ttf|ico)(\?|$)/i.test(u);
      })
      .slice(0, 50);
  } catch (e) {}
  var stateScripts = [];
  try {
    stateScripts = Array.from(document.querySelectorAll("script"))
      .filter(function (s) { return !s.src && (s.textContent || "").length > 500; })
      .slice(0, 10)
      .map(function (s) {
        return {
          id: s.id || "",
          type: s.type || "",
          length: (s.textContent || "").length,
          head: (s.textContent || "").slice(0, 300)
        };
      });
  } catch (e) {}
  return {
    url: location.href,
    title: document.title,
    loggerPresent: !!document.getElementById("__meow_api_log"),
    cardLabels: Array.from(document.querySelectorAll("p.text-labelControl"))
      .slice(0, 20)
      .map(function (el) {
        return (el.textContent || "").replace(/\s+/g, " ").trim();
      }),
    resources: resources,
    stateScripts: stateScripts
  };
}

// Fetches getuserinfo from INSIDE the page — same-origin, so the auth cookies
// attach no matter their SameSite policy. The worker's own fetch cannot do
// this: from the extension origin the request is cross-site, the cookies stay
// home, and the endpoint 302s to login.windows.net (observed live, 2026-09-08).
// This is the fetch an API-backed reader would actually use.
export function fetchGetuserinfoInPage() {
  return fetch("/api/getuserinfo?type=1", {
    credentials: "include",
    headers: { accept: "application/json", "x-requested-with": "XMLHttpRequest" }
  })
    .then(function (res) {
      return res.text().then(function (body) {
        return {
          ok: true,
          status: res.status,
          contentType: (res.headers && res.headers.get && res.headers.get("content-type")) || "",
          finalUrl: res.url,
          body: String(body).slice(0, 300000)
        };
      });
    })
    .catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
}
