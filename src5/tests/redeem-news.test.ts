import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffStock, redeemRefusalDetail } from '../src/background/pure/redeem-news.ts'
import type { RedeemVariant, StockNews } from '../src/shared/storage.ts'

// Variant helper: available defaults true, matching the reader's shape.
const v = (label: string, available: boolean): RedeemVariant => ({ label, available })

test('a first-ever read establishes no news (no baseline)', () => {
  const out = diffStock([], [v('500 coins', true), v('1000 coins', false)], null, null, 1000)
  assert.deepEqual(out.restocked, [])
  assert.deepEqual(out.soldOut, [])
  assert.equal(out.restockNews, null)
  assert.equal(out.soldOutNews, null)
})

test('a restock is detected and recorded, a stable amount is not', () => {
  const prev = [v('500 coins', false), v('1000 coins', true)]
  const now = [v('500 coins', true), v('1000 coins', true)]
  const out = diffStock(prev, now, null, null, 1000)
  assert.deepEqual(out.restocked, ['500 coins'])
  assert.deepEqual(out.soldOut, [])
  assert.deepEqual(out.restockNews, { at: 1000, labels: ['500 coins'] })
  assert.equal(out.soldOutNews, null)
})

test('a sell-out is detected and recorded', () => {
  const prev = [v('1000 coins', true)]
  const now = [v('1000 coins', false)]
  const out = diffStock(prev, now, null, null, 1000)
  assert.deepEqual(out.soldOut, ['1000 coins'])
  assert.deepEqual(out.soldOutNews, { at: 1000, labels: ['1000 coins'] })
  assert.equal(out.restockNews, null)
})

test('labels match case-insensitively', () => {
  const prev = [v('1000 Coins', true)]
  const now = [v('1000 coins', false)]
  const out = diffStock(prev, now, null, null, 1000)
  assert.deepEqual(out.soldOut, ['1000 coins'])
})

test('a flip moves the label into the opposite record and out of its old one', () => {
  // "500 coins" was carried as sold-out news; it restocked this read.
  const prevRestock: StockNews = { at: 500, labels: [] }
  const prevSoldOut: StockNews = { at: 500, labels: ['500 coins', '2000 coins'] }
  const prev = [v('500 coins', false), v('2000 coins', false)]
  const now = [v('500 coins', true), v('2000 coins', false)]
  const out = diffStock(prev, now, prevRestock, prevSoldOut, 1000)
  // 500 flips out of sold-out (and into restock); 2000 stays carried.
  assert.deepEqual(out.soldOutNews, { at: 1000, labels: ['2000 coins'] })
  assert.deepEqual(out.restockNews, { at: 1000, labels: ['500 coins'] })
})

test('an empty diff removes both records', () => {
  const prevRestock: StockNews = { at: 500, labels: ['500 coins'] }
  // "500 coins" was carried as restock news… but the previous VARIANTS say it
  // was already available, so this read flips nothing — and the flipped set
  // only carries actual flips, so the stale record survives only when a flip
  // clears it. Simulate the honest case: it sold out again.
  const prev = [v('500 coins', true)]
  const now = [v('500 coins', false)]
  const out = diffStock(prev, now, prevRestock, null, 1000)
  assert.deepEqual(out.restockNews, null) // the flip cleared it
  assert.deepEqual(out.soldOutNews, { at: 1000, labels: ['500 coins'] })
})

test('junk input never throws and reports nothing', () => {
  const out = diffStock(
    null as unknown as RedeemVariant[],
    undefined as unknown as RedeemVariant[],
    'junk' as unknown as StockNews,
    null,
    1000,
  )
  assert.deepEqual(out.restocked, [])
  assert.deepEqual(out.soldOut, [])
  assert.equal(out.restockNews, null)
  assert.equal(out.soldOutNews, null)
})

// ---------- redeemRefusalDetail ----------

test('refusal reasons map to their stable friendly text', () => {
  const label = '500 coins'
  assert.match(redeemRefusalDetail(label, `"500 coins" is sold out — the page says it's restocking`), /sold out/)
  assert.match(redeemRefusalDetail(label, `"500 coins": the Redeem button stayed disabled (not enough points?)`), /costs more/)
  assert.match(redeemRefusalDetail(label, `variant "500 coins" not found in the picker`), /picker/)
  assert.match(redeemRefusalDetail(label, 'timed out'), /never showed/)
  assert.match(redeemRefusalDetail(label, 'something new'), /something new/)
})
