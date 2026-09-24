// Falling meteor streaks (Aceternity-style "meteors"): tilted bars whose
// bright end leads down-left, animated by the meteorFall keyframe in
// backgrounds.css. Each meteor is visible for only ~a fifth of its loop, so
// the sky stays quiet. Fixed config — no randomness, so the layout is stable
// across renders.
const METEORS: { left: number; width: number; duration: number; delay: number }[] = [
  { left: 12, width: 1.4, duration: 6.5, delay: 0 },
  { left: 30, width: 1, duration: 8, delay: 3.2 },
  { left: 47, width: 1.6, duration: 7, delay: 1.4 },
  { left: 65, width: 1.1, duration: 9, delay: 5.1 },
  { left: 82, width: 1.3, duration: 7.5, delay: 2.3 },
]

export function MeteorsBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--meteors${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {METEORS.map((m, i) => (
        <span
          key={i}
          className="meteor"
          style={{
            left: `${m.left}%`,
            width: m.width,
            animationDuration: `${m.duration}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
