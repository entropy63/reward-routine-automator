import type { Settings } from '../shared/settings.ts'
import { inkFor } from '../popup/lib/format.ts'

const HEX = /^#?[0-9a-f]{6}$/i

// The DOM side of the theme for the standalone worker-opened pages (confirm,
// routine-done), which render outside the popup and so don't run useTheme. Same
// axes and the same inline-accent override, plus the backdrop knobs
// (--bg-brightness, --tile-blur) so those pages match the popup's look, but
// one-shot: these tabs don't live long enough across an OS light/dark flip to
// need the subscription the popup's hook keeps.
export function applyTheme(
  settings: Pick<Settings, 'appearance' | 'theme' | 'accentColor' | 'backgroundBrightness' | 'tileBlur'>,
): void {
  const root = document.documentElement
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  root.dataset.appearance =
    settings.appearance === 'auto' ? (dark ? 'dark' : 'light') : settings.appearance
  root.dataset.theme = settings.theme

  const raw = (settings.accentColor || '').trim()
  if (HEX.test(raw)) {
    const hex = raw.startsWith('#') ? raw : `#${raw}`
    root.style.setProperty('--accent', hex)
    root.style.setProperty('--accent-2', hex)
    root.style.setProperty('--accent-ink', inkFor(hex))
  }

  root.style.setProperty('--bg-brightness', String((settings.backgroundBrightness || 100) / 100))
  root.style.setProperty('--tile-blur', `${settings.tileBlur ?? 10}px`)
  // 0 blur = a fully transparent tile; above it the tint ramps with the blur
  // so the frost stays visible — see useTheme for the reasoning.
  const blur = Math.max(0, Number(settings.tileBlur ?? 10))
  if (blur <= 0) {
    root.style.setProperty('--tile-tint', 'transparent')
  } else {
    const alpha = Math.min(75, Math.round(15 + (blur / 30) * 60))
    root.style.setProperty('--tile-tint', `color-mix(in srgb, var(--surface) ${alpha}%, transparent)`)
  }
}
