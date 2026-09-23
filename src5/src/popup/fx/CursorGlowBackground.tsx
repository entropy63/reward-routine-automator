import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'

// A soft glow that chases the pointer — the classic "cursor light" effect.
// The background layer itself is pointer-events: none, so the component
// listens on the window and converts viewport coordinates into layer
// coordinates; the spring gives the chase a slight, tasteful lag. When motion
// is off the glow simply rests above center.
export function CursorGlowBackground({ animate }: { animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(-200)
  const y = useMotionValue(-200)
  const sx = useSpring(x, { stiffness: 130, damping: 16 })
  const sy = useSpring(y, { stiffness: 130, damping: 16 })

  useEffect(() => {
    if (!animate) return
    const onMove = (e: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      x.set(e.clientX - rect.left)
      y.set(e.clientY - rect.top)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [animate, x, y])

  if (!animate) {
    return (
      <div className="bg bg--cursor" aria-hidden="true">
        <span className="cursor-glow cursor-glow--rest" />
      </div>
    )
  }
  return (
    <div className="bg bg--cursor" ref={ref} aria-hidden="true">
      <motion.span className="cursor-glow" style={{ x: sx, y: sy }} />
      <motion.span className="cursor-dot" style={{ x: sx, y: sy }} />
    </div>
  )
}
