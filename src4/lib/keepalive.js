// Keeping the MV3 service worker alive. The worker idles out at ~30s of
// inactivity, but a search batch's inter-search delays run 5–15s and the tab
// close grace period runs ~8s, both punctuated by long silent waits. A
// 20s interval of any cheap extension API call resets the idle timer
// (ADR-001).
//
// Counted holds, because the waits overlap: the tail of a batch can be
// closing its tabs (a hold) while the next startup step is already running
// (the batch's own keep-alive). The count — not a boolean — is what lets
// cancelBeats() drop the batch's keep-alive without cutting short a grace
// period running alongside it.

const KEEPALIVE_MS = 20000; // service worker idles out at ~30s

let keepAliveTimer = null;
let keepAliveHolds = 0;

export function startKeepAlive() {
  if (keepAliveTimer !== null) return;
  keepAliveTimer = setInterval(() => {
    // Any extension API call resets the worker's idle timer.
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, KEEPALIVE_MS);
}

// Refuses while a hold is outstanding: cancelBeats() drops the keep-alive
// whenever a batch ends, which would otherwise cut short the tab-closing
// grace period running alongside it.
export function stopKeepAlive() {
  if (keepAliveHolds > 0) return;

  if (keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export function holdKeepAlive() {
  keepAliveHolds++;
  startKeepAlive();
}

export function releaseKeepAlive() {
  keepAliveHolds = Math.max(0, keepAliveHolds - 1);
  if (keepAliveHolds === 0) stopKeepAlive();
}
