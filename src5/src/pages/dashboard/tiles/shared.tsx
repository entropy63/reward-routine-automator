// The tiles' shared pieces (6.8.0 rewrite) — small helpers and sub-cards
// that more than one tile uses (timeAgo, the membership tone, the sku/coin
// catalog math) plus the StreakCard, a pure-presentation sub-card. Extracted
// from the old main.tsx verbatim in behavior.

import { parseStreak } from '../../../background/pure/streaks.ts'

export function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// The membership tier off the header medal ("Gold Member") → a tone for the
// hero badge. The wording is the page's own; the tone falls back to neutral
// for a tier this mapping doesn't know (member, level 2…).
export function membershipTone(name: string | null | undefined): string {
  const v = String(name || '').toLowerCase()
  if (v.includes('gold')) return 'gold'
  if (v.includes('silver')) return 'silver'
  if (v.includes('bronze')) return 'bronze'
  if (v.includes('platinum') || v.includes('diamond')) return 'platinum'
  return 'member'
}

// The coin amount off a catalog card's title ("Overwatch Digital
// Code—1000 Coins" → 1000). Unanchored at the start — titles carry the
// product name in front of the amount.
export function coinCountFromTitle(title: string): number | null {
  const m = /([\d.,]+)\s+coins?$/i.exec(String(title || '').trim())
  if (!m) return null
  const coins = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(coins) && coins > 0 ? coins : null
}

// The sku identity of a redeem href — the query-stripped PATH, resolved
// against the Rewards origin (6.7.18). The catalog's OPTION hrefs are stored
// ABSOLUTE while the VARIANTS' come raw out of the page's RSC payload and
// can be RELATIVE, so a plain string match misses the amount-less sold-out
// tile.
export const skuOf = (href: unknown): string => {
  const s = String(href || '')
  if (!s) return ''
  try {
    return new URL(s, 'https://rewards.bing.com').pathname
  } catch {
    return s.replace(/\?.*$/, '')
  }
}

// One streak, the My-Rewards look the user asked for (2026-09-09): the big
// "Day 4 of 7" the Earn card answers, a dot per day of the cycle (lit behind
// the current day, the current day ringed as today), and today's own task
// progress as a mini bar. A bare "1/1" renders without the day row; nothing
// parsed renders the raw string.
export function StreakCard({ label, value }: { label: string; value: string | null }) {
  const info = parseStreak(value)
  const day = info?.day ?? null
  const of = info?.of ?? null
  const done = info?.done ?? null
  const total = info?.total ?? null
  const complete = done != null && total != null && total > 0 && done >= total
  const pct = done != null && total != null && total > 0 ? Math.min(100, (done / total) * 100) : null

  return (
    <div className={`streak-card${complete ? ' streak-card--done' : ''}`}>
      <span className="streak-card-label">{label}</span>
      {day != null ? (
        <div className="streak-card-day">
          <span className="streak-card-daynum">Day {day}</span>
          {of != null && <span className="streak-card-of">of {of}</span>}
          {complete && <span className="streak-card-check">✓</span>}
        </div>
      ) : done != null && total != null ? (
        <div className="streak-card-day">
          <span className="streak-card-daynum">
            {done}/{total}
          </span>
          {complete && <span className="streak-card-check">✓</span>}
        </div>
      ) : (
        <div className="streak-card-day">
          <span className="streak-card-daynum">{value || '—'}</span>
        </div>
      )}
      {of != null && day != null && (
        <div className="streak-dots" aria-label={`day ${day} of ${of}`}>
          {Array.from({ length: of }, (_, i) => (
            <span
              key={i}
              className={`streak-dot${i < day ? ' streak-dot--lit' : ''}${i === day - 1 ? ' streak-dot--today' : ''}`}
            />
          ))}
        </div>
      )}
      {pct != null && (
        <div className="streak-progress">
          <div className="streak-progress-track">
            <span className="streak-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="streak-progress-text">
            {done}/{total} today
          </span>
        </div>
      )}
    </div>
  )
}
