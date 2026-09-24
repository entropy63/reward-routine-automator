import { memo } from 'react'
import type { BackgroundStyle } from '../../shared/settings.ts'
import { AuroraBackground } from './AuroraBackground.tsx'
import { BeamsBackground } from './BeamsBackground.tsx'
import { StarsBackground } from './StarsBackground.tsx'
import { WavesBackground } from './WavesBackground.tsx'
import { MeteorsBackground } from './MeteorsBackground.tsx'
import { BubblesBackground } from './BubblesBackground.tsx'
import { SnowBackground } from './SnowBackground.tsx'
import { RainBackground } from './RainBackground.tsx'
import { RippleBackground } from './RippleBackground.tsx'
import { OrbitBackground } from './OrbitBackground.tsx'
import { FirefliesBackground } from './FirefliesBackground.tsx'
import { BokehBackground } from './BokehBackground.tsx'
import { CursorGlowBackground } from './CursorGlowBackground.tsx'
import { ParticlesBackground } from './ParticlesBackground.tsx'
import { ParallaxBackground } from './ParallaxBackground.tsx'
import { ConstellationBackground } from './ConstellationBackground.tsx'

// The backdrop, chosen by the user in Settings — the popup renders it inside
// .app, and the worker-opened surfaces (confirm / the dashboard and its
// finish overlay) render it over the page, so every surface shows the same
// chosen background. Sixteen
// styles own a component (see theme/backgrounds.css for what each paints):
// the ambient ones (aurora, beams, stars, waves, meteors, bubbles, snow,
// rain, ripple, orbit, fireflies, bokeh) and the four interactive ones that
// react to the pointer (cursor, particles, parallax, constellation). The rest
// are CSS-only layers that share one <div className="bg bg--<style>">; 'none'
// renders nothing at all. `animate` (false when motion is off or the OS asks
// for reduced motion) is forwarded to each component and, as .bg--static, to
// the CSS layers — the interactive styles also stop listening to the pointer
// when it is false.
// Memoized: the props are just the chosen style and the motion flag (both
// primitives), so the popup / dashboard surfaces re-render it
// only when one of those actually changes — a parent re-render (a busy tick,
// the gear toggle) would otherwise reconcile the whole chosen sub-background
// and its canvas each time.
export const Background = memo(function Background({ style, animate }: { style: BackgroundStyle; animate: boolean }) {
  if (style === 'none') return null
  if (style === 'aurora') return <AuroraBackground animate={animate} />
  if (style === 'beams') return <BeamsBackground animate={animate} />
  if (style === 'stars') return <StarsBackground animate={animate} />
  if (style === 'waves') return <WavesBackground animate={animate} />
  if (style === 'meteors') return <MeteorsBackground animate={animate} />
  if (style === 'bubbles') return <BubblesBackground animate={animate} />
  if (style === 'snow') return <SnowBackground animate={animate} />
  if (style === 'rain') return <RainBackground animate={animate} />
  if (style === 'ripple') return <RippleBackground animate={animate} />
  if (style === 'orbit') return <OrbitBackground animate={animate} />
  if (style === 'fireflies') return <FirefliesBackground animate={animate} />
  if (style === 'bokeh') return <BokehBackground animate={animate} />
  if (style === 'cursor') return <CursorGlowBackground animate={animate} />
  if (style === 'particles') return <ParticlesBackground animate={animate} />
  if (style === 'parallax') return <ParallaxBackground animate={animate} />
  if (style === 'constellation') return <ConstellationBackground animate={animate} />
  return <div className={`bg bg--${style}${animate ? '' : ' bg--static'}`} aria-hidden="true" />
})
