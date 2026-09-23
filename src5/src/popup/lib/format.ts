import { parsePoints } from '../../background/pure/history.ts'

// Presentational helpers shared by the views. Parsing mirrors the engine's own
// parsePoints, so what the popup shows and what the verdicts compute stay one
// definition apart, not two.

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

// A stored display string/number → grouped number string, or a dash when it
// holds no digits at all.
export function displayPoints(value: unknown, dash = '—'): string {
  const n = parsePoints(value)
  return n == null ? dash : formatNumber(n)
}

// Signed delta for "±N today" — a real minus glyph, never a hyphen.
export function signed(n: number): string {
  if (n > 0) return `+${formatNumber(n)}`
  if (n < 0) return `−${formatNumber(Math.abs(n))}`
  return '0'
}

// Black or white ink for text sitting on an accent fill, chosen by luminance.
// Used when the user picks a custom accent and the theme's --accent-ink no
// longer fits the color they chose.
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#04212a' : '#ffffff'
}
