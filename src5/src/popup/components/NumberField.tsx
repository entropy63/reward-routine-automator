import { useEffect, useState } from 'react'

// A committed number input: edits are local text while typing, and only clamp +
// report on blur/Enter, so a half-typed value never round-trips through storage.
// Mirrors the committed-on-blur pattern the earlier builds' settings inputs use.
export function NumberField({
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
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = (): void => {
    let n = parseInt(text, 10)
    if (!Number.isFinite(n)) n = value
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    onCommit(n)
    setText(String(n))
  }

  return (
    <span className="numfield">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {suffix && <span className="numfield-suffix">{suffix}</span>}
    </span>
  )
}
