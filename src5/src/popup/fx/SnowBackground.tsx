import { useMemo } from 'react'
import type { CSSProperties } from 'react'

// Slow-falling snow: scattered white dots drifting down and a little sideways.
// Each flake's sideways drift is a per-element CSS variable the snowFall
// keyframe reads, so one shared keyframe covers every flake. Negative delays
// start every flake mid-fall, so the field is settled the moment it mounts.
// When motion is off the field freezes into a still sprinkle.
type Flake = {
  id: number
  left: number
  top: number
  size: number
  duration: number
  delay: number
  drift: number
}

export function SnowBackground({ animate }: { animate: boolean }) {
  const flakes = useMemo<Flake[]>(
    () =>
      Array.from({ length: 26 }, (_, id) => ({
        id,
        left: Math.round(Math.random() * 1000) / 10,
        top: Math.round(Math.random() * 900) / 10,
        size: 2 + Math.random() * 3,
        duration: 7 + Math.random() * 7,
        delay: Math.round(Math.random() * 100) / 10,
        drift: Math.round((Math.random() * 44 - 22) * 10) / 10,
      })),
    [],
  )

  return (
    <div className={`bg bg--snow${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="flake"
          style={
            {
              left: `${f.left}%`,
              top: `${f.top}%`,
              width: f.size,
              height: f.size,
              animationDuration: `${f.duration}s`,
              animationDelay: `-${f.delay}s`,
              '--drift': `${f.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
