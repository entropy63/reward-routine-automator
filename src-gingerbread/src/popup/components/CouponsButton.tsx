import { useState } from 'react'
import { ActionButton } from './ActionButton.tsx'
import { useLastCoupons } from '../hooks/useRedeem.ts'
import type { Message, MessageResponse } from '../../shared/messages.ts'

// The experimental "apply every coupon" button (Settings → Experimental
// features): the background opens the Rewards dashboard in the foreground and
// presses every "Apply coupon" the panel shows. Grayed exactly when the last
// read saw every coupon applied (available === 0); no record yet leaves it
// pressable, because the run reports what it found either way. Held disabled
// while a run is in flight — it comes back on the next real read (src-donut's
// reasoning). Shared by the popup's Run view and the dashboard's controls tile.
export function CouponsButton({ send }: { send: (message: Message) => Promise<MessageResponse> }) {
  const coupons = useLastCoupons()
  const [applying, setApplying] = useState(false)
  const allApplied = !!coupons && coupons.available === 0
  return (
    <ActionButton
      className={coupons && coupons.available > 0 ? 'btn--good' : undefined}
      disabled={allApplied || applying}
      title={allApplied ? 'Every coupon is already applied.' : 'Open the Rewards dashboard and apply every coupon (experimental).'}
      onClick={() => {
        setApplying(true)
        send({ type: 'CLAIM_COUPONS' }).then(() => setApplying(false))
      }}
    >
      {applying ? 'Applying coupons…' : `Coupons${coupons && coupons.available > 0 ? ` (${coupons.available})` : ''}`}
    </ActionButton>
  )
}
