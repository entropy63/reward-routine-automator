import { KEYS } from '../../shared/storage.ts'
import type { CouponsRow, RedeemRead, StockNews } from '../../shared/storage.ts'
import { useStorageValue } from './useStorageValue.ts'

// The redeem watch's reads, as one hook for the Redeem view and the banners:
// the last good read (catalog + variants + detail URL), the coupon count the
// stats read picked up, and the two stock-change news records. Each half
// keeps its own "last good" semantics in storage, so these hooks just
// subscribe — no fallback logic lives here.

export function useLastRedeem(): RedeemRead | null {
  return useStorageValue<RedeemRead | null>('local', KEYS.lastRedeem, null).value
}

export function useLastCoupons(): CouponsRow | null {
  return useStorageValue<CouponsRow | null>('local', KEYS.lastCoupons, null).value
}

export function useRestockNews(): StockNews | null {
  return useStorageValue<StockNews | null>('local', KEYS.redeemRestockNews, null).value
}

export function useSoldOutNews(): StockNews | null {
  return useStorageValue<StockNews | null>('local', KEYS.redeemSoldOutNews, null).value
}
