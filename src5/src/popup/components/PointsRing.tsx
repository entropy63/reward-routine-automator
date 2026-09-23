import { motion } from 'framer-motion'

// The search-points progress ring: an accent-gradient arc over a track, with
// the done/total pair (and a ✓ when complete) at its center. `done`/`total`
// come from pure/verdicts.progressPair(searchPoints), so the ring can't drift
// from the number the routine right-sizes against.
export function PointsRing({
  done,
  total,
  label,
  animate,
}: {
  done: number | null
  total: number | null
  label?: string
  animate: boolean
}) {
  const size = 136
  const stroke = 12
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = total && total > 0 && done != null ? Math.max(0, Math.min(1, done / total)) : 0
  const complete = total != null && done != null && total > 0 && done >= total
  const offset = circ * (1 - pct)

  return (
    <div className={`ring${complete ? ' ring--done' : ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={circ}
          initial={{ strokeDashoffset: animate ? circ : offset }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: animate ? 0.9 : 0, ease: 'easeOut' }}
        />
      </svg>
      <div className="ring-center">
        <span className="ring-value">{done != null && total != null ? `${done}/${total}` : '—'}</span>
        {label && <span className="ring-label">{complete ? '✓ complete' : label}</span>}
      </div>
    </div>
  )
}
