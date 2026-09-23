// The Rewards-API probe (Developer Option, 2026-09-08): a one-shot capture of
// every way the Rewards pages themselves answer "what are the stats" — in
// service of the "use the webpage API instead of the classes" question. The
// DOM-class readers are the fragile half of the extension (the 2026-09
// redesign broke every selector at once); if the pages' own JSON APIs answer
// the same facts, the stats reader could collapse to one fetch + a field map.
//
// What a run does, in order:
//   1. opens the Rewards dashboard in a background tab, with ?meowprobe=1 —
//      the marker that arms the document_start MAIN-world hook
//      (content/api-logger.ts) BEFORE the app bundle makes its initial
//      authenticated API calls (a post-load hook always misses them),
//   2. waits for hydration, then clicks the "Today's points" flyout open —
//      the exact interaction the stats reader performs,
//   3. navigates the same tab to the Earn page (marker kept) and captures
//      there too,
//   4. fetches getuserinfo from INSIDE the Earn tab (same-origin — the auth
//      cookies attach; the worker's own cross-site fetch cannot do this and
//      is kept in the report as a documented failure), and
//   5. saves the whole report — page-captured calls with request headers
//      (secrets redacted) and bodies, both fetches with shape maps and full
//      JSON, plus page diagnostics — to a JSON file in the Downloads folder
//      via the downloads API.
//
// The report is REAL ACCOUNT DATA on the user's machine: it must never enter
// the repo (same rule as the live-DOM captures). The Activity row carries
// the headline, so the popup confirms it ran.

import { beginActivity, endActivity, currentStopEpoch } from '../core/run-state.ts'
import { sleep } from '../core/delays.ts'
import { closeTabs, waitForTabComplete } from '../core/tabs.ts'
import { holdKeepAlive, releaseKeepAlive } from '../core/keepalive.ts'
import { setLastTabAction } from '../core/log.ts'
import { getSettings } from '../../shared/settings.ts'
import {
  clickTodayPointsFlyout,
  pageHasCards,
  readPageApiLog,
  pageFacts,
  fetchGetuserinfoInPage,
} from '../injections/api-log.ts'

// The probe's tabs carry the marker that arms the document_start content
// script (content/api-logger.ts) — without it the hook stays dormant and the
// app's initial authenticated API calls go uncaptured.
const REWARDS_DASHBOARD = 'https://rewards.bing.com/dashboard?meowprobe=1'
const REWARDS_EARN = 'https://rewards.bing.com/earn?meowprobe=1'
const GETUSERINFO_URL = 'https://rewards.bing.com/api/getuserinfo?type=1'

// One captured page call, read back from the MAIN-world logger's DOM holder
// as a loose object and typed at this boundary. The hook records EVERY
// http(s) call unfiltered (bundle chunks included) — a filtered first run
// captured nothing on a fully signed-in page, so nothing is filtered now.
interface ApiCall {
  kind?: string
  url?: string
  method?: string
  status?: number
  contentType?: string
  requestHeaders?: Record<string, string> | null
  body?: string
  bodyError?: string
  bodyOmitted?: boolean
  error?: string
}

interface FetchRecord {
  where: string
  status: number
  contentType: string
  kb: number
  finalUrl: string
  shape: unknown
  json: unknown
  error?: string
}

// The raw in-page fetch result, read back as a loose object and typed here.
interface PageFetchRaw {
  ok?: boolean
  status?: number
  contentType?: string
  finalUrl?: string
  body?: string
  error?: string
}

// One big inline <script> from the page — the server-rendered state the app
// hydrates from, if that is where the stats live.
interface StateScript {
  id?: string
  type?: string
  length?: number
  head?: string
}

// Where the page actually ended up — the diagnostics the first probe run
// lacked (it captured nothing and could not say why). `resources` and
// `stateScripts` answer the deeper question a hooked-but-empty log raises:
// either the page makes calls the hook somehow missed (they show in
// resource timing) or it made none because the data is server-rendered
// (it shows in the inline state scripts).
interface PageFacts {
  url?: string
  title?: string
  loggerPresent?: boolean
  cardLabels?: string[]
  resources?: string[]
  stateScripts?: StateScript[]
}

interface PageCapture {
  url: string
  hydrated: boolean
  flyoutClicked: boolean | null
  facts: PageFacts | null
  apiCalls: ApiCall[]
}

interface ProbeReport {
  at: string
  note: string
  fetches: {
    workerDirect: FetchRecord | null
    inPage: FetchRecord | null
  }
  pages: {
    dashboard: PageCapture
    earn: PageCapture
  }
}

// A readable map of the JSON: value types instead of values, arrays sampled
// at their first element, objects capped at depth 3. The map is what a field
// naming pass reads; the values live in the full dump beside it.
function shapeOf(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.length ? [shapeOf(value[0], depth)] : []
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= 3) return '{…}'
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shapeOf(v, depth + 1)
    }
    return out
  }
  return typeof value
}

// Injects a no-arg page-side function and returns its result (null on a
// failed call — the probe reports, it never throws). MAIN world for the
// logger (it must wrap the page's own fetch), ISOLATED for the DOM readers.
// The func may return a promise — executeScript awaits it before answering.
async function inject<T>(tabId: number, func: () => T | Promise<T>, world: 'MAIN' | 'ISOLATED'): Promise<T | null> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      world,
    })
    return (injection && (injection.result as T)) ?? null
  } catch (e) {
    console.warn('Rewards API probe: a page call failed:', e)
    return null
  }
}

// One page of the capture. The fetch/XHR hook is already live — the
// document_start content script armed itself from the URL marker before the
// app bundle ran — so this half only waits for the cards to render, tries
// the "Today's points" flyout (attempted on BOTH pages: the first live run
// showed the label on the Earn page in the current design, and the click is
// a harmless no-op where the card is absent), lets the calls settle, and
// reads the log plus the page's own facts back.
async function capturePage(tabId: number, url: string): Promise<PageCapture> {
  const deadline = Date.now() + 15000
  let hydrated = false
  while (Date.now() < deadline) {
    if ((await inject(tabId, pageHasCards, 'ISOLATED')) === true) {
      hydrated = true
      break
    }
    await sleep(500)
  }
  const flyoutClicked = (await inject(tabId, clickTodayPointsFlyout, 'ISOLATED')) === true
  await sleep(4000)
  const apiCalls = ((await inject(tabId, readPageApiLog, 'ISOLATED')) as ApiCall[] | null) || []
  const facts = await inject<PageFacts>(tabId, pageFacts, 'ISOLATED')
  return {
    url,
    hydrated,
    flyoutClicked,
    facts,
    apiCalls,
  }
}

// The worker's own getuserinfo fetch — a DIAGNOSTIC, never the payload: from
// the extension origin the request is cross-site, rewards.bing.com's auth
// cookies are SameSite-protected so they do not attach, and the endpoint
// answers with a 302 to login.windows.net that the fetch cannot follow
// (CORS), so it rejects with "Failed to fetch" (observed live, 2026-09-08).
// The report keeps the failure to document that; the payload that matters is
// the same-origin fetch from inside the rewards tab (inPageFetch below).
async function workerDirectFetch(): Promise<FetchRecord> {
  const record: FetchRecord = {
    where: 'worker (cross-site)',
    status: 0,
    contentType: '',
    kb: 0,
    finalUrl: '',
    shape: null,
    json: null,
  }
  try {
    let response = await fetch(GETUSERINFO_URL, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    })
    if (!response.ok) {
      response = await fetch(GETUSERINFO_URL, { credentials: 'include' })
    }
    const text = await response.text()
    record.status = response.status
    record.contentType = response.headers.get('content-type') || ''
    record.kb = Math.round(text.length / 102.4) / 10
    record.finalUrl = response.url
    try {
      record.json = JSON.parse(text)
      record.shape = shapeOf(record.json)
    } catch {
      record.error = 'response was not JSON'
    }
  } catch (e) {
    record.error = String(e instanceof Error ? e.message : e)
  }
  return record
}

// The same endpoint fetched from inside the rewards tab — same-origin, so the
// auth cookies attach. This is the fetch an API-backed reader would use.
async function inPageFetch(tabId: number): Promise<FetchRecord | null> {
  const raw = (await inject<PageFetchRaw>(tabId, fetchGetuserinfoInPage, 'ISOLATED')) || null
  if (!raw) return null
  const record: FetchRecord = {
    where: 'in-page (same-origin)',
    status: raw.status ?? 0,
    contentType: raw.contentType || '',
    kb: raw.body ? Math.round(raw.body.length / 102.4) / 10 : 0,
    finalUrl: raw.finalUrl || '',
    shape: null,
    json: null,
  }
  if (!raw.ok) {
    record.error = raw.error || 'the page fetch failed'
    return record
  }
  try {
    record.json = raw.body ? JSON.parse(raw.body) : null
    record.shape = shapeOf(record.json)
  } catch {
    record.error = 'response was not JSON'
  }
  return record
}

// The saved file is written through a data URL — the only body channel an
// MV3 service worker has (no createObjectURL there) — and data URLs are
// size-sensitive, so an oversized report drops the captured bodies to
// stubs rather than failing the download. (Chrome ignored the filename on
// the data-URL download in the first live run and saved it as
// "download.json" — harmless; find the newest JSON in the Downloads folder.)
async function downloadReport(report: ProbeReport): Promise<string | null> {
  let text = JSON.stringify(report, null, 2)
  if (text.length > 2_000_000) {
    for (const page of [report.pages.dashboard, report.pages.earn]) {
      page.apiCalls = page.apiCalls.map((c) =>
        c.body ? { ...c, body: c.body.slice(0, 400) + (c.body.length > 400 ? '…' : '') } : c,
      )
    }
    text = JSON.stringify(report, null, 2)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `rewards-api-probe-${stamp}.json`
  try {
    await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(text),
      filename,
      saveAs: false,
    })
    return filename
  } catch (e) {
    console.warn('Rewards API probe: could not save the file:', e)
    return null
  }
}

export async function probeRewardsApi(): Promise<void> {
  // The run outlives the idle window (two page loads, two hydration waits,
  // settle sleeps — ~45s), so the worker needs holding like a stats read.
  holdKeepAlive()
  const myEpoch = await beginActivity('API probe')
  const stopped = (): Promise<boolean> => currentStopEpoch().then((v) => v !== myEpoch)

  // The tab is never meant to be seen; the Activity row and the saved file
  // are the report.
  const tab = await chrome.tabs.create({ url: REWARDS_DASHBOARD, pinned: false, active: false })
  const tabId = tab.id

  try {
    if (tabId == null) throw new Error('the probe tab opened without an id')
    await waitForTabComplete(tabId, 15000)
    const dashboard = await capturePage(tabId, REWARDS_DASHBOARD)
    if (await stopped()) return

    await chrome.tabs.update(tabId, { url: REWARDS_EARN })
    await waitForTabComplete(tabId, 15000)
    const earn = await capturePage(tabId, REWARDS_EARN)
    if (await stopped()) return

    // The payload fetch, from inside the settled Earn tab; the worker's own
    // cross-site attempt rides along as a documented failure.
    const pageFetch = await inPageFetch(tabId)
    const workerFetch = await workerDirectFetch()

    const report: ProbeReport = {
      at: new Date().toISOString(),
      note: 'Local probe output — real account data. Never commit this file.',
      fetches: { workerDirect: workerFetch, inPage: pageFetch },
      pages: { dashboard, earn },
    }
    console.log('Rewards API probe: full report (local console only):', report)
    const filename = await downloadReport(report)

    const calls = dashboard.apiCalls.length + earn.apiCalls.length
    const fetchLine =
      pageFetch && pageFetch.json != null
        ? `in-page fetch HTTP ${pageFetch.status}, ${pageFetch.kb} KB`
        : 'in-page fetch failed'
    await setLastTabAction(
      `Dev — Rewards API probe: ${calls} page call(s) captured, ${fetchLine} — ${filename ? `saved to Downloads as ${filename}` : 'download failed (see worker console)'}`,
      !!filename,
    )
  } catch (e) {
    console.warn('Rewards API probe failed:', e)
    await setLastTabAction(
      `Dev — Rewards API probe failed: ${String(e instanceof Error ? e.message : e)}`,
      false,
    )
  } finally {
    if (tabId != null && !(await stopped())) {
      const settings = await getSettings()
      await closeTabs([tabId], settings.keepPinnedTabs)
    }
    await endActivity('API probe')
    releaseKeepAlive()
  }
}
