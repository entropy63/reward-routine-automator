import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'

// Parallax orbs: blurred circles at different depths that drift with the
// pointer — the far ones barely move, the near ones swing wide — so the whole
// layer reads as having depth. Each orb owns a useTransform pair scaled by its
// depth; the shared springs keep the movement soft. When motion is off the
// orbs sit still (a bokeh-like static field).
type Orb = { left: number; top: number; size: number; hue: 'accent' | 'accent-2' | 'violet'; depth: number }

const ORBS: Orb[] = [
  { left: -6, top: -10, size: 150, hue: 'accent', depth: 0.5 },
  { left: 60, top: -16, size: 120, hue: 'accent-2', depth: 0.9 },
  { left: 28, top: 52, size: 170, hue: 'violet', depth: 0.35 },
  { left: 76, top: 46, size: 100, hue: 'accent-2', depth: 1 },
  { left: -8, top: 50, size: 110, hue: 'accent', depth: 0.7 },
]

function ParallaxOrb({ sx, sy, orb }: { sx: MotionValue<number>; sy: MotionValue<number>; orb: Orb }) {
  const x = useTransform(sx, (v) => v * orb.depth * 64)
  const y = useTransform(sy, (v) => v * orb.depth * 44)
  return (
    <motion.span
      className={`orb orb--${orb.hue}`}
      style={{ left: `${orb.left}%`, top: `${orb.top}%`, width: orb.size, height: orb.size, x, y }}
    />
  )
}

export function ParallaxBackground({ animate }: { animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 50, damping: 16 })
  const sy = useSpring(my, { stiffness: 50, damping: 16 })

  useEffect(() => {
    if (!animate) return
    const onMove = (e: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      // Pointer position as -0.5..0.5 around the layer's center.
      mx.set((e.clientX - rect.left) / rect.width - 0.5)
      my.set((e.clientY - rect.top) / rect.height - 0.5)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [animate, mx, my])

  return (
    <div className="bg bg--parallax" ref={ref} aria-hidden="true">
      {animate ? (
        ORBS.map((o, i) => <ParallaxOrb key={i} sx={sx} sy={sy} orb={o} />)
      ) : (
        ORBS.map((o, i) => (
          <span
            key={i}
            className={`orb orb--${o.hue}`}
            style={{ left: `${o.left}%`, top: `${o.top}%`, width: o.size, height: o.size }}
          />
        ))
      )}
    </div>
  )
}
