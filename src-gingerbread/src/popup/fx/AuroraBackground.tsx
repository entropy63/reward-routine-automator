// The animated gradient-mesh backdrop: three slow-drifting blurred blobs in the
// accent and two companion hues. The drift is pure CSS (see popup.css); when
// motion is off the blobs are still placed but not animated, so it degrades to
// a tasteful static gradient rather than a flat panel.
export function AuroraBackground({ animate }: { animate: boolean }) {
  return (
    <div className={`aurora${animate ? '' : ' aurora--static'}`} aria-hidden="true">
      <span className="aurora-blob aurora-blob--1" />
      <span className="aurora-blob aurora-blob--2" />
      <span className="aurora-blob aurora-blob--3" />
    </div>
  )
}
