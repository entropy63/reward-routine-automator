import { motion } from 'framer-motion'
import type { Settings, StepId } from '../../shared/settings.ts'
import { STEP_LABEL, STREAKS } from '../../shared/settings.ts'
import type { HistoryEntry, Stats } from '../../shared/storage.ts'
import { progressPair, statsAreCurrent } from '../../background/pure/verdicts.ts'
import { enabledRoutinePlan } from '../../background/pure/plan.ts'
import { earnedToday, goalDaysRemaining, parsePoints, trendPerDay } from '../../background/pure/history.ts'
import { localDayKey } from '../../background/core/day.ts'
import { viewVariants } from '../fx/motion-presets.ts'
import { Card } from '../components/Card.tsx'
import { PointsRing } from '../components/PointsRing.tsx'
import { Sparkline } from '../components/Sparkline.tsx'
import { GoalBar } from '../components/GoalBar.tsx'
import { StatChip } from '../components/StatChip.tsx'
import { displayPoints, formatNumber, signed } from '../lib/format.ts'
import { useCountUp } from '../lib/useCountUp.ts'

export function Today({
  settings,
  stats,
  history,
  motionOn,
}: {
  settings: Settings
  stats: Stats | null
  history: HistoryEntry[]
  motionOn: boolean
}) {
  const available = parsePoints(stats?.availablePoints)
  const shown = useCountUp(available, motionOn)
  const pair = progressPair(stats?.searchPoints)
  const fresh = statsAreCurrent(stats)

  const today = localDayKey()
  const delta = earnedToday(history, today)

  const goal = settings.redeemGoalPts
  const perDay = trendPerDay(history)
  const daysLeft = goalDaysRemaining(available == null ? NaN : available, goal, perDay)

  // The plan preview runs the SAME verdicts the routine runs, over the enabled
  // steps in their saved order — so it can't disagree with what actually skips.
  const plan = enabledRoutinePlan(settings, stats)

  return (
    <motion.div className="view" variants={viewVariants} initial="initial" animate="enter" exit="exit">
      <Card className="hero-card">
        <div className="hero">
          <div className="hero-left">
            <span className="hero-label">Available points</span>
            <span className="hero-value">{shown == null ? '—' : formatNumber(shown)}</span>
            <div className="hero-meta">
              {delta != null && (
                <span className={`delta${delta > 0 ? ' delta--up' : delta < 0 ? ' delta--down' : ''}`}>
                  {signed(delta)} today
                </span>
              )}
              <span className="hero-fresh">{fresh ? 'Updated today' : 'Refresh to update'}</span>
            </div>
          </div>
          <PointsRing done={pair ? pair[0] : null} total={pair ? pair[1] : null} label="search points" animate={motionOn} />
        </div>
      </Card>

      {goal > 0 && (
        <Card title="Points goal">
          <GoalBar balance={available} target={goal} daysRemaining={daysLeft} animate={motionOn} />
        </Card>
      )}

      <Card title="Last 7 days">
        <Sparkline history={history} animate={motionOn} />
        <div className="chips">
          <StatChip label="ready to claim" value={displayPoints(stats?.readyToClaim, '—')} tone="accent" />
          <StatChip label="daily streak" value={stats?.dailyStreak || '—'} />
          <StatChip label="stamp bonus" value={stats?.stampBonus || '—'} />
        </div>
      </Card>

      <Card title="Today's streaks">
        <div className="chips chips--streaks">
          {STREAKS.map(({ key, label }) => (
            <StatChip key={key} label={label} value={stats?.activities?.[key] || '—'} />
          ))}
        </div>
      </Card>

      <Card title="Next routine">
        {!settings.startupEnabled && (
          <p className="muted small">Auto-start is off — this is what “Run the routine” would do now.</p>
        )}
        {plan.length === 0 ? (
          <p className="muted small">No startup steps are enabled.</p>
        ) : (
          <ul className="plan">
            {plan.map((entry) => (
              <li key={entry.id} className={`plan-row${entry.willRun ? '' : ' plan-row--skip'}`}>
                <span className={`plan-dot${entry.willRun ? ' run' : ' skip'}`} />
                <span className="plan-label">{STEP_LABEL[entry.id as StepId] ?? entry.id}</span>
                <span className="plan-note">{entry.willRun ? 'will run' : entry.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </motion.div>
  )
}
