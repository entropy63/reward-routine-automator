// Rising bubbles: soft translucent orbs floating up the frame. The lazy
// side-to-side sway is baked into the rise keyframe (one animation per bubble,
// so no transform conflicts). Fixed config — stable across renders, and each
// bubble starts mid-loop (negative delays) so the field is alive immediately.
const BUBBLES: { left: number; top: number; size: number; duration: number; delay: number }[] = [
  { left: 8, top: 62, size: 10, duration: 11, delay: -3 },
  { left: 22, top: 30, size: 6, duration: 14, delay: -9.2 },
  { left: 37, top: 80, size: 13, duration: 9.5, delay: -4.8 },
  { left: 52, top: 48, size: 8, duration: 12.5, delay: -1.6 },
  { left: 66, top: 18, size: 11, duration: 10.5, delay: -7.9 },
  { left: 78, top: 70, size: 7, duration: 13.5, delay: -11.5 },
  { left: 90, top: 40, size: 9, duration: 11.5, delay: -5.9 },
]

export function BubblesBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--bubbles${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: b.size,
            height: b.size,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
