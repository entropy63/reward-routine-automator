// The Overwatch coins catalog tile (6.8.0 rewrite): the redeem options as
// balance-vs-price cards; pressing a card opens that amount's redeem page
// in the foreground — navigation only, never an automatic Redeem press
// (spending points stays a deliberate act on the page).
//
// Designed steps → variants: the 2×1 mini is the one-row catalog of compact
// LINES (the user's exact ask, 2026-09-10: "It should be one row. It will
// fit"). The WIDER 1-tall seats (4×1, 6×1) show the full card catalog in a
// single horizontal row (user, 2026-09-11: "When the Overwatch coin catalog
// is set to 1:4 it should display the full tile, not the small version") —
// the same cards as the 2-row seats, one line of furniture shorter. The
// variant comes from the step's own width/height, not its index (the steps
// are a lattice).

import { useLastRedeem } from '../../../popup/hooks/useRedeem.ts'
import { useStats } from '../../../popup/hooks/useStats.ts'
import { formatNumber } from '../../../popup/lib/format.ts'
import { parsePoints } from '../../../background/pure/history.ts'
import { sendMessage } from '../../../shared/messages.ts'
import { coinCountFromTitle, skuOf } from './shared.tsx'
import { Tile } from './Tile.tsx'
import type { TileProps } from './Tile.tsx'

// Overwatch coins price at 10 points per coin (user-confirmed 2026-09-03): a
// card with no printed price falls back to this rule; the card's own points
// string wins when it carries one.
const POINTS_PER_COIN = 10

export function CatalogTile({ seat, ...rest }: TileProps) {
  const lastRedeem = useLastRedeem()
  const stats = useStats()
  const available = parsePoints(stats?.availablePoints)
  const variants = (lastRedeem && lastRedeem.variants) || []
  // The seat's own width/height picks the variant — the 2×1 mini is the
  // compact lines, the wider 1-tall seats a single horizontal ROW of the full
  // cards, and the 2-row seats the card grids.
  const asLines = seat.h === 1 && seat.w <= 2
  const asRow = seat.h === 1 && !asLines

  if (!lastRedeem || !lastRedeem.options.length) {
    return (
      <Tile id="catalog" title="Overwatch coins — catalog" seat={seat} {...rest}>
        <p className="dash-muted">No catalog read yet — Refresh reads the /redeem search results.</p>
      </Tile>
    )
  }

  // The variants keyed by their sku PATH (the option hrefs are stored
  // ABSOLUTE, the variant hrefs can be RELATIVE, and the raw string match
  // missed the live one) — the unlabeled carousel tiles ("Overwatch Coin
  // Digital Code", no amount, no price — often the sold-out ones) carry the
  // amount only in their variant label, so the sku is what ties them
  // together.
  const variantByHref = new Map<string, (typeof variants)[number]>()
  for (const v of variants) {
    const h = skuOf(v.href)
    if (h) variantByHref.set(h, v)
  }
  const coinsOf = (opt: (typeof lastRedeem.options)[number]): number | null =>
    coinCountFromTitle(opt.title) ?? coinCountFromTitle(variantByHref.get(skuOf(opt.href))?.label || '')
  // Dedupe the carousel's unpriced duplicate tiles by coin amount (keep the
  // priced card), then cheapest first — the balance bar reads as "work your
  // way up".
  const byCoin = new Map<number, (typeof lastRedeem.options)[number]>()
  const unlabeled: (typeof lastRedeem.options)[number][] = []
  for (const opt of lastRedeem.options) {
    const coins = coinsOf(opt)
    if (coins == null) {
      unlabeled.push(opt)
      continue
    }
    const prev = byCoin.get(coins)
    if (!prev || (!prev.points && opt.points)) byCoin.set(coins, opt)
  }
  const sorted = [
    ...[...byCoin.entries()].sort((a, b) => a[0] - b[0]).map(([, o]) => o),
    ...unlabeled,
  ]

  return (
    <Tile id="catalog" title="Overwatch coins — catalog" seat={seat} {...rest}>
      {asLines ? (
        /* The one-row catalog (the user's exact ask): title, points, stock
         * chip — one line per amount, ellipsized, never wrapped (a wrapped
         * line is a second row, and a second row is what one track can't
         * pay for). */
        <div className="coin-lines">
          {sorted.map((opt) => {
            const coins = coinsOf(opt)
            const variant = variantByHref.get(skuOf(opt.href))
            const out = variant ? variant.available === false : opt.available === false
            const afford = coins != null && available != null && available >= (parsePoints(opt.points) ?? coins * POINTS_PER_COIN)
            return (
              <button
                key={opt.title}
                type="button"
                className={`coin-line${out ? ' coin-line--out' : afford ? ' coin-line--afford' : ''}`}
                title={opt.href ? 'Open the redeem page for this amount' : undefined}
                disabled={!opt.href}
                onClick={() => opt.href && sendMessage({ type: 'OPEN_REDEEM_PAGE', url: opt.href })}
              >
                <span className="coin-line-title">{coins != null ? `${formatNumber(coins)} coins` : opt.title}</span>
                <span className="coin-line-points">{opt.points || '—'}</span>
                <span className="coin-line-state">{out ? 'sold out' : afford ? 'affordable' : 'in stock'}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className={`coin-catalog${asRow ? ' coin-catalog--row' : ''}`}>
          {sorted.map((opt) => {
            const coins = coinsOf(opt)
            // The detail page's variant is the stock authority; the card's
            // own heuristic answers only when it doesn't.
            const variant = coins == null ? variantByHref.get(skuOf(opt.href)) : variants.find((v) => coinCountFromTitle(v.label) === coins)
            const out = variant ? variant.available === false : opt.available === false
            // The card's own price is the truth for affordability; the
            // 10-pts-per-coin rule only fills in when the card carried no
            // price.
            const price = parsePoints(opt.points) ?? (coins != null ? coins * POINTS_PER_COIN : null)
            const pct =
              price != null && available != null && price > 0 ? Math.min(100, (available / price) * 100) : null
            const afford = price != null && available != null && available >= price
            return (
              <button
                key={opt.title}
                type="button"
                className={`coin-card coin-card--press${out ? ' coin-card--out' : afford ? ' coin-card--afford' : ''}`}
                title={opt.href ? 'Open the redeem page for this amount' : undefined}
                disabled={!opt.href}
                onClick={() => opt.href && sendMessage({ type: 'OPEN_REDEEM_PAGE', url: opt.href })}
              >
                <div className="coin-card-row">
                  {/* The amount is the whole title (user request
                   * 2026-09-09: the "Overwatch Digital Code—" prefix only
                   * ever truncated — the card sits in the Overwatch catalog,
                   * the product says itself). */}
                  <span className="coin-card-title">{coins != null ? `${formatNumber(coins)} coins` : opt.title}</span>
                  <span className={`coin-card-state${out ? ' is-warn' : afford ? ' is-ok' : ''}`}>
                    {out ? 'sold out' : afford ? 'affordable' : 'in stock'}
                  </span>
                </div>
                <span className="coin-card-points">
                  {opt.points || (price != null ? `${formatNumber(price)} pts` : '—')}
                </span>
                {pct != null && price != null && available != null && (
                  <>
                    <div className="coin-progress" title={`${formatNumber(available)} of ${formatNumber(price)} pts`}>
                      <span className="coin-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="coin-progress-note">
                      {/* The bar reads in points (user spec, 2026-09-09): 0
                       * at the left end, the full price at the right —
                       * 7,000 of 10,000 pts fills ~70%, reaching the end
                       * means you have the points. */}
                      {afford
                        ? `You have ${formatNumber(available)} pts — covered`
                        : `${formatNumber(available)} / ${formatNumber(price)} pts · ${formatNumber(price - available)} to go`}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
    </Tile>
  )
}
