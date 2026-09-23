import { useEffect, useMemo, useRef } from 'react'

// An interactive particle field: a jittered grid of glowing dots, each pushed
// away from the pointer (and swelling) within a falloff radius, easing back
// as the pointer leaves its neighborhood. The physics is imperative — one
// rAF loop lerping the pointer position and writing each particle's transform
// directly — because per-particle react state or motion values would mean a
// hundred subscriptions firing on every mousemove. When motion is off the
// field renders as a calm static grid.
type Particle = { id: number; left: number; top: number }

const COLS = 10
const ROWS = 13

export function ParticlesBackground({ animate }: { animate: boolean }) {
  const fieldRef = useRef<HTMLDivElement>(null)

  const particles = useMemo<Particle[]>(() => {
    const out: Particle[] = []
    let id = 0
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        out.push({
          id: id++,
          left: Math.round((4 + (col * 92) / (COLS - 1) + (Math.random() * 3.6 - 1.8)) * 10) / 10,
          top: Math.round((3 + (row * 94) / (ROWS - 1) + (Math.random() * 3.6 - 1.8)) * 10) / 10,
        })
      }
    }
    return out
  }, [])

  useEffect(() => {
    if (!animate) return
    const field = fieldRef.current
    if (!field) return

    let raf = 0
    let tx = -999
    let ty = -999
    let cx = -999
    let cy = -999

    const onMove = (e: MouseEvent) => {
      const rect = field.getBoundingClientRect()
      tx = e.clientX - rect.left
      ty = e.clientY - rect.top
    }

    const tick = () => {
      // Ease the effective pointer toward the real one, then displace every
      // particle away from it within a ~130px radius (quadratic falloff).
      cx += (tx - cx) * 0.18
      cy += (ty - cy) * 0.18
      const settled = Math.abs(tx - cx) < 0.1 && Math.abs(ty - cy) < 0.1
      if (!settled) {
        const w = field.clientWidth
        const h = field.clientHeight
        const els = field.children
        for (let i = 0; i < els.length; i++) {
          const el = els[i] as HTMLElement
          const baseX = (Number(el.dataset.x) / 100) * w
          const baseY = (Number(el.dataset.y) / 100) * h
          const ddx = baseX - cx
          const ddy = baseY - cy
          const dist = Math.hypot(ddx, ddy) || 1
          const force = Math.max(0, 1 - dist / 130)
          if (force <= 0) {
            if (el.style.transform) el.style.transform = ''
            continue
          }
          const push = force * force * 30
          el.style.transform = `translate(${(ddx / dist) * push}px, ${(ddy / dist) * push}px) scale(${1 + force * 0.6})`
        }
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('mousemove', onMove)
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [animate])

  return (
    <div className="bg bg--particles" ref={fieldRef} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="particle"
          data-x={p.left}
          data-y={p.top}
          style={{ left: `${p.left}%`, top: `${p.top}%` }}
        />
      ))}
    </div>
  )
}
