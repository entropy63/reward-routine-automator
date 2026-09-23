import { useCallback, useSyncExternalStore } from 'react'

// One live subscription to a single chrome.storage key: read it now, then
// re-render whenever the worker (or another popup instance) writes it. This is
// the popup's whole data layer — the worker owns every write, the popup only
// reads, so a change listener is all it takes to stay in sync.
//
// A single module-level store backs every call: ONE chrome.storage.onChanged
// listener for the whole page and ONE get() per key, shared by every hook that
// reads it. The dashboard alone mounts ~24 of these hooks (the log's seven
// rows, orders, the tiles' stats/redeem reads, the layout); one listener and
// one read per key instead of one of each per hook. Values stay warm across
// unmount/remount for the life of the page, so switching tabs never re-reads.
//
// The stored value lives in the entry as `raw` (`undefined` = key absent); the
// caller's fallback is applied here, in the hook, not in the store — so two
// hooks reading the same key with different fallbacks stay independent, and a
// caller may pass a fresh {}/[] literal each render without disturbing the
// subscription. `loaded` flips once the initial read resolves (even to "key
// absent"), so a caller can tell the stored value from the fallback while
// storage answers — the popup gates its whole first paint on it for settings,
// so the first frame is already the user's theme/glass, not a defaults flash.
type Area = 'local' | 'sync'

// The per-key snapshot useSyncExternalStore hands back. It must keep a stable
// reference between changes (React compares snapshots with Object.is and loops
// if a fresh object appears every render), so it is only ever replaced inside
// setSnapshot when raw or loaded actually moves.
interface Snapshot {
  raw: unknown
  loaded: boolean
}

interface Entry {
  snapshot: Snapshot
  subscribers: Set<() => void>
  reading: boolean // an initial get() is in flight — dedupe concurrent mounts
}

// Keyed by `${area}:${key}` — the same key can live in both areas without
// collision (settings is in sync, the KEYS.* rows in local).
const entries = new Map<string, Entry>()
let listening = false

function storeFor(area: Area): chrome.storage.StorageArea {
  return area === 'local' ? chrome.storage.local : chrome.storage.sync
}

function entryOf(area: Area, key: string): Entry {
  const id = area + ':' + key
  let entry = entries.get(id)
  if (!entry) {
    entry = { snapshot: { raw: undefined, loaded: false }, subscribers: new Set(), reading: false }
    entries.set(id, entry)
  }
  return entry
}

function setSnapshot(entry: Entry, raw: unknown, loaded: boolean): void {
  if (entry.snapshot.raw === raw && entry.snapshot.loaded === loaded) return
  entry.snapshot = { raw, loaded }
  for (const notify of entry.subscribers) notify()
}

// The whole page's single change listener, attached lazily on the first
// subscription. It fans a write out to just the entry that key backs.
function ensureListening(): void {
  if (listening) return
  listening = true
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' && areaName !== 'sync') return
    for (const key of Object.keys(changes)) {
      const entry = entries.get(areaName + ':' + key)
      // `newValue` is absent when the key was removed → back to "absent".
      if (entry) setSnapshot(entry, changes[key].newValue, true)
    }
  })
}

// The initial read for a key — at most once. Once loaded, updates arrive only
// through onChanged, so a remount reuses the warm value instead of re-reading.
function readOnce(area: Area, key: string, entry: Entry): void {
  if (entry.reading || entry.snapshot.loaded) return
  entry.reading = true
  storeFor(area)
    .get(key)
    .then((obj) => {
      entry.reading = false
      // A change event may have answered first while the read was in flight;
      // if so its value is the fresher one — don't clobber it with the read.
      if (entry.snapshot.loaded) return
      // storage.get types its values loosely under this @types/chrome; the read
      // is cast to the contract at the hook's return boundary.
      setSnapshot(entry, obj[key], true)
    })
}

function subscribeEntry(area: Area, key: string, notify: () => void): () => void {
  ensureListening()
  const entry = entryOf(area, key)
  entry.subscribers.add(notify)
  readOnce(area, key, entry)
  return () => {
    entry.subscribers.delete(notify)
    // The entry is kept even at zero subscribers: the value stays warm for the
    // next mount and the single global listener costs nothing to leave live.
    // The page is short-lived (a popup or the dashboard tab), so the map can't
    // grow without bound.
  }
}

export function useStorageValue<T>(area: Area, key: string, fallback: T): { value: T; loaded: boolean } {
  const subscribe = useCallback((notify: () => void) => subscribeEntry(area, key, notify), [area, key])
  const snapshot = useSyncExternalStore(subscribe, () => entryOf(area, key).snapshot)
  const value = snapshot.raw === undefined ? fallback : (snapshot.raw as T)
  return { value, loaded: snapshot.loaded }
}
