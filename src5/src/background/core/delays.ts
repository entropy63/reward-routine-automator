// The inter-search pacing: a uniformly random delay between the configured
// min and max. Pure (Math.random only) so the range is predictable; the
// non-finite guards keep a hand-edited settings blob from producing a
// negative or NaN wait — anything unparseable falls back to the 5–15s
// default rather than a busy-loop or a never-firing timer.
export function randomDelayMillis(minSec: number, maxSec: number): number {
  const min = Number.isFinite(minSec) ? Math.max(0, minSec) : 5
  const max = Number.isFinite(maxSec) ? Math.max(min, maxSec) : 15
  const randSec = min + Math.random() * (max - min)
  return randSec * 1000
}

// The pause that keeps the worker alive through it lives with the caller
// (core/keepalive.ts); this is just the bare wait.
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
