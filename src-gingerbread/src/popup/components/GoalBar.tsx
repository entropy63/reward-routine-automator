import { motion } from 'framer-motion'
import { formatNumber } from '../lib/format.ts'

// The points goal bar: fill = balance/target, with the pair and an ETA below.
// The ETA comes from pure/history (trendPerDay → goalDaysRemaining), so a
// negative or flat trend honestly says it can't estimate rather than lying.
export function GoalBar({
  balance,
  target,
  daysRemaining,
  animate,
}: {
  balance: number | null
  target: number
  daysRemaining: number | null
  animate: boolean
}) {
  const pct = balance != null && target > 0 ? Math.max(0, Math.min(1, balance / target)) : 0
  const reached = balance != null && balance >= target

  return (
    <div className="goal">
      <div className="goal-track">
        <motion.span
          className="goal-fill"
          initial={{ width: animate ? '0%' : `${pct * 100}%` }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: animate ? 0.8 : 0, ease: 'easeOut' }}
        />
      </div>
      <div className="goal-meta">
        <span className="goal-nums">
          {balance != null ? formatNumber(balance) : '—'} / {formatNumber(target)}
        </span>
        <span className="goal-eta">
          {reached
            ? 'Goal reached 🎉'
            : daysRemaining != null
              ? `~${daysRemaining} day${daysRemaining === 1 ? '' : 's'} to go`
              : 'Earn a few days to set a pace'}
        </span>
      </div>
    </div>
  )
}
