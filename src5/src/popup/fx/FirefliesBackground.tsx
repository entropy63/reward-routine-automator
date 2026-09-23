import { useMemo } from 'react'
import { motion } from 'framer-motion'

// Fireflies: small warm glows wandering the frame on meandering loops. Each
// fly drifts out and back along its own random x/y path (mirrored repeat, so
// it never snaps) while its glow breathes. When motion is off they settle into
// a calm static field, like the stars style but warmer.
type Fly = {
  id: number
  left: number
  top: number
  size: number
  duration: number
  delay: number
  dx: number
  dy: number
}

export function FirefliesBackground({ animate }: { animate: boolean }) {
  const flies = useMemo<Fly[]>(
    () =>
      Array.from({ length: 14 }, (_, id) => ({
        id,
        left: Math.round(Math.random() * 1000) / 10,
        top: Math.round(Math.random() * 1000) / 10,
        size: 3 + Math.random() * 3,
        duration: 5 + Math.random() * 6,
        delay: Math.round(Math.random() * 50) / 10,
        dx: Math.round((14 + Math.random() * 26) * 10) / 10,
        dy: Math.round((10 + Math.random() * 22) * 10) / 10,
      })),
    [],
  )

  return (
    <div className="bg bg--fireflies" aria-hidden="true">
      {flies.map((f) => (
        <motion.span
          key={f.id}
          className="fly"
          style={{ left: `${f.left}%`, top: `${f.top}%`, width: f.size, height: f.size }}
          animate={
            animate
              ? { x: [0, f.dx, -f.dx, 0], y: [0, -f.dy, f.dy, 0], opacity: [0.08, 0.9, 0.25, 0.08] }
              : { opacity: 0.4 }
          }
          transition={
            animate ? { duration: f.duration, delay: f.delay, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }
          }
        />
      ))}
    </div>
  )
}
