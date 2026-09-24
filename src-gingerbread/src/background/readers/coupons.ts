// The popup's Coupons button (Settings → Experimental features). Opens the
// Rewards dashboard in the foreground, clicks the "Coupon (N)" trigger and
// then presses every "Apply coupon" in the panel that opens. Ported from
// src-donut's readers/coupons.js (2026-09-08). Experimental because no live
// coupon has been run through it yet: the panel's markup is in no capture
// (it renders only after the trigger is clicked), so the page-side claimer
// follows the dump contract (ADR-010) — anything it doesn't recognize lands
// in console.warn with the page text.

import { beginActivity, endActivity, currentStopEpoch } from '../core/run-state.ts'
import { beginTabCapture, claimTab, endTabCapture, waitForTabComplete } from '../core/tabs.ts'
import { setLocal } from '../../shared/storage.ts'
import { KEYS } from '../../shared/storage.ts'
import { claimDashboardCoupons } from '../injections/coupons.ts'
import { REWARDS_DASHBOARD } from './rewards-section.ts'

const REDEEM_HYDRATION_MS = 12000

export async function claimCoupons(): Promise<void> {
  const myEpoch = await beginActivity('Coupons')
  const stopped = (): Promise<boolean> => currentStopEpoch().then((v) => v !== myEpoch)

  try {
    await beginTabCapture('coupons')

    // active: true for the same reason as the redeem button's tab: a
    // user-initiated action on their own account. The tab stays open
    // afterwards in every outcome — the panel is theirs to look at.
    const tab = await chrome.tabs.create({ url: REWARDS_DASHBOARD, pinned: false, active: true })
    await claimTab('coupons', tab.id ?? null)

    if (await stopped()) {
      console.log('Coupons: stopped while opening the page.')
      return
    }

    const loaded = await waitForTabComplete(tab.id!, 15000)
    if (!loaded) console.warn('Coupons: the dashboard did not finish loading in time.')

    if (await stopped()) {
      console.log('Coupons: stopped before the panel could be opened.')
      return
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: claimDashboardCoupons,
      args: [REDEEM_HYDRATION_MS],
    })
    const result = (injection && injection.result) as { opened?: boolean; claimed?: number; reason?: string } | null

    if (result && result.opened) {
      // Everything the panel had is now applied (or already was); the button
      // grays until the next stats read sees a fresh coupon.
      await setLocal(KEYS.lastCoupons, { at: Date.now(), available: 0 })
      console.log(`Coupons: applied ${result.claimed} coupon(s).`)
    } else if (result && result.reason === 'no coupons') {
      await setLocal(KEYS.lastCoupons, { at: Date.now(), available: 0 })
      console.log('Coupons: none available to apply.')
    } else {
      console.warn(
        'Coupons: could not claim —',
        (result && result.reason) || 'no result from the page',
      )
    }
  } catch (e) {
    console.warn('Coupons: failed:', e)
  } finally {
    // Dropped on purpose, same as the redeem button's tail: the tab stays
    // open in every outcome.
    await endTabCapture('coupons')
    await endActivity('Coupons')
  }
}
