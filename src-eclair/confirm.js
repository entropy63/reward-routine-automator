// confirm.js — the routine's cancel-before-start dialog.
//
// This window is pure presentation: it shows the countdown and relays the
// buttons to the background, which owns the timeout decision and closes this
// window when the prompt settles. Reaching zero here deliberately does
// nothing — the background's 15s timer is the authority on what silence
// means.

// Mirrors ROUTINE_CONFIRM_TIMEOUT_MS in background.js. The label is all this
// drives; the background's timer does the real waiting.
const TIMEOUT_SECONDS = 15;

const countdownEl = document.getElementById("countdown");
const startBtn = document.getElementById("startBtn");
const cancelBtn = document.getElementById("cancelBtn");
const planList = document.getElementById("planList");

// The dry run (build 3): ask the worker what this routine would open, using
// the same preflight() the popup's own panel shows. The dialog is the last
// moment before tabs appear, so it is the right place to say what they are —
// and the rows come from the worker rather than being guessed here, so the
// promise and the run cannot disagree. A failure leaves the list hidden: an
// unknown plan is better than a wrong one.
const STEP_TITLES = {
  claim: "Claim",
  dailySet: "Daily set",
  keepEarning: "Keep earning",
  search: "Web searches",
  imageSearch: "Image search",
  stats: "Stats"
};

// The dialog is narrow: each step is one line — the step, then the first thing
// it opens (or the skip verdict's own wording). The remaining opens lines are
// summarized as a count rather than wrapped, so the countdown stays in view.
function renderPlan(rows) {
  const shown = rows.filter(row => row.willRun);
  if (!rows.length) return;
  planList.replaceChildren(
    ...rows.map(row => {
      const li = document.createElement("li");
      li.className = row.willRun ? "plan-step" : "plan-step is-skip";
      const title = document.createElement("span");
      title.className = "plan-title";
      title.textContent = STEP_TITLES[row.id] || row.id;
      const verdict = document.createElement("span");
      verdict.className = "plan-verdict";
      if (!row.willRun) {
        verdict.textContent = row.reason || "skipped";
      } else {
        const extra = row.opens.length - 1;
        verdict.textContent = extra > 0 ? `${row.opens[0]} +${extra}` : row.opens[0] || "will open";
      }
      li.append(title, verdict);
      return li;
    })
  );
  planList.classList.toggle("is-all-done", shown.length === 0);
  planList.hidden = false;
}

chrome.runtime
  .sendMessage({ type: "GET_PREFLIGHT" })
  .then(res => {
    if (res && res.ok && Array.isArray(res.rows)) renderPlan(res.rows);
  })
  .catch(() => {});

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

// Ticks the label only. Stops at zero without acting on it.
let remaining = TIMEOUT_SECONDS;
const timer = setInterval(() => {
  remaining = Math.max(0, remaining - 1);
  countdownEl.textContent = `Starts in ${remaining}s`;
  if (remaining === 0) clearInterval(timer);
}, 1000);

// One answer per window: the first click disables both buttons, so a double
// click can't send two messages. The background closes this window when the
// prompt settles; closing it here too covers a message that went unanswered
// (e.g. a stale dialog left open past the timeout).
function answer(proceed) {
  startBtn.disabled = true;
  cancelBtn.disabled = true;
  clearInterval(timer);
  chrome.runtime
    .sendMessage({ type: "routineConfirmAnswer", proceed })
    .catch(() => {})
    .finally(() => window.close());
}

startBtn.addEventListener("click", () => answer(true));
cancelBtn.addEventListener("click", () => answer(false));
