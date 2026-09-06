// Runs before <body> paints, for the same reason confirm-boot.js exists (and
// why it is a separate file, not inline: MV3's script-src 'self' CSP blocks
// inline scripts).
//
// The palette has to be on the root before the first paint or the page
// flashes the default theme. localStorage is used instead of chrome.storage
// because it is synchronous — chrome.storage would resolve a frame or two too
// late. It is shared across the extension's pages, so the copy the popup last
// wrote is readable here; routine-done.js reconciles with settings.theme and
// settings.appearance once storage answers.
(() => {
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem("meowTheme");
    // "the purr" defaults to catppuccin (ADR-019) — geist stays selectable.
    root.dataset.theme =
      theme === "geist" || theme === "primer" ? theme : "catppuccin";

    // The appearance axis, same as the popup: an explicit light/dark has to
    // beat the first paint too, or the page flashes the OS scheme ("auto" is
    // the absence of a choice — no attribute, the CSS default holds).
    const mode = localStorage.getItem("meowMode");
    if (mode === "light" || mode === "dark") root.dataset.mode = mode;
  } catch (e) {
    // No localStorage (cleared profile, restricted mode). The CSS defaults
    // (catppuccin, follow the OS) hold.
  }
})();
