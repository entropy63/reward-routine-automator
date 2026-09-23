import { useEffect } from 'react'
import confetti from 'canvas-confetti'

// One celebratory burst on mount — the finish screen's flourish (the routine's
// end overlay on the dashboard). Two side cannons firing inward for ~700ms. A
// no-op when motion is off, so the screen is identical minus the celebration
// under reduced motion.
export function Confetti({ fire }: { fire: boolean }) {
  useEffect(() => {
    if (!fire) return
    const end = Date.now() + 700
    const colors = ['#06b6d4', '#22d3ee', '#a5f3fc', '#ffffff']
    const frame = (): void => {
      confetti({ particleCount: 4, angle: 60, spread: 60, startVelocity: 45, origin: { x: 0, y: 0.7 }, colors })
      confetti({ particleCount: 4, angle: 120, spread: 60, startVelocity: 45, origin: { x: 1, y: 0.7 }, colors })
      if (Date.now() < end) requestAnimationFrame(frame)
    }
    frame()
  }, [fire])

  return null
}
