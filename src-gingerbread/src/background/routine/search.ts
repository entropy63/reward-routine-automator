// The web-search batch: start, tick, finish, and the right-sizing
// verification loop (ADR-016). All run-state lives in the one document
// (core/run-state.ts); the verdicts are pure (pure/verdicts.ts) and this
// module is their driver — it performs the effects the verdicts describe.

import { readRunState, updateRunState, currentStopEpoch, isStaleBatch } from '../core/run-state.ts'
import { getSettings } from '../../shared/settings.ts'
import { startKeepAlive, holdKeepAlive, releaseKeepAlive } from '../core/keepalive.ts'
import { scheduleBeat, cancelBeats } from '../core/alarms.ts'
import { randomDelayMillis, sleep } from '../core/delays.ts'
import {
  beginTabCapture,
  endTabCapture,
  claimTab,
  ensureBingTab,
  waitForTabComplete,
  closeCapturedTabs,
} from '../core/tabs.ts'
import { setLastTabAction } from '../core/log.ts'
import { rightSizedCount, judgeSettlement, progressPair, POINTS_PER_SEARCH } from '../pure/verdicts.ts'
import type { SizedBatch } from '../pure/verdicts.ts'
import { tickShouldRun } from '../pure/tick-guard.ts'
import { awaitedQuery, startQueryPrefetch } from '../queries/chain.ts'
import { performHumanTypedSearchOnBing } from '../injections/typed-search.ts'
import { KEYS, getLocal, setLocal } from '../../shared/storage.ts'
import type { Stats } from '../../shared/storage.ts'
import { refreshStats } from './reads.ts'
import { runPendingStartupSteps } from './routine.ts'

// The verification loop's bounds: at most this many batches per loop, and a
// settle wait before the post-batch read — Bing credits a search within
// seconds, and reading immediately would misjudge the last one as not
// counted.
const RIGHT_SIZE_MAX_ROUNDS = 3
const RIGHT_SIZE_SETTLE_MS = 10000
// A read this old is not 'the read that started this loop' — round 2+ skips
// the pre-batch read only while its own starting read is seconds fresh.
const FRESH_AT_WINDOW_MS = 120000

// Start a new batch of web searches. The optional overrides serve the prowl
// (routine/prowl.ts): a random 2–5 count instead of searchesPerBatch, and the
// prowl flag — background tabs, no verification rounds, and no startup-steps
// tail on finish (a random midday batch must not trigger the routine).
export async function startSearchBatch(opts: { count?: number; prowl?: boolean } = {}): Promise<void> {
  cancelBeats() // a second Start must not leave two loops running

  // Stop checkpoint, covering both callers: a stop landing between the
  // routine's own checkpoint (or the popup's click) and the batch write below
  // would otherwise resurrect a batch the user just stopped. The epoch is
  // stable across the setup awaits unless a stop actually happened.
  const myEpoch = await currentStopEpoch()

  const settings = await getSettings()
  const previous = await readRunState()
  const perBatch = Math.max(1, opts.count ?? (Math.floor(settings.searchesPerBatch) || 1))

  // Right-sizing: a FRESH read first — the user's spec is 'check how many
  // points there are before it starts the batch', not 'trust whatever the
  // last read happened to leave'. Rounds 2+ of the verification loop skip
  // it: the read that started them is seconds old (freshAt).
  const priorRun = previous.rightSizeRun
  const continuingRun =
    priorRun && Number.isFinite(priorRun.freshAt) && Date.now() - (priorRun.freshAt as number) < FRESH_AT_WINDOW_MS
      ? priorRun
      : null

  let sized: SizedBatch = { count: perBatch, pair: null, trimmed: false }
  if (settings.rightSizeSearchBatch) {
    if (!continuingRun) {
      await refreshStats()
      // A stop during the read must not go on to open a batch.
      if ((await currentStopEpoch()) !== myEpoch) {
        console.log('Search batch: stopped during the pre-batch read.')
        return
      }
    }
    const stats = await getLocal<Stats>(KEYS.lastStats)
    sized = rightSizedCount(stats, perBatch)
  }

  const { count: batchCount, pair, trimmed } = sized
  if (trimmed && pair) {
    // The search step owns no Activity row, so its news rides the Tabs row —
    // the same row its skip note lands in.
    await setLastTabAction(
      `Search — right-sized to ${batchCount} of ${perBatch} searches (${pair[0]}/${pair[1]} points)`,
      null,
    )
  }

  await beginTabCapture('search')
  // A prowl batch opens its tab in the background — a random midday run must
  // not steal focus from whatever the user is doing.
  const tabId = await ensureBingTab(previous.batch ? previous.batch.tabId : null, opts.prowl === true)
  await claimTab('search', tabId)

  if ((await currentStopEpoch()) !== myEpoch) {
    // Stopped during the setup awaits. Release the capture but leave the tabs
    // open — stopping is not finishing — and never mark the batch running.
    await endTabCapture('search')
    console.log('Search batch: stopped while starting; no searches will run.')
    return
  }

  // The loop's state: written whenever the batch started from a readable
  // partial pair (trimmed or not — 'some searches do not count' needs
  // verifying either way), cleared when sizing is off, the read couldn't
  // produce a pair, or the batch is a prowl (a random 2–5-search background
  // batch must not spin the verification loop, whose round 2+ would run the
  // day's whole remaining cap). The batch field IS the 'running' marker —
  // batch != null. Writing it also clears any manual activity: the batch owns
  // the document now, exactly the v1 'label: null' marker, made structural.
  await updateRunState((state) => {
    state.activity = null
    state.rightSizeRun =
      settings.rightSizeSearchBatch && pair && !opts.prowl
        ? { round: continuingRun ? continuingRun.round : 1, pair }
        : null
    state.batch = {
      runId: (previous.batch ? previous.batch.runId : 0) + 1,
      remaining: batchCount,
      tabId,
      nextRunAt: Date.now(),
      ...(opts.prowl ? { prowl: true } : {}),
    }
  })

  startKeepAlive()
  startQueryPrefetch() // the first search types without waiting on the chain
  tick() // deliberately not awaited: the batch outlives this call
}

// One beat of the loop: run one search, schedule the next.
//
// Re-entrancy guard (tickShouldRun, pure/tick-guard.ts): normally a beat that
// arrives while one is still running is skipped — the in-flight tick's tail
// calls scheduleBeat, so the batch keeps its next beat. But the guard is
// time-boxed rather than a bare boolean: if an await here never settles (a hung
// executeScript against a navigating tab) while the keep-alive holds the worker
// up, a boolean would wedge the whole batch — every watchdog beat no-ops and
// the batch stalls mid-way (user report: "sometimes the search stuck at half
// the searches"). Past the stall ceiling the next beat takes over; the wedged
// tick, if it ever un-hangs, finds its token stale (so it clears nothing) and
// its state writes are runId-guarded either way.
let tickToken = 0
let tickStartedAt = 0 // 0 = no tick in flight; otherwise Date.now() at its start

export async function tick(): Promise<void> {
  const now = Date.now()
  if (!tickShouldRun(tickStartedAt, now)) return
  const myToken = ++tickToken
  tickStartedAt = now

  try {
    const state = await readRunState()
    const batch = state.batch

    if (!batch) {
      cancelBeats()
      return
    }

    if (batch.remaining <= 0) {
      await finishBatch(batch.prowl === true)
      return
    }

    // The watchdog alarm may arrive before the intended moment.
    const remainingWait = (batch.nextRunAt || 0) - Date.now()
    if (remainingWait > 500) {
      startKeepAlive()
      scheduleBeat(remainingWait, tick)
      return
    }

    const runId = batch.runId
    startKeepAlive()

    let tabId = batch.tabId
    try {
      if (tabId == null) throw new Error('batch has no tab id')
      await chrome.tabs.get(tabId)
    } catch {
      // A prowl batch's replacement tab opens in the background too.
      const tab = await chrome.tabs.create({ url: 'https://www.bing.com/', active: !batch.prowl })
      tabId = tab.id ?? null
      if (tabId != null) {
        await claimTab('search', tabId)
        // Guarded so a batch stopped while the replacement tab was opening is
        // not resurrected by this write. A const so the closure captures the
        // resolved id, not the reassignable local.
        const replacementId = tabId
        await updateRunState((s) => {
          if (s.batch && s.batch.runId === runId) s.batch.tabId = replacementId
        })
      }
    }

    // The replacement tab never got an id (create failed): there is nothing to
    // type into, so end this beat. The next watchdog alarm retries.
    if (tabId == null) {
      console.warn('Search tick: no usable tab; ending this beat.')
      return
    }

    // The previous search navigated this tab; the box isn't there until it loads.
    await waitForTabComplete(tabId)
    if (await isStaleBatch(runId)) return

    const { query, api } = await awaitedQuery()
    await setLocal(KEYS.lastQuery, { api, text: query })

    let busyMs = 0
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: performHumanTypedSearchOnBing,
        args: [query],
      })
      busyMs = Number(injection && injection.result) || 0
    } catch (e) {
      console.warn('Search injection failed:', e)
    }

    // The typing is done and the tab is navigating; the NEXT query's
    // fetch chain (storage + up to four network calls) fills the idle
    // delay window instead of gating the next keystroke.
    startQueryPrefetch()

    if (await isStaleBatch(runId)) return

    const current = await readRunState()
    if (!current.batch || current.batch.runId !== runId) return
    const remaining = Math.max(0, current.batch.remaining - 1)

    if (remaining <= 0) {
      await finishBatch(current.batch.prowl === true)
      return
    }

    const settings = await getSettings()
    const delay = busyMs + randomDelayMillis(settings.minDelaySec, settings.maxDelaySec)

    await updateRunState((s) => {
      if (s.batch && s.batch.runId === runId) {
        s.batch.remaining = remaining
        s.batch.nextRunAt = Date.now() + delay
      }
    })
    scheduleBeat(delay, tick)
  } finally {
    // Only the tick that still owns the marker clears it: a superseded, stalled
    // tick that finally resolves must not reopen the guard on a live successor.
    if (tickToken === myToken) tickStartedAt = 0
  }
}

// The post-batch half of right-sizing: re-read the points the batch actually
// reached and, if the cap is still short but the points MOVED, start another
// right-sized batch (some searches not counting is exactly the case the
// pre-batch arithmetic can't see). Returns 'continue' when it started one —
// the caller must then not run the normal batch-end path, because that
// batch's own finishBatch owns it now.
//
// The loop ends at the cap, at no movement between reads, or at
// RIGHT_SIZE_MAX_ROUNDS; every ending clears rightSizeRun so a later batch
// starts a loop of its own. The judgment itself is judgeSettlement
// (pure/verdicts.ts); this is its effectful driver.
async function settleRightSizedRun(): Promise<'done' | 'stopped' | 'continue'> {
  const settings = await getSettings()
  if (!settings.rightSizeSearchBatch) return 'done'

  const state = await readRunState()
  const run = state.rightSizeRun
  if (!run || !Array.isArray(run.pair)) return 'done'

  const myEpoch = await currentStopEpoch()

  await sleep(RIGHT_SIZE_SETTLE_MS)
  if ((await currentStopEpoch()) !== myEpoch) return 'stopped'

  await refreshStats()
  if ((await currentStopEpoch()) !== myEpoch) return 'stopped'

  const stats = await getLocal<Stats>(KEYS.lastStats)
  const nowPair = stats ? progressPair(stats.searchPoints) : null
  // The loop state is consumed here whatever the verdict — the rounds below
  // write their own, and a 'done' leaves the field clear for a later batch.
  await updateRunState((s) => {
    s.rightSizeRun = null
  })

  const decision = judgeSettlement(run, nowPair, RIGHT_SIZE_MAX_ROUNDS, POINTS_PER_SEARCH)
  if (decision.note) await setLastTabAction(decision.note, decision.ok ?? null)
  if (decision.verdict !== 'continue') return 'done'

  // Short of the cap, but the points moved: run what's still needed. The
  // round-N tabs are dealt with exactly as any finished search step's are
  // (perStep closes them; routine mode stashes them for the end sweep), and
  // freshAt tells startSearchBatch its read is seconds old. A 'continue'
  // verdict is only returned by judgeSettlement when nowPair moved, so it is
  // non-null here — the assertion is that contract.
  await closeCapturedTabs('search', 'closeTabsAfterSearch')
  await updateRunState((s) => {
    s.rightSizeRun = { round: run.round + 1, pair: nowPair as [number, number], freshAt: Date.now() }
  })
  await startSearchBatch()
  return 'continue'
}

async function finishBatch(prowl: boolean): Promise<void> {
  cancelBeats()

  // cancelBeats() just dropped the keep-alive, and the verification below
  // (a settle wait plus a dashboard read) runs long enough that the worker
  // could be evicted mid-flight — the loop would die with the batch's state
  // still 'running' (batch != null in the document).
  holdKeepAlive()
  try {
    // The verification loop: a right-sized batch re-reads what it reached and
    // may start another. On 'continue' this finishBatch is done — the new
    // batch's own finishBatch runs the normal end path.
    const verdict = await settleRightSizedRun().catch((e) => {
      console.warn('Search verification failed:', e)
      return 'done' as const
    })
    if (verdict === 'continue') return

    await updateRunState((state) => {
      state.batch = null
      state.rightSizeRun = null
      state.activity = null
    })

    // The remaining startup steps run long enough that the worker could be
    // evicted mid-flight. A prowl batch skips the tail — a random midday
    // mini-batch must not run the routine's pending steps as a side effect.
    await closeCapturedTabs('search', 'closeTabsAfterSearch')
    if (!prowl) await runPendingStartupSteps()
  } finally {
    releaseKeepAlive()
  }
}
