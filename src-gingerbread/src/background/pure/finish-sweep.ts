// The finish sweep's tab-picking, pure so a test can pin it: which tabs the
// end of a routine is allowed to close. This is the dangerous half of the
// sweep — it closes tabs the extension never opened — so the decision lives
// here and the effects (querying, removing, the best-effort wrapping) live in
// core/tabs.ts: closeBingRewardsTabs reads this.

export interface TabLike {
  id?: number | null
  url?: string
  pendingUrl?: string
  pinned?: boolean
}

// A tab's host, or null when the string names no host we can read — an empty
// url, or the relative one chrome reports for a tab that has not committed.
function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

// Bing and Bing Rewards, matched on the HOST rather than on a substring: a
// substring test would close https://example.com/?q=bing.com, which is not a
// Bing tab at all. Host matching also gets the localised and Rewards hosts in
// one rule — www./cn./rewards.bing.com all end in .bing.com, and
// rewards.microsoft.com is the one Microsoft host Rewards serves from.
export function isBingRewardsUrl(url: string | null | undefined): boolean {
  const host = hostnameOf(url)
  if (!host) return false
  return host === 'bing.com' || host.endsWith('.bing.com') || host === 'rewards.microsoft.com'
}

// The dashboard test the Clear-tabs sweep already applies, lifted so the
// 'dashboard.html' rule is spelled in exactly one place.
export function isDashboardUrl(url: string | null | undefined, dashboardMatch: string): boolean {
  return typeof url === 'string' && url.includes(dashboardMatch)
}

export interface SweepOptions {
  // Tabs to leave standing whatever else is true of them: the finish screen
  // just opened, the routine's own stashed tabs (they still have a grace
  // period to sit through), a live batch's tab.
  keepIds: Array<number | null | undefined>
  keepPinned: boolean
  dashboardMatch: string
}

// The ids the finish sweep closes. A tab is spared when it has no id to close
// by, when it was named in keepIds, when it is pinned under keepPinnedTabs,
// when it is a dashboard, or when it is not on Bing at all. Everything else is
// a leftover of a finished routine: the batch's search tab, a manual run's
// leftovers, pages that were opened by hand.
export function pickFinishSweep(tabs: TabLike[], opts: SweepOptions): number[] {
  const keep = new Set<number>(opts.keepIds.filter((id): id is number => typeof id === 'number'))
  const doomed: number[] = []

  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue
    if (keep.has(tab.id)) continue
    if (opts.keepPinned && tab.pinned) continue
    // Either URL can carry the dashboard: a tab mid-navigation reports both,
    // and only pendingUrl while it is still loading.
    if (isDashboardUrl(tab.url, opts.dashboardMatch)) continue
    if (isDashboardUrl(tab.pendingUrl, opts.dashboardMatch)) continue
    // Same for Bing: a tab on its way to a search reports the destination in
    // pendingUrl before url catches up.
    if (isBingRewardsUrl(tab.url) || isBingRewardsUrl(tab.pendingUrl)) doomed.push(tab.id)
  }

  return doomed
}
