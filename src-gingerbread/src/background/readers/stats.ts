// Reads the Rewards stats into lastStats: the four top cards plus today's
// progress on four activity streaks. The 2026-09 redesign split the values
// across pages (the dashboard keeps the top cards and the stamp bonus card,
// the streak cards live only on the Earn page), so this reads BOTH pages and
// merges them (pure/merge-stats) — the dashboard with waitMode "cards", the
// Earn page with "streaks", each returning as soon as its own half hydrates.
//
// Runs as the first action of the startup routine and on demand from the
// popup's Refresh button. Never throws — a stats read is a convenience, not a
// routine step that can fail the sequence, so a page that won't load costs
// one console.warn and leaves the last stats untouched.
//
// The tab handling closes only the tabs THIS run opened: there is no per-step
// close toggle for a read (nothing is being earned, so there is nothing to
// give a grace period to), and the tabs were opened for this one read. The one
// exception is a stop — a stopped run leaves them open, because stopping is
// not finishing.

import { beginActivity, endActivity, currentStopEpoch } from '../core/run-state.ts'
import { localDayKey } from '../core/day.ts'
import { closeTabs, waitForTabComplete } from '../core/tabs.ts'
import { holdKeepAlive, releaseKeepAlive } from '../core/keepalive.ts'
import { setLastStatsLog } from '../core/log.ts'
import { getSettings } from '../../shared/settings.ts'
import { KEYS, getLocal, setLocal } from '../../shared/storage.ts'
import type { HistoryEntry, RawStats } from '../../shared/storage.ts'
import { mergeStats } from '../pure/merge-stats.ts'
import { parsePoints, recordDay } from '../pure/history.ts'
import { readRewardsStats } from '../injections/stats-read.ts'
import { readCouponCount } from '../injections/coupons.ts'
import { REWARDS_DASHBOARD, REWARDS_EARN } from './rewards-section.ts'

// How long the page-side stats reader waits for the React app to hydrate
// before reporting whatever it could find. The cards render first, the
// activity tiles slightly later, so the poll outlives "complete" alone.
const STATS_HYDRATION_MS = 12000
// The coupon count rides on a dashboard tab the stats reader has already
// waited out (STATS_HYDRATION_MS above), so its own poll only needs to
// cover the trigger's late render — not a full hydration.
const COUPON_READ_MS = 5000

// In-flight guards, shared with the redeem watch (readers/redeem.ts): a
// burst (Refresh button, popup-open refresh, the routine's stats step) fires
// both reads together, and nothing stops a SECOND burst from starting while
// the first still reads — the popup's pending guard covers one popup session
// only. Two overlapping runs used to sweep each other's read tabs through the
// shared capture lists, so each runner refuses to double up and closes
// only the tab(s) it opened itself.
export const READ_RUN_GUARDS: { stats: boolean; redeem: boolean; orders: boolean } = {
  stats: false,
  redeem: false,
  orders: false,
}

// One page of the two-page read, returned so the merge and the dumps can reach
// its tab. Escalation-probe and evidence shapes are page-derived, so they are
// read back as loose objects and cast at this boundary.
interface PageRead {
  tabId: number
  stats: RawStats | null
}

export async function refreshStats(): Promise<void> {
  if (READ_RUN_GUARDS.stats) {
    console.log('Stats: a read is already running; skipping.')
    return
  }
  READ_RUN_GUARDS.stats = true

  // The read outlives the idle window: a 15s load wait plus a 12s hydration
  // poll per page, mostly silent (a tab listener and a page-side loop), so an
  // unheld worker could be evicted mid-read — killing the finally's tab sweep
  // (the read tabs stay open) and the lastStats write. Hold the keep-alive for
  // the whole read, like closeCapturedTabs does.
  holdKeepAlive()

  // Marks this run as the current activity so the popup's Stop button covers
  // it too; the returned epoch tells this run when it has been stopped.
  const myEpoch = await beginActivity('Stats')
  const stopped = (): Promise<boolean> => currentStopEpoch().then((v) => v !== myEpoch)

  // The tabs this run opened (closed in the finally). The shared capture list
  // is reset by every new run, so two overlapping bursts used to sweep each
  // other's tabs.
  const ownTabIds: number[] = []

  // Returns { tabId, stats } — stats may be null when the page never answered
  // — or null outright when the run was stopped (the merge and the dump both
  // treat that as "no page").
  async function readPage(url: string, waitMode: string, label: string): Promise<PageRead | null> {
    // Background tab: a read is never meant to be seen (the tab closes when the
    // read finishes), and an active tab would steal focus — which closes an
    // open popup mid-refresh.
    const tab = await chrome.tabs.create({ url, pinned: false, active: false })
    const tabId = tab.id
    if (tabId == null) {
      console.warn(`Stats: the ${label} tab opened without an id.`)
      return null
    }
    ownTabIds.push(tabId)

    // A stop that landed while the tab was opening. Stopping is not finishing:
    // the tab stays open and the injection never runs.
    if (await stopped()) {
      console.log(`Stats: stopped while opening the ${label} tab.`)
      return null
    }

    const loaded = await waitForTabComplete(tabId, 15000)
    if (!loaded) console.warn(`Stats: ${label} page did not finish loading in time.`)

    // Stop checkpoint after the load wait: the injection is the part a stop is
    // meant to prevent.
    if (await stopped()) {
      console.log(`Stats: stopped before the ${label} reader could run.`)
      return null
    }

    // The visibility escalation: a hidden tab never gets a render pass, so the
    // Today's-points flyout the reader needs to click open may never open in a
    // tab the browser will not draw. This watcher probes the read's own press
    // log (window.__meowPointsPress, updated every poll); once several presses
    // have been made and the card still shows no sign of opening, the tab is
    // moved into a small unfocused popup window (focused:false, so the user's
    // focus and an open popup are not stolen), which makes the document visible
    // without reloading it. The read keeps running; the next press lands in a
    // tab that renders, and the read still closes the tab in its own sweep.
    let escalation: Promise<unknown> | null = null
    const watcher = setInterval(async () => {
      try {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const log = (window as { __meowPointsPress?: { presses: number; everExpanded?: boolean } })
              .__meowPointsPress
            return log
              ? {
                  presses: log.presses,
                  everExpanded: !!log.everExpanded,
                  visibility: document.visibilityState,
                }
              : null
          },
        })
        const seen = probe && probe.result
        if (seen && seen.presses >= 3 && !seen.everExpanded && seen.visibility === 'hidden') {
          clearInterval(watcher)
          escalation = chrome.windows
            .create({ tabId, type: 'popup', focused: false })
            .catch((e) => console.warn(`Stats: could not show the ${label} tab:`, e))
        }
      } catch {
        // The tab closed mid-read (the sweep, a stop) — nothing to escalate.
        clearInterval(watcher)
      }
    }, 2000)

    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: readRewardsStats,
        args: [STATS_HYDRATION_MS, waitMode],
      })
      return { tabId, stats: ((injection && injection.result) || null) as RawStats | null }
    } catch (e) {
      console.warn(`Stats: ${label} injection ended early:`, e)
      return { tabId, stats: null }
    } finally {
      clearInterval(watcher)
      await escalation
    }
  }

  // The dump contract, same as the other readers: when the Earn page answers
  // none of the four streaks, warn the markup the reader was staring at — the
  // live page drifts under a passing suite, and this is the only channel that
  // shows what it actually looked like. The evidence is also RETURNED — the
  // Activity row (setLastStatsLog) carries it as hover text.
  async function dumpEarnEvidence(tabId: number): Promise<{ url: string; streaksMarkup: string } | null> {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const section =
            document.getElementById('streaks') ||
            document.querySelector('.react-aria-DisclosurePanel') ||
            document.body
          return {
            url: location.href,
            streaksMarkup: section.outerHTML.slice(0, 1500),
          }
        },
      })
      if (injection && injection.result) {
        console.warn('Stats: the Earn page answered no streaks. Markup (report to dev):', injection.result)
      }
      return (injection && injection.result) || null
    } catch (e) {
      console.warn('Stats: could not dump the Earn page markup:', e)
      return null
    }
  }

  // The search-points breakdown refinement loop: a miss (merged.searchPoints ==
  // null) dumps the Today's points card — expanded by the read's own click —
  // from every read tab that still carries one, so the next matcher revision
  // gets written against that markup.
  async function dumpPointsEvidence(tabId: number): Promise<Record<string, unknown> | null> {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const labels = Array.from(document.querySelectorAll('p.text-labelControl'))
          const label = labels.find((el) =>
            /^today.?s points$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim()),
          )
          const card = label ? label.closest('a, button') : null
          if (!card) return null
          const controlled = card.getAttribute('aria-controls')
          const panel = controlled ? document.getElementById(controlled) : null
          // The read's own press record plus the tab's visibility — the facts
          // that split "the press never registered" from "the flyout opened and
          // closed again" from "hidden tab" on the next live miss.
          const press = (
            window as {
              __meowPointsPress?: {
                presses: number
                everExpanded?: boolean
                everControlled?: boolean
                visibility?: string
              }
            }
          ).__meowPointsPress
          return {
            url: location.href,
            expanded: card.getAttribute('aria-expanded'),
            visibility: document.visibilityState,
            presses: press ? press.presses : 0,
            everExpanded: press ? !!press.everExpanded : false,
            everControlled: press ? !!press.everControlled : false,
            pressVisibility: press ? press.visibility || '' : '',
            cardMarkup: card.outerHTML.slice(0, 2000),
            panelMarkup: panel ? panel.outerHTML.slice(0, 2000) : null,
          }
        },
      })
      if (injection && injection.result) {
        console.warn(
          'Stats: the search-points breakdown did not answer. Markup (report to dev):',
          injection.result,
        )
      }
      return (injection && injection.result) || null
    } catch (e) {
      // A tab that already closed (the read's own sweep, a stop) is not a
      // refinement lead worth a warning of its own.
      console.warn('Stats: could not dump the points card markup:', e)
      return null
    }
  }

  try {
    // Both pages at once: the reads are independent — separate tabs, separate
    // injections, each returning as soon as its own half hydrates — so the
    // refresh costs the SLOWER page's time, not the sum of both. The streak
    // cards are Earn-only (2026-09 redesign), so the Earn read is what answers
    // the four activity stats; the merge and every guard below are unchanged (a
    // stopped or failed read is null either way).
    const [dashboardRead, earnRead] = await Promise.all([
      readPage(REWARDS_DASHBOARD, 'cards', 'dashboard'),
      readPage(REWARDS_EARN, 'streaks', 'Earn'),
    ])
    if ((dashboardRead === null || earnRead === null) && (await stopped())) {
      return
    }

    // The coupon trigger ("Coupon (N)") lives on the dashboard tab this read
    // has already waited out, so its own poll only needs to cover the
    // trigger's late render — not a full hydration. A null result (nothing
    // recognized) keeps the last good count.
    try {
      const [couponInjection] = await chrome.scripting.executeScript({
        target: { tabId: dashboardRead!.tabId },
        func: readCouponCount,
        args: [COUPON_READ_MS],
      })
      const couponCount = (couponInjection && couponInjection.result) as number | null
      if (typeof couponCount === 'number') {
        await setLocal(KEYS.lastCoupons, { at: Date.now(), available: couponCount })
      } else {
        console.warn('Coupons: the count read returned nothing; keeping the last count.')
      }
    } catch (e) {
      console.warn('Stats: the coupon count read ended early:', e)
    }

    const dashboardStats = dashboardRead && dashboardRead.stats
    const earnStats = earnRead && earnRead.stats

    // The Activity row's evidence: every miss reports WHY, not just that, and
    // carries the markup its reader stared at as the row's hover text.
    const problems: string[] = []
    const dumps: string[] = []
    if (dashboardStats == null) problems.push('the dashboard page did not answer')
    if (earnStats == null) problems.push('the Earn page did not answer')

    if (earnRead && Object.values((earnStats && earnStats.activities) || {}).every((v) => v == null)) {
      const evidence = await dumpEarnEvidence(earnRead.tabId)
      if (evidence) dumps.push(evidence.streaksMarkup || '')
      // Only when the page answered at all — a null read already reported
      // itself above as "did not answer".
      if (earnStats) problems.push('the Earn page answered no streaks')
    }

    const merged = mergeStats(dashboardStats, earnStats)

    // The breakdown refinement loop: only when neither page's panel answered,
    // and only on tabs still alive — the dump returns null on a page without
    // the card. The PROBLEM is only named when a page actually answered.
    if (merged.searchPoints == null) {
      for (const read of [dashboardRead, earnRead]) {
        if (!read) continue
        const evidence = await dumpPointsEvidence(read.tabId)
        if (evidence) {
          dumps.push(
            'expanded=' +
              evidence.expanded +
              ' ' +
              'visibility=' +
              evidence.visibility +
              ' ' +
              'presses=' +
              (evidence.presses || 0) +
              ' ' +
              'everExpanded=' +
              !!evidence.everExpanded +
              ' ' +
              'everControlled=' +
              !!evidence.everControlled +
              ' ' +
              (evidence.pressVisibility ? 'pressVisibility=' + evidence.pressVisibility + ' ' : '') +
              ((evidence.panelMarkup as string) || (evidence.cardMarkup as string) || ''),
          )
        }
      }
      if (dashboardStats != null || earnStats != null) {
        problems.push('the search-points breakdown did not answer')
      }
    }

    // An all-null merge is two pages that never answered, not a Rewards account
    // with nothing to show — store nothing rather than overwriting the last
    // good stats with empties and a fresh timestamp.
    const found =
      merged.availablePoints != null ||
      merged.readyToClaim != null ||
      merged.dailyStreak != null ||
      merged.stampBonus != null ||
      merged.searchPoints != null ||
      Object.values(merged.activities || {}).some((v) => v != null)

    if (found) {
      await setLocal(KEYS.lastStats, { ...merged, at: Date.now() })
      console.log('Stats: read the dashboard and the Earn page.')

      // The points history (ADR-020): one balance snapshot per local day — the
      // day's first and its latest — so the popup can show earned-today and a
      // trend line. Pure math in pure/history; this is the only write. A read
      // without a balance records nothing, keeping the last good snapshot.
      const points = parsePoints(merged.availablePoints)
      if (points != null) {
        const history = await getLocal<HistoryEntry[]>(KEYS.pointsHistory)
        await setLocal(KEYS.pointsHistory, recordDay(history, localDayKey(), points))
      }
    } else {
      console.warn('Stats: the readers found nothing; keeping the last stats.')
    }

    // The row itself — but stopping is not failing: a stopped run reports
    // nothing (the user cancelled it; there is no outcome to log).
    if (!(await stopped())) {
      await setLastStatsLog(
        problems.length
          ? 'Stats — ' + problems.join('; ') + '.'
          : found
            ? 'Stats — read the dashboard and the Earn page.'
            : 'Stats — the readers found nothing; kept the last stats.',
        problems.length === 0 && found,
        dumps.join('\n'),
      )
    }
  } finally {
    // Closes only the tabs THIS run opened. A stopped run leaves them open —
    // stopping is not finishing.
    if (ownTabIds.length && !(await stopped())) {
      const settings = await getSettings()
      const closed = await closeTabs(ownTabIds, settings.keepPinnedTabs)
      if (closed) console.log(`Closed ${closed} tab(s) opened by "stats".`)
    }

    await endActivity('Stats')
    releaseKeepAlive()
    READ_RUN_GUARDS.stats = false
  }
}
