// routine-done.js — the routine-finished summary page.
//
// Pure presentation, like confirm.js: the background decides this page exists
// (endRoutine opens it, with the summary in the ?q= query the background
// built from the last stats read) and nothing here reports back. The Close
// button is the page's own — nothing closes this tab automatically, not even
// the Clear-tabs action (the background exempts its URL), so the user is the
// only one who takes it down.

const leadEl = document.getElementById("lead");
const streaksEl = document.getElementById("streaks");
const skipsEl = document.getElementById("skips");
const skipsNoteEl = document.getElementById("skipsNote");
const stampEl = document.getElementById("stamp");
const closeBtn = document.getElementById("closeBtn");
const devBar = document.getElementById("devBar");

// The display names of the four streak activities, in the popup's Stats-card
// wording — the query carries the storage keys, the page owns their English.
const STREAK_NAMES = {
  bingSearch: "Bing searches",
  dailySet: "Daily set",
  bingApp: "Bing app check-in",
  visualSearch: "Visual searches"
};

// The display names of the skippable routine steps — the same words the
// Activity rows use ("Search — skipped, …"), so the finish page and the
// popup never name one step two ways.
const STEP_NAMES = {
  search: "Search",
  claim: "Claim",
  dailySet: "Daily set",
  imageSearch: "Image search"
};

// The head's inline boot set the palette and appearance pre-paint from
// localStorage; storage is the source of truth, so reconcile both theme axes
// once it answers. This is also what picks the theme up for a user who never
// opened the popup (no localStorage copy exists yet).
chrome.storage.sync.get("settings").then(({ settings }) => {
  const theme = settings && settings.theme;
  if (theme === "geist" || theme === "primer" || theme === "catppuccin") {
    document.documentElement.dataset.theme = theme;
  }
  // "auto" is the absence of a choice — no attribute, the OS scheme holds
  // (same shape as the popup's applyMode).
  const appearance = settings && settings.appearance;
  if (appearance === "light" || appearance === "dark") {
    document.documentElement.dataset.mode = appearance;
  } else {
    delete document.documentElement.dataset.mode;
  }
});

// A finish stamp (e.g. "Finished 14:32") — nicer than nothing in the head
// when the summary carries no other time reference.
const pad = n => String(n).padStart(2, "0");
const now = new Date();
stampEl.textContent = `Finished ${pad(now.getHours())}:${pad(now.getMinutes())}`;

// One render pass, so the dev preview bar can re-run it with a sample query
// instead of the real one. The markup each pass builds is identical to the
// single-shot version: lead line by state, one row per undone streak, and
// one dimmed row per skipped step (the routine judged it already done).
function render(entries, skipped = []) {
  streaksEl.replaceChildren();
  const undone = entries.filter(entry => !entry.done);

  if (entries.length && undone.length) {
    leadEl.textContent =
      "The routine finished, but some streaks need you to complete them:";
  } else if (entries.length) {
    leadEl.textContent = "The routine finished — every streak is complete.";
  } else {
    leadEl.textContent = "The daily routine finished.";
  }

  for (const entry of undone) {
    const li = document.createElement("li");
    li.className = "streak";

    const name = document.createElement("span");
    name.className = "streak-name";
    name.textContent = STREAK_NAMES[entry.key] || entry.key;

    const value = document.createElement("span");
    value.className = "streak-value";
    value.textContent = entry.label;

    // The user's own framing: this is the thing they have to do themselves.
    const hint = document.createElement("span");
    hint.className = "streak-hint";
    hint.textContent = "You have to do this one";

    li.append(name, value, hint);
    streaksEl.append(li);
  }

  streaksEl.hidden = streaksEl.children.length === 0;

  // The skipped steps (2026-09-05, the user's request): a step the routine
  // passed over is named on the finish page, with the verdict that skipped
  // it — "Search — already 60/60" — dimmed, the opposite of the red
  // "you have to do this" rows above.
  skipsEl.replaceChildren();
  for (const step of skipped) {
    const li = document.createElement("li");
    li.className = "skip";

    const name = document.createElement("span");
    name.className = "skip-name";
    name.textContent = STEP_NAMES[step.id] || step.id;

    const reason = document.createElement("span");
    reason.className = "skip-reason";
    reason.textContent = step.reason;

    li.append(name, reason);
    skipsEl.append(li);
  }
  skipsEl.hidden = skipsEl.children.length === 0;
  skipsNoteEl.hidden = skipsEl.hidden;
}

const initialParams = new URLSearchParams(location.search);
render(
  parseItems(initialParams.get("q") || ""),
  parseSkipped(initialParams.get("s") || "")
);

// ---------- developer preview bar ----------
//
// The dev=1 query flag comes from the popup's Developer-Option opener only —
// endRoutine never sets it, so the page a real routine opens stays honest
// (real LAST_STATS, no preview controls). With the flag on, a small bar above
// the card offers each render condition, the same DOM-only sample-payload
// preview the popup's bell button does: a plain "done" (no summary), some
// streaks left (the Bing-app one the user says is the usual straggler), and
// every streak complete. Sample queries reuse the real format, so the parse
// under test is the parse the page ships.

if (new URLSearchParams(location.search).get("dev") === "1" && devBar) {
  devBar.hidden = false;
  // The query for a given condition, as the real endRoutine would build it —
  // parseItems() is shared with the real path above.
  const CONDITIONS = [
    {
      id: "plain",
      label: "Plain done",
      query: "",
      skipped: ""
    },
    {
      id: "undone",
      label: "Streaks left",
      query: "bingApp:Day 0 of 1 · 0/1;bingSearch:2/4",
      skipped: ""
    },
    {
      id: "allDone",
      label: "All complete",
      query: "bingSearch:4/4;dailySet:3/3;bingApp:Day 1 of 1 · 1/1;visualSearch:1/1",
      skipped: ""
    },
    {
      id: "skips",
      label: "Skips",
      query: "bingApp:Day 0 of 1 · 0/1",
      // The same shape endRoutine's ?s= query carries — real verdict wording.
      skipped: "search:already 60/60;claim:nothing to claim (0 pending)"
    }
  ];

  for (const condition of CONDITIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dev-btn";
    btn.textContent = condition.label;
    btn.addEventListener("click", () =>
      render(parseItems(condition.query), parseSkipped(condition.skipped))
    );
    devBar.append(btn);
  }
}

// The shared query parser: "key:label;key:label" → entries. Both the real
// ?q= summary and the dev sample queries go through it.
function parseItems(raw) {
  const entries = [];
  if (!raw) return entries;
  for (const pair of raw.split(";")) {
    const at = pair.indexOf(":");
    if (at <= 0) continue;
    const key = pair.slice(0, at);
    const label = pair.slice(at + 1);
    if (!label) continue;
    const match = label.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    const done = !!match && Number(match[1]) >= Number(match[2]) && Number(match[2]) > 0;
    entries.push({ key, label, done });
  }
  return entries;
}

// The skip list's own parser: "id:reason;id:reason" → entries. Same compact
// shape as ?q=, but no done verdict to compute — the routine already made
// it, and the reason travels verbatim.
function parseSkipped(raw) {
  const skipped = [];
  if (!raw) return skipped;
  for (const pair of raw.split(";")) {
    const at = pair.indexOf(":");
    if (at <= 0) continue;
    const id = pair.slice(0, at);
    const reason = pair.slice(at + 1);
    if (!id || !reason) continue;
    skipped.push({ id, reason });
  }
  return skipped;
}

closeBtn.addEventListener("click", () => {
  // The tab belongs to the user; the Close button is just the polite way to
  // take it down. A failed remove (already-closed tab, rare) just closes the
  // page itself as a fallback.
  chrome.tabs
    .getCurrent()
    .then(tab => (tab && tab.id != null ? chrome.tabs.remove(tab.id) : null))
    .catch(() => {})
    .finally(() => window.close());
});
