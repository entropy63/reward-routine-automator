// The prowl's numbers (user request, 2026-09-09): a small background search
// batch — 2 to 5 searches — at a random moment inside a time window, on all
// the time while the browser runs, toggleable in Settings. The window was a
// hardcoded 15–45 min until 6.8.0, when it became user-settable ("let the
// user choose the time range"); 15–45 stays the fresh-install default. Pure so
// the bounds are unit-tested; the rand parameter defaults to Math.random and
// is injected by the tests for deterministic edges.

export const PROWL_MIN_SEARCHES = 2
export const PROWL_MAX_SEARCHES = 5

// The default window, in ms. Settings store MINUTES (prowlMinIntervalMin /
// prowlMaxIntervalMin) because that is the unit a human thinks in; this module
// converts once, here.
export const PROWL_MIN_MS = 15 * 60_000
export const PROWL_MAX_MS = 45 * 60_000

// The bounds any user-set window may take: no tighter than a minute (a prowl
// every few seconds would hammer Bing), no looser than four hours (a browser
// session might otherwise never see one).
export const PROWL_WINDOW_FLOOR_MS = 60_000
export const PROWL_WINDOW_CEIL_MS = 240 * 60_000

// Sanitize a user-set window (minutes) into a legal ms pair: junk numbers fall
// back to the defaults, the pair is clamped to the floor/ceiling, and an
// inverted pair is swapped rather than trusted. The settings UI cross-clamps
// its two fields so inversion shouldn't happen — this is the belt for stored
// junk and hand-edited blobs.
export function prowlWindowMs(minMin: unknown, maxMin: unknown): [number, number] {
  const read = (v: unknown, fallback: number) =>
    (typeof v === 'number' && Number.isFinite(v) ? v : fallback) * 60_000
  const clamp = (ms: number) => Math.min(PROWL_WINDOW_CEIL_MS, Math.max(PROWL_WINDOW_FLOOR_MS, ms))
  const lo = clamp(read(minMin, PROWL_MIN_MS / 60_000))
  const hi = clamp(read(maxMin, PROWL_MAX_MS / 60_000))
  return lo <= hi ? [lo, hi] : [hi, lo]
}

// The wait until the next prowl: a fresh random draw every round, so the
// rhythm never settles into a pattern a server could fingerprint. The window
// is the pair prowlWindowMs produced from the user's settings.
export function prowlDelayMs(
  rand: () => number = Math.random,
  window: [number, number] = [PROWL_MIN_MS, PROWL_MAX_MS],
): number {
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  return lo + rand() * (hi - lo)
}

// How many searches this prowl runs: 2–5, uniform.
export function prowlSearchCount(rand: () => number = Math.random): number {
  const span = PROWL_MAX_SEARCHES - PROWL_MIN_SEARCHES + 1
  // The clamp is not decoration: rand() === 1 draws the top of the span, and
  // without it floor() would step past the max (2 + floor(1 * 4) = 6).
  const n = PROWL_MIN_SEARCHES + Math.floor(rand() * span)
  return Math.min(PROWL_MAX_SEARCHES, Math.max(PROWL_MIN_SEARCHES, n))
}
