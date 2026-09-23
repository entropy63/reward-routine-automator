// Dots circling on dashed orbit rings — a tiny solar system. Each ring is a
// spinning container with the dot pinned at its top edge; the outer rings turn
// slower (and one in reverse) so the paths never line up.
const ORBITS: { size: number; duration: number; reverse: boolean }[] = [
  { size: 130, duration: 13, reverse: false },
  { size: 210, duration: 21, reverse: true },
  { size: 300, duration: 30, reverse: false },
]

export function OrbitBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--orbit${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {ORBITS.map((o, i) => (
        <div
          key={i}
          className="orbit"
          style={{
            width: o.size,
            height: o.size,
            marginLeft: -o.size / 2,
            marginTop: -o.size / 2,
            animationDuration: `${o.duration}s`,
            animationDirection: o.reverse ? 'reverse' : 'normal',
          }}
        >
          <span className="orbit-dot" />
        </div>
      ))}
    </div>
  )
}
