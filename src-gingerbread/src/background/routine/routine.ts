// The startup routine: the ordered step sequence, its skip-when-done
// verdicts, the post-search tail, and the end-of-routine sweep. The
// routine's own state (start day, pending tail, stashed tabs, skip list) is
// one field of the run-state document rather than four storage keys — a stop
// clears all of it in the single stop write, and endRoutine consumes it
// atomically via consumeRoutine().

import { localDayKey } from '../core/day.ts'
import { getSettings } from '../../shared/settings.ts'
import type { Settings, StepId } from '../../shared/settings.ts'
import { readRunState, updateRunState, currentStopEpoch, consumeRoutine } from '../core/run-state.ts'
import { holdKeepAlive, releaseKeepAlive } from '../core/keepalive.ts'
import { sleep } from '../core/delays.ts'
import { closeTabs } from '../core/tabs.ts'
import { setLastTabAction, setLastRewards, reportImageSearch } from '../core/log.ts'
import { KEYS, getLocal, setLocal } from '../../shared/storage.ts'
import type { Activities, SkippedStep, Stats } from '../../shared/storage.ts'
import { slotMissingDefaults } from '../pure/orders.ts'
import { STEP_DONE_CHECKS, statsAreCurrent, stepSkipReason } from '../pure/verdicts.ts'
import { refreshStats, checkRedeemAvailability } from './reads.ts'
import { startSearchBatch } from './search.ts'
import { runStartupClaim } from '../readers/claim.ts'
import { openDailySetOnRewardsDashboard, openKeepEarningActivities } from '../readers/rewards-section.ts'
import { runRandomImageSearch } from '../images/image-search.ts'

// How long the routine's cancel-before-start dialog waits for an answer
// before silence counts as consent.
const ROUTINE_CONFIRM_TIMEOUT_MS = 15000
// The routine's finish screen (6.8.0): the DASHBOARD, opened with the streak
// summary in the ?q= query — the finish overlay covers the board until the
// user presses Done (which blurs out to it), instead of a blank tab or a
// page of its own.
const FINISH_URL = 'dashboard.html'
// The finish-page settle: after the last routine step, wait this long, then
// re-read stats before building the summary — see endRoutine.
const ROUTINE_FINISH_SETTLE_MS = 3000

// ---------- The step registry ----------

interface StartupStep {
  enabledKey: keyof Settings
  run: () => Promise<void>
}

// The startup steps, keyed by the ids stored in settings.startupOrder. The
// popup mirrors these ids in each step row.
const STARTUP_STEPS: Record<StepId, StartupStep> = {
  // First key on purpose: normalizeStartupOrder() slots a step missing from a
  // saved order at its default index, so existing users get the stats read
  // slotted first, matching the new default order — it must reflect the day
  // before the steps churn the dashboard.
  stats: {
    enabledKey: 'statsStartupEnabled',
    run: () => runStartupReads(),
  },
  claim: {
    enabledKey: 'claimStartupEnabled',
    run: () => runStartupClaim(),
  },
  dailySet: {
    enabledKey: 'dailySetStartupEnabled',
    run: () => openDailySetOnRewardsDashboard(),
  },
  keepEarning: {
    enabledKey: 'keepEarningStartupEnabled',
    run: () => openKeepEarningActivities(),
  },
  search: {
    enabledKey: 'searchStartupEnabled',
    run: () => startSearchBatch(),
  },
  imageSearch: {
    enabledKey: 'imageSearchStartupEnabled',
    run: () => runRandomImageSearch(),
  },
}

export const DEFAULT_STARTUP_ORDER = Object.keys(STARTUP_STEPS) as StepId[]

// Tolerates a stale or hand-edited value: unknown ids and duplicates go, and
// anything missing is slotted into its default position. Mirrored in the popup.
export function normalizeStartupOrder(order: StepId[] | null | undefined): StepId[] {
  return slotMissingDefaults(order, DEFAULT_STARTUP_ORDER)
}

// The routine's opening reads, as one step: the Rewards stats (dashboard +
// Earn pages, merged), then the redeem watch — src-donut's second half. Both are
// convenience reads that never throw, so the watch cannot fail the step the
// stats read just passed. As a step it can be turned off (statsStartupEnabled)
// and dragged around like any other; the default order keeps it first so the
// numbers still reflect the day before the steps churn the dashboard.
async function runStartupReads(): Promise<void> {
  await refreshStats()
  await checkRedeemAvailability()
}

// ---------- Skip-when-done ----------

// The routine's skip verdict for a step: a reason string when today's read
// already shows it done, null when it should run. The verdicts themselves
// are pure (pure/verdicts.ts); this adds the one effect they refuse to have
// — reading today's stats.
async function routineStepSkipped(id: StepId): Promise<string | null> {
  if (!STEP_DONE_CHECKS[id]) return null

  const stats = await getLocal<Stats>(KEYS.lastStats)
  if (!statsAreCurrent(stats)) return null

  // statsAreCurrent guarantees stats is present and today's; the cast is that
  // guarantee expressed to the type system (it is not a type predicate).
  return stepSkipReason(id, stats as Stats)
}

// A skipped step says so in the Activity section, in its own row where it
// has one. The search step owns no row (its rows show the last query, which
// a skip must not fabricate), so its note lands in the Tabs row — the
// routine's news row, which already carries the end-of-routine sweep line.
async function reportSkippedStep(id: StepId, reason: string): Promise<void> {
  const labels: Partial<Record<StepId, string>> = {
    search: 'Search',
    claim: 'Claim',
    dailySet: 'Daily set',
    keepEarning: 'Keep earning',
    imageSearch: 'Image search',
  }
  const detail = `${labels[id] || id} — skipped, ${reason}`
  if (id === 'claim' || id === 'dailySet' || id === 'keepEarning') {
    await setLastRewards(detail, null)
  } else if (id === 'imageSearch') {
    await reportImageSearch(`skipped, ${reason}`, null)
  } else {
    await setLastTabAction(detail, null)
  }
  // The finish page names what was skipped: the record rides in the run-state
  // document because the post-search tail finishes in a later worker
  // instance, and endRoutine() consumes it when the page opens.
  await updateRunState((state) => {
    if (state.routine) state.routine.skipped.push({ id, reason })
  })
}

// ---------- The confirm dialog ----------

// Resolver of the routine's cancel-before-start dialog: the answer message
// and the awaiting confirmRoutineStart() are separate functions, so the live
// prompt's outcome crosses through here. Null while no prompt is waiting —
// which is what makes a stale click after the timeout a no-op.
let routineConfirmResolver: ((proceed: boolean) => void) | null = null
// Window id of that dialog, so windows.onRemoved (wired in the background)
// can tell it from any other window.
let routineConfirmWindowId: number | null = null

// The routine's cancel-before-start dialog. Resolves true when the routine
// may run ('Start now', the timeout, or no windows API to ask with) and
// false when the user cancelled. The wait lives inside the async onStartup
// handler, within the worker's 30s idle window — same pattern as the
// grace-period sleeps in closeCapturedTabs().
export function confirmRoutineStart(): Promise<boolean> {
  // Very old Chrome: no API to ask with, so the routine is never blocked on it.
  if (!(chrome.windows && chrome.windows.create)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let settled = false

    const settle = (proceed: boolean): void => {
      if (settled) return
      settled = true
      routineConfirmResolver = null
      // Taking the dialog down fires onRemoved too; the nulled resolver above
      // is what makes that a no-op. The remove() itself can reject if the
      // window is already gone — fine either way.
      if (routineConfirmWindowId != null) {
        chrome.windows.remove(routineConfirmWindowId).catch(() => {})
        routineConfirmWindowId = null
      }
      resolve(proceed)
    }

    // Handed to the answer message and the onRemoved listener; nulled by
    // settle() after use, so a click arriving after the outcome is a no-op.
    routineConfirmResolver = settle

    // The 15s window: silence means the user is away, and this is an
    // automator — proceed rather than dropping the routine on the floor.
    setTimeout(() => settle(true), ROUTINE_CONFIRM_TIMEOUT_MS)

    chrome.windows
      .create({
        url: 'confirm.html',
        type: 'popup',
        // Sized to fit the React page-card (max-width 460 + the page's 24px
        // body padding, and the card's full height) — the old 420×220 was
        // sized for the plain pre-React page and clipped the card to a
        // glyph-ish sliver, which read as a stray icon on the desktop rather
        // than a dialog.
        width: 510,
        height: 350,
        focused: true,
      })
      .then((win) => {
        // The prompt never went up — the routine must not hang waiting on an
        // answer nobody can give.
        if (!win) {
          console.warn('Startup: confirm dialog could not be shown.')
          settle(true)
          return
        }
        routineConfirmWindowId = win.id ?? null
      })
      .catch((e) => {
        console.warn('Startup: confirm dialog could not be shown:', e)
        settle(true)
      })
  })
}

// The dialog's buttons reporting in (the 'routineConfirmAnswer' message).
// A stale message after the prompt settled finds a nulled resolver and is a
// no-op.
export function answerRoutineConfirm(proceed: boolean): void {
  if (routineConfirmResolver) routineConfirmResolver(proceed === true)
}

// The dialog's window closing without an answer (windows.onRemoved, wired in
// the background). Dismissing the dialog is an explicit gesture, so closing
// the window counts as Cancel — only the 15s timeout (user away) proceeds on
// its own.
export function routineConfirmWindowRemoved(windowId: number): void {
  if (windowId !== routineConfirmWindowId || !routineConfirmResolver) return
  routineConfirmResolver(false)
}

// ---------- The finish page's queries ----------

// The finish page's streak summary, built from the last stats read: which
// activities read as not-done, as 'key:label;key:label' (the query the page
// parses). A display string's trailing progress pair is the verdict — the
// same parse the popup's Bing-app banner uses, so the page and the banner
// can never disagree about whether a streak is done. A null or unparseable
// value never enters the query: the page should say 'every streak is
// complete' only when a read actually answered, not because a value went
// missing. Returns '' when every answered streak is done — a query-less page
// is the plain 'The daily routine finished.'
export async function routineSummaryQuery(): Promise<string> {
  const stats = await getLocal<Stats>(KEYS.lastStats)
  const activities: Partial<Activities> = (stats && stats.activities) || {}
  const parts: string[] = []
  for (const key of ['bingSearch', 'dailySet', 'bingApp', 'visualSearch'] as (keyof Activities)[]) {
    const value = activities[key]
    const match = String(value == null ? '' : value).match(/(\d+)\s*\/\s*(\d+)\s*$/)
    if (!match) continue // not answered — no verdict to report
    const done = Number(match[1]) >= Number(match[2]) && Number(match[2]) > 0
    if (!done) parts.push(`${key}:${value}`)
  }
  return parts.join(';')
}

// The finish page's skip list: which steps the routine skipped as already
// done, as 'id:reason;id:reason' (the ?s= query the page parses — the same
// compact shape the streak summary's ?q= uses). Reasons come from the
// routine's own verdicts, which carry no ';' or ':'; an entry that somehow
// does is dropped rather than mis-parsed.
export function routineSkippedQuery(skipped: SkippedStep[]): string {
  return (Array.isArray(skipped) ? skipped : [])
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.reason === 'string' &&
        entry.id &&
        entry.reason &&
        !entry.id.includes(':') &&
        !entry.reason.includes(':') &&
        !entry.reason.includes(';'),
    )
    .map((entry) => `${entry.id}:${entry.reason}`)
    .join(';')
}

// ---------- The sequence ----------

// The sequence. `manual` (the popup's 'Run the routine' button, ADR-020)
// opts out of the first two LAUNCH gates — the master switch and the
// once-per-day skip — because a button press is an explicit user action that
// must always be able to run. The confirm dialog still asks (user request,
// 2026-09-07): 'Ask before running' promises a chance to cancel every start.
// Everything else is identical: the per-step skip-when-done verdicts still
// apply (no search batch at 60/60), a Stop still cancels, the finish page
// still opens, and a genuinely finished routine still marks its day (so the
// launch routine does not redo what the manual one completed).
// Why a startup sequence ended. 'ran' even when the search batch carries the
// tail (startSearchBatch's handoff IS the routine running); the skip reasons
// let the scheduled driver surface them to the Activity row instead of a
// console.log nobody reads.
export type StartupOutcome = 'ran' | 'disabled' | 'already-today' | 'cancelled'

export async function runStartupSequence(
  { manual = false, scheduled = false }: { manual?: boolean; scheduled?: boolean } = {},
): Promise<StartupOutcome> {
  const settings = await getSettings()

  // A stop during an earlier step must also cancel the steps not started yet:
  // stopAllActivity() bumps the epoch, and a mismatch means 'stopped'.
  const myEpoch = await currentStopEpoch()

  // A sequence interrupted by the last shutdown must not resume now that a
  // fresh one is starting, and tab ids from the last session are meaningless.
  // The start day goes too: whatever it held belongs to the dead sequence.
  // One write: the routine field and the capture bookkeeping are both inside
  // the document.
  await updateRunState((state) => {
    state.routine = null
    state.captures = { capturing: [], opened: {} }
  })

  // The master switch governs BROWSER STARTS only: a scheduled run answers to
  // its own toggle (scheduledRunEnabled, checked by routine/scheduled.ts —
  // the clock never fires the routine the user didn't opt into), and a manual
  // press IS the permission to run (ADR-020).
  if (!manual && !scheduled && !settings.startupEnabled) return 'disabled'

  // Once per day: if the routine already completed today, don't redo it on a
  // second browser launch. The stale-state cleanup above has already run by
  // here, which is what we want either way — the skip is the whole routine.
  // (lastRoutineDay stays a key of its own, outside the document: it is the
  // whole point that it survives stops, updates and evictions.)
  if (!manual && settings.startupOncePerDay) {
    const lastDay = await getLocal<string>(KEYS.lastRoutineDay)
    if (lastDay === localDayKey()) {
      console.log('Startup: routine already ran today — skipping.')
      return 'already-today'
    }
  }

  // Last gate: with 'Ask before running' on, the user gets a 15s window to
  // cancel before a single tab opens. It sits after the once-per-day skip on
  // purpose — there is nothing to ask about when the routine would not run
  // anyway — and before the routine field is set, so a cancel leaves nothing
  // routine-shaped behind. Manual runs ask too (user request, 2026-09-07):
  // the Run view's button starts the SAME routine, and 'Ask before running'
  // reads as a promise about every start — the button press confirms intent,
  // not the details. Scheduled runs are the one exemption (2026-09-12, the
  // user's schedule silently never ran): a time the user set IS the intent —
  // an unattended 15s window would auto-cancel every scheduled round, making
  // the whole feature dead on arrival with the confirm default-on.
  if (settings.confirmBeforeRoutine && !scheduled && !(await confirmRoutineStart())) {
    // Cancel: same shape as the once-per-day skip above — stale state away,
    // nothing routine-shaped left. lastRoutineDay is NOT written: today does
    // not count as done, so the next launch retries the routine.
    await updateRunState((state) => {
      state.routine = null
      state.captures = { capturing: [], opened: {} }
    })
    console.log('Startup: routine cancelled at the confirm dialog.')
    return 'cancelled'
  }

  const queue = normalizeStartupOrder(settings.startupOrder).filter(
    (id) => settings[STARTUP_STEPS[id].enabledKey],
  )

  // Marks every step below as part of the routine, so in routine mode their
  // tabs are stashed for endRoutine() instead of closed per step. The start
  // day is captured here so endRoutine() can credit THAT day, even if the
  // sequence finishes after midnight in a later worker instance.
  await updateRunState((state) => {
    state.routine = { startDay: localDayKey(), pendingSteps: [], pendingTabs: [], skipped: [] }
  })

  // A fresh read before the steps: the skip-when-done verdicts below must
  // judge the dashboard as it is NOW, not as an older same-day read left it —
  // a morning's '0 pending' must not skip an evening claim that has points
  // waiting. The stats step IS that read when it leads the queue (the default
  // order); when it is turned off or moved later, the read runs here instead,
  // so every verdict is made on current numbers either way. No
  // verdict-carrying step in the queue → no extra read.
  if (queue[0] !== 'stats' && queue.some((id) => STEP_DONE_CHECKS[id])) {
    await refreshStats()
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]

    // Stop checkpoint: a bumped epoch means the remaining steps, this one
    // included, are cancelled.
    if ((await currentStopEpoch()) !== myEpoch) break

    // Skip-when-done: a step whose today's read already shows complete never
    // runs — no search batch at 60/60, no claim at 0 pending. Checked before
    // the search branch on purpose: a skipped search means the rest of the
    // sequence simply continues inline, with no batch to hand the tail to.
    const skipReason = await routineStepSkipped(id)
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`)
      await reportSkippedStep(id, skipReason)
      continue
    }

    // The batch runs for minutes after startSearchBatch() resolves, so the rest
    // of the sequence is handed to finishBatch() instead of racing it. The
    // routine stays live — endRoutine() is runPendingStartupSteps' business.
    if (id === 'search') {
      const rest = queue.slice(i + 1)
      try {
        if (rest.length) {
          await updateRunState((state) => {
            if (state.routine) state.routine.pendingSteps = rest
          })
        }
        await startSearchBatch()
        return 'ran'
      } catch (e) {
        console.warn('Startup: web search batch failed to start:', e)
        await updateRunState((state) => {
          if (state.routine) state.routine.pendingSteps = []
        })
        continue // nothing to wait for; keep going inline
      }
    }

    try {
      await STARTUP_STEPS[id].run()
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e)
    }
  }

  // The sequence ran to its end inline — no search batch to wait for. A no-op
  // after a stop: the stop write already nulled the routine, so the stashed
  // tabs are never swept.
  await endRoutine()
  return 'ran'
}

// The tail of the startup sequence, once the web search batch has finished.
export async function runPendingStartupSteps(): Promise<void> {
  const state = await readRunState()
  // Also reached when the batch was the last step: the queue is empty but the
  // routine is still live, and the stashed tabs still need their sweep.
  if (!state.routine) return
  const queue = state.routine.pendingSteps as StepId[]
  if (!queue.length) {
    await endRoutine()
    return
  }

  // Same stop checkpoint as the main sequence. Captured BEFORE the queue is
  // claimed below: a stop landing between the claim and the capture would
  // otherwise slip past this checkpoint, and the whole tail would run after
  // the stop it was supposed to see.
  const myEpoch = await currentStopEpoch()

  // Claim the queue before running it: a step that starts another batch must
  // not be able to trigger this a second time.
  await updateRunState((s) => {
    if (s.routine) s.routine.pendingSteps = []
  })

  // The tail re-reads before judging the claim: the search batch just spent
  // minutes earning points, and 'ready to claim' is the one verdict-carrying
  // number those searches can move — an answer captured before the batch must
  // not skip a claim the batch itself earned. The other verdicts (daily set,
  // visual search) are untouched by web searches, and a stats step leading
  // this tail queue is itself the read.
  if (queue.includes('claim') && queue[0] !== 'stats') {
    await refreshStats()
  }

  for (const id of queue) {
    if ((await currentStopEpoch()) !== myEpoch) break

    const step = STARTUP_STEPS[id]
    if (!step || id === 'search') continue

    // Same skip-when-done verdict as the main loop — the post-search tail
    // holds steps too, and a fresh claim/daily-set/image-search answer in
    // today's read skips them here exactly as it would have inline.
    const skipReason = await routineStepSkipped(id)
    if (skipReason) {
      console.log(`Startup: skipping "${id}" — ${skipReason}.`)
      await reportSkippedStep(id, skipReason)
      continue
    }

    try {
      await step.run()
    } catch (e) {
      console.warn(`Startup: step "${id}" failed:`, e)
    }
  }

  // A no-op after a stop: the stop write already nulled the routine, so the
  // stashed tabs stay open with everything else.
  await endRoutine()
}

// The end of a startup sequence. In routine mode this is the one moment the
// stashed tabs are all closed at once; a no-op when no routine ran, so callers
// don't need to care which mode they're in. A routine that genuinely finished
// also marks the day it started as done for the once-per-day gate.
export async function endRoutine(): Promise<void> {
  // Read the routine and clear it as ONE step — a stop landing between the
  // read and the clear would otherwise let a stopped routine sweep its
  // stashed tabs.
  const consumed = await consumeRoutine()
  if (!consumed) return

  // Only a live routine gets this far, i.e. a routine truly finished (inline
  // end or post-search-batch tail — both land here). A stopped routine never
  // does: the stop write already nulled it, so the no-op return above is what
  // a stop sees, and the day stays unmarked. The START day is what gets
  // marked, not the finish day: a routine that crosses midnight belongs to
  // the day it began, or the new day would be silently marked done without
  // ever getting its routine.
  await setLocal(KEYS.lastRoutineDay, consumed.startDay || localDayKey())

  // The finish-page timing fix (REQUEST #1): the streak-completing steps —
  // image search and the daily set — only read as done in a stats read taken
  // AFTER they run, but the routine's opening read (and the search
  // right-sizing) happened BEFORE them. Without a final re-read the finish
  // page would list a just-completed visual-search or daily-set streak as
  // still pending. So settle briefly (Bing credits within seconds), then
  // re-read, so routineSummaryQuery() below reflects post-step streak state.
  // Guarded: a read is a convenience, never a reason the finish page fails to
  // open — refreshStats never throws, but the settle and the call are wrapped
  // regardless.
  try {
    await sleep(ROUTINE_FINISH_SETTLE_MS)
    await refreshStats()
  } catch (e) {
    console.warn('Routine: the finish-page stats re-read failed:', e)
  }

  const skippedQuery = routineSkippedQuery(consumed.skipped)
  const ids = consumed.pendingTabs.filter((id) => typeof id === 'number')

  // The finish screen: after the sweep below the user would be left staring at
  // whatever the routine's tabs last showed — so the dashboard opens instead,
  // its overlay saying the routine is done and listing the streaks they have
  // to finish themselves (the Bing-app check-in, usually) and the steps it
  // skipped as already done. Foreground and never auto-closed: the user is
  // the only one who takes the overlay down (Done blurs it out to their
  // board), and the Clear-tabs action exempts the dashboard's URL.
  try {
    const summary = await routineSummaryQuery()
    const params = new URLSearchParams()
    if (summary) params.set('q', summary)
    if (skippedQuery) params.set('s', skippedQuery)
    await chrome.tabs.create({
      url: `${FINISH_URL}${params.toString() ? `?${params.toString()}` : ''}`,
      active: true,
    })
  } catch (e) {
    // The summary is a nicety, never a failure of the routine itself.
    console.warn('Routine: could not open the finish screen:', e)
  }

  if (!ids.length) return

  // Stop checkpoint for the sweep below. Captured here rather than at the
  // top: by this point the routine genuinely finished, so a stop that landed
  // earlier was already caught by the consume guard above.
  const myEpoch = await currentStopEpoch()

  const settings = await getSettings()
  const graceMs = Math.max(0, Number(settings.tabCloseDelaySec) || 0) * 1000

  // Same shape as closeCapturedTabs: credit the visits, keep the worker alive.
  holdKeepAlive()
  try {
    if (graceMs) await sleep(graceMs)
    // A stop during the grace period must leave the stashed tabs open —
    // stopping is not finishing, exactly like the per-step close above.
    if ((await currentStopEpoch()) !== myEpoch) {
      console.log('Routine tab sweep skipped: stopped during the grace period.')
      return
    }
    const closed = await closeTabs(ids, settings.keepPinnedTabs)
    if (closed) {
      console.log(`Closed ${closed} tab(s) after the routine.`)
      await setLastTabAction(`Closed ${closed} tab(s) after the routine`, true)
    }
  } finally {
    releaseKeepAlive()
  }
}
