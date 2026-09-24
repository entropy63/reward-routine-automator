// The Order history tile (6.8.0 rewrite): the order history the sync keeps —
// every row in a scrollable list (no scrollbar chrome), each detail-carrying
// row showing its redemption code with a Copy button beside it. Owns its
// storage reads and its sync state machine (the "Syncing…" hold + outcome
// line + evidence dump, all user reports from 2026-09-09/10 — see the
// comments inline).
//
// Designed steps → variants (the steps are a lattice — the WIDTH picks the
// row, not the index): the 2-wide seat is the two-line mini card (36px thumb
// + one-line title, the code + Copy — the points/date/order-no drop); 3- and
// 4-wide seats the regular row; 6-wide seats the roomy row (bigger art and
// type via CSS). The 3/4-wide seats at several heights are the 2026-09-11
// ask: "The order history should be able to get smaller than 5 points of
// width".

import { useEffect, useState } from 'react'
import { useStorageValue } from '../../../popup/hooks/useStorageValue.ts'
import { KEYS } from '../../../shared/storage.ts'
import type { LogRow, OrderRow, OrdersDoc } from '../../../shared/storage.ts'
import { sendMessage } from '../../../shared/messages.ts'
import { timeAgo } from './shared.tsx'
import { Tile } from './Tile.tsx'
import type { TileProps } from './Tile.tsx'

// The order card's product thumbnail: every order this account makes is
// Overwatch coins, so the page's own bing.com art serves them all (verbatim
// from the live capture, the w=240 variant so it stays sharp at our small
// size). If the URL ever rots, the img's onError hides it and the row
// degrades to the text layout.
const ORDER_THUMB =
  'https://bing.com/th?id=OMR.Redeem.Overwatch2.jpg&pid=Rewards&w=240&p=0&qlt=100&r=0'

// One order row, in the step's variant. The page's card, mirrored (user
// request, 2026-09-10): the product thumbnail on the LEFT, then the body
// column in the page's order — the title on its own line (wrapping like the
// page's line-clamp-2), the points | date row, the code + Copy shown
// DIRECTLY (user spec: no View-detail press; the code is the point of the
// row), and the order number BELOW the code ("put the order number below
// the code") — the mini variant drops it: a narrow seat shows what an order
// IS, the id is a lookup luxury.
function OrderRowView({
  o,
  rowKey,
  variant,
  copied,
  copyCode,
}: {
  o: OrderRow
  rowKey: string
  variant: 'mini' | 'regular' | 'roomy'
  copied: string | null
  copyCode: (code: string, key: string) => void
}) {
  const compact = variant === 'mini'
  return (
    <div className={`order-row${compact ? ' order-row--sm' : variant === 'roomy' ? ' order-row--lg' : ''}`}>
      <img
        className="order-thumb"
        src={ORDER_THUMB}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      <div className="order-body">
        <p className="order-title">{o.title}</p>
        {!compact && (o.points || o.date) && (
          <div className="order-meta">
            {o.points && <span className="order-pts">{o.points} pts</span>}
            {o.points && o.date && <span className="order-div" aria-hidden />}
            {o.date && <span className="order-date">{o.date}</span>}
          </div>
        )}
        {o.code != null && (
          <div className="order-detail-line">
            <span className="order-code">{o.code}</span>
            <button
              className="order-copy"
              title="Copy the code to the clipboard"
              onClick={() => copyCode(o.code || '', rowKey)}
            >
              {copied === rowKey ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        )}
        {!compact && o.orderNo && <span className="order-no">Order no. {o.orderNo}</span>}
      </div>
    </div>
  )
}

export function OrdersTile({ seat, ...rest }: TileProps) {
  const { value: doc } = useStorageValue<OrdersDoc | null>('local', KEYS.lastOrders, null)
  const { value: log } = useStorageValue<LogRow | null>('local', KEYS.lastOrdersLog, null)
  const [syncing, setSyncing] = useState(false)
  // Which button is running — the label rides it, and the safety timeout is
  // longer for a full rescan (every dialog re-opened, even orders already
  // stored with codes).
  const [syncMode, setSyncMode] = useState<'new' | 'all'>('new')
  // The "Copied ✓" confirmation: keyed by the row whose Copy button was
  // pressed, cleared a beat later.
  const [copied, setCopied] = useState<string | null>(null)
  // What the storage looked like when Sync was pressed — the run is done when
  // either half moves off it.
  const [syncMarker, setSyncMarker] = useState<{ at: number; detail: string } | null>(null)

  const startSync = (mode: 'new' | 'all') => {
    setSyncMode(mode)
    setSyncing(true)
    setSyncMarker({ at: doc?.at ?? 0, detail: log?.detail ?? '' })
    sendMessage({ type: 'SYNC_ORDERS', forceAll: mode === 'all' })
  }

  useEffect(() => {
    if (!syncing || !syncMarker) return
    if ((doc?.at ?? 0) > syncMarker.at || (log?.detail ?? '') !== syncMarker.detail) {
      setSyncing(false)
      setSyncMarker(null)
    }
  }, [syncing, syncMarker, doc, log])

  useEffect(() => {
    if (!syncing) return
    // Safety net: a read that never answers (worker killed mid-run) must not
    // pin the button forever. Generous — every row's dialog is opened now,
    // so even a page where each dialog crawls can take minutes; a full
    // rescan re-opens EVERY dialog and each one gets a 60s budget (6.7.10),
    // so it gets 15 minutes.
    const t = setTimeout(
      () => {
        setSyncing(false)
        setSyncMarker(null)
      },
      syncMode === 'all' ? 900000 : 300000,
    )
    return () => clearTimeout(t)
  }, [syncing, syncMode])

  const orders = doc?.orders || []

  const copyCode = (code: string, key: string) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }

  // The row variant from the seat's own width: the 2-wide mini card, the
  // regular row, the roomy row (the steps are a lattice).
  const variant = seat.w === 2 ? 'mini' : seat.w >= 6 ? 'roomy' : 'regular'

  return (
    <Tile
      id="orders"
      title="Order history"
      seat={seat}
      action={
        // Two buttons (user request, 2026-09-10: "add a button that will
        // rescan them all"): Sync is the incremental 6.7.7 run (only the
        // unsaved orders get their dialogs opened), Rescan all forces a full
        // pass — every dialog re-read, even orders already carrying codes, so
        // the stored codes can be corrected from the live page.
        <span className="orders-sync-btns">
          <button className="btn btn--sm" disabled={syncing} onClick={() => startSync('new')}>
            {syncing && syncMode === 'new' ? 'Syncing…' : 'Sync'}
          </button>
          <button className="btn btn--sm" disabled={syncing} onClick={() => startSync('all')}>
            {syncing && syncMode === 'all' ? 'Rescanning…' : 'Rescan all'}
          </button>
        </span>
      }
      {...rest}
    >
      {orders.length ? (
        <>
          {/* Every row, scrolling inside the tile (user request, 2026-09-09:
           * "if there are a lot of records, make it scrollable… I do not
           * like the scroll bar") — the list fills whatever height the
           * tile's step gives it. */}
          <div className="orders-list">
            {orders.map((o, i) => (
              <OrderRowView key={o.orderNo || String(i)} o={o} rowKey={o.orderNo || String(i)} variant={variant} copied={copied} copyCode={copyCode} />
            ))}
          </div>
          <p className="dash-muted">
            {doc?.total ? `${doc.total} order${doc.total === 1 ? '' : 's'} on the page` : `${orders.length} order${orders.length === 1 ? '' : 's'}`}
            {doc?.at ? ` · synced ${timeAgo(doc.at)}` : ''}
          </p>
        </>
      ) : (
        <p className="dash-muted">
          No orders saved yet — Sync reads rewards.bing.com/redeem/orderhistory and keeps the list (with each order&apos;s
          redemption code) here.
        </p>
      )}
      {log?.detail && (
        <p
          className={`order-outcome${log.ok === false ? ' is-bad' : log.ok === true ? ' is-ok' : ''}`}
          title={log.dump || undefined}
        >
          {log.detail}
        </p>
      )}
      {/* The dump spelled out, not just hovered (user report 2026-09-09:
       * "nothing happens" on hover — a native tooltip is too easy to miss,
       * and an empty dump rendered nothing at all). Shown only for a failed
       * read that carries evidence. */}
      {log?.ok === false && log.dump ? <pre className="order-dump">{log.dump}</pre> : null}
    </Tile>
  )
}
