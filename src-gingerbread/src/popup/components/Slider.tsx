import { useEffect, useState } from 'react'

// A committed range slider: the thumb moves locally while dragging (the readout
// follows it live), and the value only reports on release — pointer up, key
// up, or blur — so one drag is one storage write, not one per pixel. Mirrors
// NumberField's committed-on-blur pattern.
export function Slider({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  ariaLabel,
}: {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  ariaLabel?: string
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])

  const commit = (): void => {
    if (local !== value) onCommit(local)
  }

  return (
    <span className="sliderfield">
      <input
        type="range"
        value={local}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="sliderfield-value">
        {local}
        {suffix}
      </span>
    </span>
  )
}
