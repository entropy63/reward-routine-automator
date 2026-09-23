import type { CSSProperties } from 'react'

// Bokeh: large soft out-of-focus circles slowly panning past each other — the
// blurry-lens look. Each orb drifts along its own small vector (per-element
// --dx/--dy CSS variables read by the bokehDrift keyframe) and mirrors back,
// so they never wander off. Fixed config, negative delays for a settled start.
type Orb = {
  left: number
  top: number
  size: number
  hue: 'accent' | 'accent-2' | 'violet'
  duration: number
  delay: number
  dx: number
  dy: number
}

const ORBS: Orb[] = [
  { left: -8, top: -12, size: 150, hue: 'accent', duration: 17, delay: -5, dx: 46, dy: 30 },
  { left: 62, top: -18, size: 120, hue: 'accent-2', duration: 21, delay: -13, dx: -38, dy: 44 },
  { left: 30, top: 55, size: 170, hue: 'violet', duration: 19, delay: -8, dx: 30, dy: -34 },
  { left: 78, top: 48, size: 100, hue: 'accent-2', duration: 15, delay: -2, dx: -26, dy: -22 },
  { left: -10, top: 52, size: 110, hue: 'accent', duration: 23, delay: -17, dx: 36, dy: -28 },
]

export function BokehBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--bokeh${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {ORBS.map((o, i) => (
        <span
          key={i}
          className={`orb orb--${o.hue}`}
          style={
            {
              left: `${o.left}%`,
              top: `${o.top}%`,
              width: o.size,
              height: o.size,
              animationDuration: `${o.duration}s`,
              animationDelay: `${o.delay}s`,
              '--dx': `${o.dx}px`,
              '--dy': `${o.dy}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
