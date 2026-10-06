import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isBingRewardsUrl,
  isDashboardUrl,
  pickFinishSweep,
  type SweepOptions,
  type TabLike,
} from '../src/background/pure/finish-sweep.ts'

// The finish sweep closes tabs the extension never opened, so the picking is
// the part that has to be right: every case below is a tab that must survive,
// or one that must not.

const DASHBOARD = 'dashboard.html'

const base = (): SweepOptions => ({ keepIds: [], keepPinned: true, dashboardMatch: DASHBOARD })

const pick = (tabs: TabLike[], over: Partial<SweepOptions> = {}) =>
  pickFinishSweep(tabs, Object.assign(base(), over))

test('a Bing or Rewards URL is recognised', () => {
  for (const url of [
    'https://www.bing.com/',
    'https://www.bing.com/search?q=cats',
    'https://bing.com/',
    'https://cn.bing.com/search?q=cats&cc=cn',
    'https://rewards.bing.com/',
    'https://rewards.bing.com/dashboard',
    'https://rewards.microsoft.com/',
    'http://www.bing.com/', // the scheme does not matter, the host does
  ]) {
    assert.equal(isBingRewardsUrl(url), true, `${url} should be a Bing/Rewards URL`)
  }
})

test('a lookalike is not a Bing URL — the match is on the host, not a substring', () => {
  for (const url of [
    'https://example.com/?q=bing.com',
    'https://notbing.com/',
    'https://bing.com.example.com/', // bing.com as a label, not the host
    'https://example.com/https://www.bing.com/',
    'https://rewards.microsoft.com.example.com/',
    'https://account.microsoft.com/',
    'chrome-extension://abcdefghijklmnop/dashboard.html',
    'about:blank',
    '',
  ]) {
    assert.equal(isBingRewardsUrl(url), false, `${url} should not be a Bing/Rewards URL`)
  }
})

test('a URL that cannot be parsed names no host, so it is spared', () => {
  assert.equal(isBingRewardsUrl('not a url'), false)
  assert.equal(isBingRewardsUrl(undefined), false)
  assert.equal(isBingRewardsUrl(null), false)
})

test('the dashboard rule matches either URL and ignores an unparseable one', () => {
  assert.equal(isDashboardUrl('chrome-extension://abc/dashboard.html', DASHBOARD), true)
  assert.equal(isDashboardUrl('chrome-extension://abc/dashboard.html?q=x', DASHBOARD), true)
  assert.equal(isDashboardUrl('https://www.bing.com/', DASHBOARD), false)
  assert.equal(isDashboardUrl(undefined, DASHBOARD), false)
})

test('every Bing and Rewards tab is closed', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'https://www.bing.com/' },
    { id: 2, url: 'https://www.bing.com/search?q=cats' },
    { id: 3, url: 'https://rewards.bing.com/' },
    { id: 4, url: 'https://rewards.microsoft.com/' },
  ]
  assert.deepEqual(pick(tabs), [1, 2, 3, 4])
})

test('everything that is not on Bing survives', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'https://github.com/' },
    { id: 2, url: 'https://example.com/?q=bing.com' },
    { id: 3, url: 'about:blank' },
    { id: 4, url: undefined },
  ]
  assert.deepEqual(pick(tabs), [])
})

test('a tab still loading is judged by its pendingUrl', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'about:blank', pendingUrl: 'https://www.bing.com/search?q=cats' },
    { id: 2, url: 'https://github.com/', pendingUrl: 'https://example.com/' },
  ]
  assert.deepEqual(pick(tabs), [1])
})

test('the dashboards are never swept, the finish screen included', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'chrome-extension://abc/dashboard.html' },
    { id: 2, url: 'https://www.bing.com/', pendingUrl: 'chrome-extension://abc/dashboard.html' },
  ]
  assert.deepEqual(pick(tabs), [])
})

test('keepIds spares the routine\'s own tabs and the live batch tab', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'https://www.bing.com/' },
    { id: 2, url: 'https://www.bing.com/search?q=cats' },
    { id: 3, url: 'https://rewards.bing.com/' },
  ]
  assert.deepEqual(pick(tabs, { keepIds: [1, 2] }), [3])
  // A null in the list is not an id and spares nothing (the finish screen's id
  // when it failed to open).
  assert.deepEqual(pick(tabs, { keepIds: [null, undefined] }), [1, 2, 3])
})

test('pinned tabs are spared only while keepPinnedTabs is on', () => {
  const tabs: TabLike[] = [
    { id: 1, url: 'https://www.bing.com/', pinned: true },
    { id: 2, url: 'https://www.bing.com/', pinned: false },
  ]
  assert.deepEqual(pick(tabs, { keepPinned: true }), [2])
  assert.deepEqual(pick(tabs, { keepPinned: false }), [1, 2])
})

test('a tab with no id cannot be closed, so it is skipped', () => {
  const tabs: TabLike[] = [
    { id: undefined, url: 'https://www.bing.com/' },
    { id: null, url: 'https://www.bing.com/' },
    { id: 7, url: 'https://www.bing.com/' },
  ]
  assert.deepEqual(pick(tabs), [7])
})
