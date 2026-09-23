// Aceternity-style "background beams": curved SVG paths with a short dash of
// accent light that travels along each one (the dashoffset keyframe in
// popup.css). The paths are authored for the popup's 440×600 frame and slice
// rather than stretch, so they hold their shape at any popup height.
const BEAM_PATHS = [
  'M -30 -30 C 130 90, 300 150, 470 60',
  'M -30 -30 C 170 30, 330 260, 470 350',
  'M 210 -30 C 240 160, 180 330, 260 630',
  'M -30 320 C 130 270, 310 430, 470 390',
  'M 60 -30 C 90 120, 40 300, 120 630',
]

export function BeamsBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`bg bg--beams${animate ? '' : ' bg--static'}`} aria-hidden="true">
      <svg viewBox="0 0 440 600" preserveAspectRatio="xMidYMid slice">
        {BEAM_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  )
}
