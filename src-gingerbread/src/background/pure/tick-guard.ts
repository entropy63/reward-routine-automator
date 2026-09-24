// The tick loop's re-entrancy decision, pulled out pure so it can be pinned by
// a test (the effectful tick() in routine/search.ts reads it). One beat of the
// search loop must not run while a previous one is still in flight — but the
// guard cannot be a bare boolean, because an await inside a tick can fail to
// settle (a hung chrome.scripting.executeScript against a navigating or crashed
// tab is the field case) while the keep-alive holds the worker up. A boolean
// would then stay set forever, every watchdog beat would no-op, and the batch
// would stall mid-way with nothing scheduled — the user report "sometimes the
// search stuck at half the searches".
//
// So the guard is time-boxed: a tick still in flight past the ceiling is
// presumed wedged and the next beat is allowed to take over. The ceiling sits
// well past any legitimate tick — the worst honest case is a 20s tab-load wait,
// a query fetch that walks every network source at 6s each (~24s), and ~15s of
// human-paced typing, under a minute in all.
export const TICK_STALL_CEILING_MS = 120000

// `startedAt` is 0 when no tick is in flight, otherwise the Date.now() the
// in-flight tick began. Returns whether an arriving beat should run: yes when
// nothing is in flight, or when the in-flight tick has stalled past the ceiling.
export function tickShouldRun(startedAt: number, now: number, ceilingMs = TICK_STALL_CEILING_MS): boolean {
  if (startedAt === 0) return true
  return now - startedAt >= ceilingMs
}
