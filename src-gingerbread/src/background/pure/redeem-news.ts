// The redeem watch's stock-change logic, extracted from src2's inline
// diffing (readers/redeem.js, 2026-09-03) so it can be unit-tested and so the
// reader stays orchestration-only. Pure: storage in, storage shapes out.

import type { RedeemVariant, StockNews } from '../../shared/storage.ts'

// The diff between the previous variants read and the new one, plus the two
// news records it produces. A label that flipped between reads — restocked,
// or newly sold out — is what the user wants to hear about; one record per
// direction. Labels match case-insensitively, same as the redeem button's
// own label lookup. A first-ever read has no "before" to compare against,
// so it only establishes one (labels unknown to the previous read are
// ignored — no news without a baseline).
export interface StockDiff {
  restockNews: StockNews | null
  soldOutNews: StockNews | null
  restocked: string[]
  soldOut: string[]
}

export function diffStock(
  previous: RedeemVariant[],
  current: RedeemVariant[],
  prevRestockNews: StockNews | null,
  prevSoldOutNews: StockNews | null,
  now: number = Date.now(),
): StockDiff {
  const prevByLabel = new Map(
    (Array.isArray(previous) ? previous : [])
      .filter((v) => v && typeof v.label === 'string')
      .map((v) => [v.label.toLowerCase(), v.available !== false] as const),
  )

  const restocked: string[] = []
  const soldOut: string[] = []
  for (const variant of Array.isArray(current) ? current : []) {
    if (!variant || typeof variant.label !== 'string') continue
    const key = variant.label.toLowerCase()
    if (!prevByLabel.has(key)) continue
    const isAvailable = variant.available !== false
    const wasAvailable = prevByLabel.get(key) === true
    if (isAvailable && !wasAvailable) restocked.push(variant.label)
    else if (!isAvailable && wasAvailable) soldOut.push(variant.label)
  }

  // Every flipped amount leaves the opposite record: a coin that restocks
  // stops being "no longer available", and one that sells out stops being
  // "available".
  const flipped = new Set(
    [...restocked, ...soldOut].map((label) => String(label).toLowerCase()),
  )
  const keepLabels = (news: StockNews | null): string[] =>
    (news && Array.isArray(news.labels) ? news.labels : []).filter(
      (label) => !flipped.has(String(label).toLowerCase()),
    )

  const restockKept = keepLabels(prevRestockNews)
  const soldOutKept = keepLabels(prevSoldOutNews)

  return {
    // null = the record is removed (nothing to say in that direction).
    restockNews:
      restocked.length || restockKept.length
        ? { at: now, labels: [...restockKept, ...restocked] }
        : null,
    soldOutNews:
      soldOut.length || soldOutKept.length
        ? { at: now, labels: [...soldOutKept, ...soldOut] }
        : null,
    restocked,
    soldOut,
  }
}

// The Redeem button's refusal reasons (redeemOnDetailPage's result.reason),
// mapped to the text the Activity row carries. Matched on the reason's
// stable parts so a label tweak in the injection doesn't silence this.
export function redeemRefusalDetail(label: string, reason: string): string {
  const text = String(reason)
  if (text.includes('sold out')) {
    return `"${label}" is sold out — the page says it's restocking.`
  }
  if (text.includes('not enough points') || text.includes('stayed disabled')) {
    return `"${label}" costs more than your points right now.`
  }
  if (text.includes('not found in the picker')) {
    return `"${label}" was not on the page's picker.`
  }
  if (text.includes('timed out')) {
    return `The page never showed a pressable Redeem Now for "${label}".`
  }
  return `Redeem Now was not pressed: ${text}.`
}
