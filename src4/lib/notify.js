// Native OS notifications (ADR-020): the restock watcher's flips are the
// one event the user wants to hear about with the popup closed — a coin
// amount they were waiting for came back. The banners stay the in-popup
// record; the notification is the poke. One tiny wrapper so the readers
// never touch the API shape: guarded (a Chrome without the notifications
// API — or the permission not granted — must never break a read) and
// never throwing.

export function notify(title, message) {
  if (!(chrome.notifications && chrome.notifications.create)) return;
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1
    });
  } catch (e) {
    console.warn("Notification: could not be shown:", e);
  }
}
