import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Message, MessageResponse } from '../../shared/messages.ts'
import type { RedeemVariant, Stats } from '../../shared/storage.ts'
import { parsePoints } from '../../background/pure/history.ts'
import { viewVariants } from '../fx/motion-presets.ts'
import { Card } from '../components/Card.tsx'
import { ActionButton } from '../components/ActionButton.tsx'
import { useLastRedeem } from '../hooks/useRedeem.ts'
import { useCountUp } from '../lib/useCountUp.ts'
import { formatNumber } from '../lib/format.ts'

// Overwatch coins price at 10 points per coin (user-confirmed 2026-09-03,
// carried over from src-donut): "500 coins" costs 5,000 points. The button's label
// is this verdict.
function coinPricePts(label: string): number | null {
  const m = /^([\d.,]+)\s+coins?$/i.exec(String(label || '').trim())
  if (!m) return null
  const coins = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(coins) && coins > 0 ? Math.round(coins * 10) : null
}

// The button's verdict: which label, which note, and whether the press runs.
// The page is the real authority either way — a stale stats read can only
// mislabel, never mis-press, because the page-side picker refuses a disabled
// Redeem Now.
function redeemVerdict(
  chosen: RedeemVariant | null,
  variantUrl: string,
  stats: Stats | null,
): { label: string; note: string; disabled: boolean } {
  if (chosen === null) {
    return { label: 'View page', note: 'No amounts yet — Refresh in Stats reads them.', disabled: true }
  }
  if (!chosen || chosen.available === false) {
    return { label: 'View page', note: 'Every amount is sold out right now.', disabled: true }
  }
  if (!variantUrl) {
    return { label: 'View page', note: 'No redeem page yet — Refresh in Stats finds it.', disabled: true }
  }

  const price = coinPricePts(chosen.label)
  const points = parsePoints(stats?.availablePoints)
  if (price == null || Number.isNaN(price)) {
    return { label: 'View page', note: 'Opens the amount’s own redeem page.', disabled: false }
  }
  if (points == null || Number.isNaN(points)) {
    return {
      label: 'View page',
      note: `${formatNumber(price)} pts needed — Refresh in Stats to check yours.`,
      disabled: false,
    }
  }
  if (points >= price) {
    return {
      label: 'Redeem',
      note: `You have ${formatNumber(points)} pts — Redeem Now is pressed on the page.`,
      disabled: false,
    }
  }
  return {
    label: 'View page',
    note: `${formatNumber(price)} pts needed — the page opens, nothing pressed.`,
    disabled: false,
  }
}

// The Redeem view: the coin-amount picker from the watch's last read (sold-out
// amounts disabled so the choice stays honest), the affordability verdict as
// the button's label (src-donut's logic — "Redeem" when the balance covers the
// amount at 10 pts/coin, "View page" otherwise), and a Refresh that fires both
// reads in one burst. The REDEEM_OVERWATCH message carries the detail URL and
// the chosen label; the background prefers the variant's own sku href when the
// last read knows it.
export function Redeem({
  stats,
  send,
  busy,
  motionOn,
}: {
  stats: Stats | null
  send: (message: Message) => Promise<MessageResponse>
  busy: Message['type'] | null
  motionOn: boolean
}) {
  const lastRedeem = useLastRedeem()
  const variants: RedeemVariant[] = (lastRedeem && lastRedeem.variants) || []
  const variantUrl = (lastRedeem && lastRedeem.variantUrl) || ''

  // The selection survives re-reads while the amount is still there — the same
  // keep-or-fallback rule src-donut's picker used.
  const [chosenLabel, setChosenLabel] = useState('')
  const stillThere = variants.some((v) => v.label === chosenLabel && v.available !== false)
  const fallback = variants.find((v) => v.available !== false)?.label || ''
  const chosen = variants.find((v) => v.label === (stillThere ? chosenLabel : fallback)) || null

  const verdict = redeemVerdict(variants.length ? chosen : null, variantUrl, stats)
  const price = chosen ? coinPricePts(chosen.label) : null
  const priceShown = useCountUp(price != null && !Number.isNaN(price) ? price : null, motionOn)

  const refreshing = busy === 'REFRESH_STATS' || busy === 'REFRESH_REDEEM'
  const [note, setNote] = useState('')
  const shownNote = note || verdict.note

  return (
    <motion.div className="view" variants={viewVariants} initial="initial" animate="enter" exit="exit">
      <Card title="Overwatch coins">
        {variants.length ? (
          <ul className="variant-list">
            {variants.map((variant) => {
              const selected = chosen && chosen.label === variant.label
              const vpts = coinPricePts(variant.label)
              return (
                <li key={variant.label}>
                  <button
                    type="button"
                    className={`variant-row${selected ? ' selected' : ''}${variant.available === false ? ' soldout' : ''}`}
                    disabled={variant.available === false}
                    onClick={() => setChosenLabel(variant.label)}
                  >
                    <span className="variant-label">{variant.label}</span>
                    <span className="variant-points">
                      {vpts != null ? `${formatNumber(vpts)} pts` : '—'}
                    </span>
                    {variant.available === false && <span className="variant-state">sold out</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="muted small">No amounts yet — Refresh in Stats reads them.</p>
        )}

        <div className="btn-row">
          <ActionButton
            kind="primary"
            disabled={verdict.disabled || refreshing}
            onClick={() => {
              if (!chosen || !variantUrl) return
              setNote('Opening the redeem page…')
              send({ type: 'REDEEM_OVERWATCH', url: variantUrl, label: chosen.label }).then(() => setNote(''))
            }}
          >
            {verdict.label}
          </ActionButton>
          <ActionButton
            disabled={refreshing}
            busy={refreshing}
            onClick={() => {
              setNote('Reading stats and the redeem catalog…')
              // One burst refreshes both halves of the card: the stats read
              // (the balance the verdict needs) and the redeem watch (the
              // amounts and the detail URL), same as src-donut's Refresh.
              send({ type: 'REFRESH_STATS' }).then(() => {
                send({ type: 'REFRESH_REDEEM' }).then(() => setNote(''))
              })
            }}
          >
            Refresh
          </ActionButton>
        </div>
        <p className="muted small">{shownNote}</p>
        {price != null && !Number.isNaN(price) && priceShown != null && (
          <p className="muted small">
            This amount costs {formatNumber(priceShown)} pts at 10 points per coin.
          </p>
        )}
      </Card>
    </motion.div>
  )
}
