import { motion } from 'framer-motion'
import type { HistoryEntry } from '../../shared/storage.ts'

// A 7-day balance trend line drawn from each day's LAST balance. Draws itself in
// (pathLength) when motion is on, snaps otherwise. Needs at least two days to
// have a line to draw; below that it says so rather than plotting a dot.
export function Sparkline({
  history,
  days = 7,
  animate,
}: {
  history: HistoryEntry[]
  days?: number
  animate: boolean
}) {
  const recent = history.slice(-days)
  const values = recent.map((e) => e.last)

  if (values.length < 2) {
    return <div className="spark spark--empty">A trend line appears after a couple of days.</div>
  }

  const w = 264
  const h = 46
  const pad = 4
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = (w - pad * 2) / (values.length - 1)

  const coords = values.map((v, i) => {
    const x = pad + i * step
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return [x, y] as const
  })

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const last = coords[coords.length - 1]
  const first = coords[0]
  const area = `${line} L${last[0].toFixed(1)} ${h} L${first[0].toFixed(1)} ${h} Z`

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <motion.path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: animate ? 0 : 1 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: animate ? 0.9 : 0, ease: 'easeOut' }}
      />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--accent)" />
    </svg>
  )
}
