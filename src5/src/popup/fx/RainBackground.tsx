// A steady drizzle: thin fast streaks falling with a slight diagonal. Fixed
// config spread over the frame with negative delays, so the rain is already
// pouring the moment it mounts (no empty wind-up).
const DROPS: { left: number; top: number; duration: number; delay: number }[] = [
  { left: 6, top: 12, duration: 1.05, delay: 0.3 },
  { left: 14, top: 64, duration: 0.9, delay: 0.62 },
  { left: 24, top: 34, duration: 1.15, delay: 0.08 },
  { left: 33, top: 82, duration: 0.95, delay: 0.44 },
  { left: 43, top: 8, duration: 1.1, delay: 0.71 },
  { left: 52, top: 55, duration: 0.88, delay: 0.19 },
  { left: 61, top: 26, duration: 1.08, delay: 0.53 },
  { left: 70, top: 74, duration: 0.92, delay: 0.33 },
  { left: 79, top: 42, duration: 1.12, delay: 0.66 },
  { left: 88, top: 18, duration: 0.98, delay: 0.12 },
  { left: 96, top: 66, duration: 1.06, delay: 0.48 },
]

export function RainBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--rain${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {DROPS.map((d, i) => (
        <span
          key={i}
          className="drop"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            animationDuration: `${d.duration}s`,
            animationDelay: `-${d.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
