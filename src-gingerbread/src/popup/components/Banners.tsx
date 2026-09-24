import { AnimatePresence, motion } from 'framer-motion'
import type { Stats, StockNews } from '../../shared/storage.ts'
import { useRestockNews, useSoldOutNews } from '../hooks/useRedeem.ts'

// The banners above the stage (src-donut parity, 2026-09-03 wording kept): the
// Bing-app warning (danger — the one step the routine genuinely cannot do,
// it only counts from the real phone app), a restock (green), and a newly
// sold-out Overwatch amount (orange). NOT dismissible: the banners show while
// the page's state says so, and the watch clears a record only when the
// amount flips back — there is no close glyph on any of these.
//
// The preview prop is the Developer Option "preview every banner" button's
// sample payloads (DOM-only in src-donut, local state here): nothing touches
// storage, so the preview vanishes on the next popup open or the next real
// record landing.

function BingAppBanner({ stats }: { stats: Stats | null }) {
  // The Bing-app activity value is a display string: the Earn page's streak
  // card answers "Day 0 of 1 · 0/1", the dashboard's tile a bare "0/1" — the
  // trailing progress pair is the check-in state in both (null / no pair
  // leaves the banner off).
  const appMatch = String(stats?.activities?.bingApp || '').match(/(\d+)\s*\/\s*(\d+)\s*$/)
  const appStalled = !!appMatch && Number(appMatch[1]) === 0 && Number(appMatch[2]) > 0

  return (
    <AnimatePresence>
      {appStalled && (
        <motion.div
          className="banner banner--danger"
          role="alert"
          title="This one only counts from the Bing phone app — the routine can’t finish it for you."
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 11 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        >
          {/* Short by request (2026-09-03, kept from src-donut): the banner only
           * says the check-in wasn't done; the why rides along as hover text. */}
          Bing app check-in not done yet today.
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function NewsBanner({ news, prefix, tone }: { news: StockNews | null; prefix: string; tone: 'good' | 'warn' }) {
  const labels = (news && Array.isArray(news.labels)) ? news.labels : []
  return (
    <AnimatePresence>
      {labels.length > 0 && (
        <motion.div
          className={`banner banner--${tone}`}
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 11 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        >
          {prefix}
          {labels.join(', ')}.
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Banners({
  stats,
  preview,
}: {
  stats: Stats | null
  preview: boolean
}) {
  const restock = useRestockNews()
  const soldOut = useSoldOutNews()

  // The dev preview overrides both news reads with sample payloads — one
  // restocked amount, one sold-out — plus the un-done Bing-app check-in, so
  // the wording and styling can be checked without waiting for the real
  // thing (nothing touches storage; the preview vanishes with the state).
  const previewNews = (labels: string[]): StockNews => ({ at: Date.now(), labels })
  const previewStats: Stats | null = preview
    ? {
        ...(stats || { availablePoints: null, readyToClaim: null, dailyStreak: null, stampBonus: null, searchPoints: null, activities: { bingSearch: null, dailySet: null, bingApp: null, visualSearch: null } }),
        activities: { ...(stats?.activities || { bingSearch: null, dailySet: null, bingApp: null, visualSearch: null }), bingApp: '0/1' },
      }
    : stats

  return (
    <div className="banners">
      <BingAppBanner stats={previewStats} />
      <NewsBanner news={preview ? previewNews(['500 coins']) : restock} prefix="Overwatch coins available: " tone="good" />
      <NewsBanner news={preview ? previewNews(['2000 coins']) : soldOut} prefix="No longer available: " tone="warn" />
    </div>
  )
}
