// Two periodic wave layers sliding across the bottom of the frame in opposite
// directions (the front one faster — reads as parallax). Each svg is 200% wide
// with a path whose period divides 50%, so the waveSlide translateX(-50%) loop
// in backgrounds.css is seamless. Colors come from the .wave rules; this just
// draws the shapes.
export function WavesBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--waves${animate ? '' : ' bg--static'}`} aria-hidden="true">
      <svg className="wave wave--back" viewBox="0 0 880 170" preserveAspectRatio="none">
        <path d="M0 95 C 73 55, 147 135, 220 95 C 293 55, 367 135, 440 95 C 513 55, 587 135, 660 95 C 733 55, 807 135, 880 95 L 880 170 L 0 170 Z" />
      </svg>
      <svg className="wave wave--front" viewBox="0 0 880 170" preserveAspectRatio="none">
        <path d="M0 115 C 73 80, 147 145, 220 115 C 293 80, 367 145, 440 115 C 513 80, 587 145, 660 115 C 733 80, 807 145, 880 115 L 880 170 L 0 170 Z" />
      </svg>
    </div>
  )
}
