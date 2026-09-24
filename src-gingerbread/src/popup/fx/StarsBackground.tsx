import { useMemo } from 'react'
import { motion } from 'framer-motion'

// A field of twinkling stars: ~22 small accent glows scattered over the popup,
// each fading and swelling on its own random cadence (framer-motion loops —
// no canvas, no new dependency). When motion is off they render as a calm
// static sprinkle at fixed opacity.
type Star = { id: number; left: number; top: number; size: number; duration: number; delay: number }

export function StarsBackground({ animate }: { animate: boolean }) {
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 22 }, (_, id) => ({
        id,
        left: Math.round(Math.random() * 1000) / 10,
        top: Math.round(Math.random() * 1000) / 10,
        size: 1.5 + Math.random() * 2,
        duration: 2.4 + Math.random() * 3.6,
        delay: Math.round(Math.random() * 40) / 10,
      })),
    [],
  )

  return (
    <div className="bg bg--stars" aria-hidden="true">
      {stars.map((s) => (
        <motion.span
          key={s.id}
          className="star"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size }}
          animate={animate ? { opacity: [0.15, 0.9, 0.15], scale: [1, 1.5, 1] } : { opacity: 0.5 }}
          transition={
            animate ? { duration: s.duration, delay: s.delay, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }
          }
        />
      ))}
    </div>
  )
}
