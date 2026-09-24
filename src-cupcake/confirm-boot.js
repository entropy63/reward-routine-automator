// Runs before <body> paints, which is the whole reason it is a separate file
// (and not inline: MV3's script-src 'self' CSP blocks inline scripts).
//
// The palette has to be on the root before the first paint or the dialog
// flashes the default theme. localStorage is used instead of chrome.storage
// because it is synchronous — chrome.storage would resolve a frame or two too
// late. It is shared across the extension's pages, so the copy the popup last
// wrote is readable here; confirm.js reconciles with settings.theme and
// settings.appearance once storage answers.
(() => {
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem("meowTheme");
    root.dataset.theme =
      theme === "primer" || theme === "catppuccin" ? theme : "geist";

    // The appearance axis, same as the popup: an explicit light/dark has to
    // beat the first paint too, or the dialog flashes the OS scheme ("auto" is
    // the absence of a choice — no attribute, the CSS default holds).
    const mode = localStorage.getItem("meowMode");
    if (mode === "light" || mode === "dark") root.dataset.mode = mode;
  } catch (e) {
    // No localStorage (cleared profile, restricted mode). The CSS defaults
    // (geist, follow the OS) hold.
  }
})();
