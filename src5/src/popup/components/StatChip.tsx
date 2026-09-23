import type { ReactNode } from 'react'

// A compact stat readout — big value over a small label, with an optional tone
// tint. Used for the Today view's ready-to-claim / streak / stamp chips.
export function StatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'bad' | 'warn' | 'accent'
}) {
  return (
    <div className={`chip${tone ? ` chip--${tone}` : ''}`}>
      <span className="chip-value">{value}</span>
      <span className="chip-label">{label}</span>
    </div>
  )
}
