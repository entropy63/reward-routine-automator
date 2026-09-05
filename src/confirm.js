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
