// Native OS notifications (ADR-020): the events the user wants to hear about
// with the popup closed — a coin amount they were waiting for came back, the
// evening nudge, the goal alert. The banners stay the in-popup record; the
// notification is the poke. One tiny wrapper so the readers never touch the
// API shape: guarded (a Chrome without the notifications API — or the
// permission not granted — must never break a read) and never throwing.
//
// Options are optional and all-or-nothing per call:
//   id       a STABLE id, so a repeat replaces the previous notification
//            instead of stacking (the nudge fires once a day, but a
//            re-entrant worker must not pile copies up), and so a button
//            click can be routed back to the right feature.
//   buttons  [{ title }] — the notification's own action buttons. A click
//            arrives on chrome.notifications.onButtonClicked with this id and
//            the button's index; a notification with buttons on it must have
//            an id, or the click cannot be told from any other's.

const ICON = "icons/icon128.png";

export function notify(title, message, { id = null, buttons = null } = {}) {
  if (!(chrome.notifications && chrome.notifications.create)) return null;
  try {
    const options = {
      type: "basic",
      iconUrl: chrome.runtime.getURL(ICON),
      title,
      message,
      priority: 1
    };
    // Only attach `buttons` when there are some: an empty array is a
    // different thing to Chrome than no key at all on some builds, and the
    // plain notifications want no key.
    if (Array.isArray(buttons) && buttons.length) {
      options.buttons = buttons.map(b => ({ title: String(b.title) }));
    }
    if (id) return chrome.notifications.create(id, options);
    return chrome.notifications.create(options);
  } catch (e) {
    console.warn("Notification: could not be shown:", e);
    return null;
  }
}

// Clear one by id — the "Later" answer to a nudge, and the goal alert being
// acknowledged. Guarded like the create above; a missing id is a no-op rather
// than an error, because clearing something already gone is the common case.
export function clearNotification(id) {
  if (!id) return;
  if (!(chrome.notifications && chrome.notifications.clear)) return;
  try {
    chrome.notifications.clear(id);
  } catch (e) {
    console.warn("Notification: could not be cleared:", e);
  }
}
