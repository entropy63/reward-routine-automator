// Runs before <body> paints, which is the whole reason it is a separate file:
// the popup window is sized from the document, so the height has to be in place
// before the first layout or the window visibly resizes as popup.js catches up.
//
// localStorage is used instead of chrome.storage because it is synchronous —
// chrome.storage would resolve a frame or two too late. popup.js keeps both in
// step; chrome.storage stays the source of truth.
(() => {
  const root = document.documentElement;

  try {
    // Same pre-paint logic as the height: the palette has to be on the root
    // before the first paint or the whole popup flashes the default theme.
    const theme = localStorage.getItem("meowTheme");
    root.dataset.theme =
      theme === "primer" || theme === "catppuccin" ? theme : "geist";

    // And the same again for the appearance axis: an explicit light/dark has
    // to beat the first paint too, or the popup flashes the OS scheme.
    const mode = localStorage.getItem("meowMode");
    if (mode === "light" || mode === "dark") root.dataset.mode = mode;

    // The popup always opens on the main view; the Settings view is one gear
    // click away and never persisted.
    const cached = Number(localStorage.getItem("popupHeight"));
    // Chromium caps action popups at 600px; anything outside that is stale junk.
    if (Number.isFinite(cached) && cached >= 240 && cached <= 600) {
      root.style.setProperty("--popup-h", `${cached}px`);
    }

    // Hidden sections and the developer option gate the same cards this
    // height was measured without — they have to be in place before the
    // first paint, or the window resizes once popup.js catches up. The
    // hidden list is stored space-separated (data-hidden~="…" matches words).
    const hidden = localStorage.getItem("meowHidden");
    if (hidden) root.dataset.hidden = hidden;
    // The Activity card is dev-only and defaults to hidden; only an explicit
    // "on" from the Developer Option toggle shows it pre-paint.
    if (localStorage.getItem("meowDev") !== "on") root.dataset.dev = "off";
    // The experimental Coupons button joins the Run-now grid only while the
    // Experimental features toggle is on; default is off, like the dev gate.
    if (localStorage.getItem("meowExperimental") === "on") {
      root.dataset.experimental = "on";
    }

    if (localStorage.getItem("animations") === "0") root.dataset.anim = "off";
  } catch (e) {
    // No localStorage (cleared profile, restricted mode). The CSS defaults hold.
  }
})();
