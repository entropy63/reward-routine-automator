// Expanding concentric rings — rain landing on still water. Three copies of
// the same ring, staggered by a third of the loop (negative delays), so a ring
// is always mid-bloom and the pulses feel continuous.
const RIPPLES = [0, -1.8, -3.6]

export function RippleBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--ripple${animate ? '' : ' bg--static'}`} aria-hidden="true">
      {RIPPLES.map((delay, i) => (
        <span key={i} className="ring" style={{ animationDelay: `${delay}s` }} />
      ))}
    </div>
  )
}
