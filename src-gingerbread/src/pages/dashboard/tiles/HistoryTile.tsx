// The Points history tile (6.8.0 rewrite): the 90-day histogram + the redeem
// goal bar. Owns its hooks; the goal comes from the settings the page wires.
//
// Designed steps → variants (2026-09-11 rework): the 1-tall seats (4×1, 6×1)
// are the scaled-down strip the user asked for ("The graph should also be
// able to scale down") — `dash-history--compact` drops the goal bar and
// shrinks the chart's floor so the bars fit the ~92px body. The 2-tall seats
// are the full chart + note + goal. The variant comes from the step's own
// height, not its index — the steps are a lattice.

import { HistoryChart } from '../HistoryChart.tsx'
import { GoalBar } from '../../../popup/components/GoalBar.tsx'
import { usePointsHistory, useStats } from '../../../popup/hooks/useStats.ts'
import { formatNumber } from '../../../popup/lib/format.ts'
import { parsePoints, trendPerDay, goalDaysRemaining } from '../../../background/pure/history.ts'
import { useDash } from '../ctx.tsx'
import { Tile } from './Tile.tsx'
import type { TileProps } from './Tile.tsx'

export function HistoryTile({ seat, ...rest }: TileProps) {
  const { settings, animate } = useDash()
  const history = usePointsHistory()
  const stats = useStats()

  const available = parsePoints(stats?.availablePoints)
  const goal = settings.redeemGoalPts
  const perDay = trendPerDay(history)
  const daysLeft = goalDaysRemaining(available == null ? NaN : available, goal, perDay)
  // The seat's own height picks the variant — 1-tall seats are the compact
  // strip, 2-tall seats the full chart.
  const compact = seat.h === 1

  return (
    <Tile
      id="history"
      title="Points history"
      seat={seat}
      className={compact ? 'dash-history--compact' : undefined}
      {...rest}
    >
      <HistoryChart history={history} days={90} />
      <p className="dash-muted">
        {history.length
          ? `Points earned per day · ${history.length} day${history.length === 1 ? '' : 's'} recorded · trend ~${
              perDay != null ? formatNumber(Math.round(perDay)) : '—'
            } pts/day`
          : 'One snapshot per day, from the first stats read — the chart plots what the day earned.'}
      </p>
      {goal > 0 && (
        <div className="dash-goal">
          <GoalBar balance={available} target={goal} daysRemaining={daysLeft} animate={animate} />
        </div>
      )}
    </Tile>
  )
}
