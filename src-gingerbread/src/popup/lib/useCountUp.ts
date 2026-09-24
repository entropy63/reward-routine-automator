import { useEffect, useRef, useState } from 'react'

// Ease a number from its previous value to the next one over `ms`, for the
// Today hero's points roll-up. When motion is off (or the value is null) it
// snaps, so the reduced-motion path renders the same final number with no
// animation. Cubic ease-out — a settle, not a spin.
export function useCountUp(target: number | null, animate: boolean, ms = 700): number | null {
  const [display, setDisplay] = useState<number | null>(target)
  const fromRef = useRef<number>(target ?? 0)

  useEffect(() => {
    if (target == null) {
      setDisplay(null)
      return
    }
    if (!animate) {
      setDisplay(target)
      fromRef.current = target
      return
    }

    const from = fromRef.current
    if (from === target) {
      setDisplay(target)
      return
    }

    const start = performance.now()
    let raf = 0
    const step = (t: number): void => {
      const p = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, animate, ms])

  return display
}
