// The routine's finish screen, as an overlay ON the dashboard (user request,
// 2026-09-11: "why not put the finish screen on top of the dashboard? When
// the user clicks the button in the finish screen, it will just blur out, and
// he will see the dashboard"). The worker opens dashboard.html carrying the
// same ?q=/?s= summary the old routine-done page read; the board mounts
// underneath and this overlay covers it — a full-viewport backdrop plus the
// summary card. Done starts the blur-out (opacity + blur, honoring the motion
// setting / low power mode); when it lands the overlay unmounts and the
// summary query is stripped from the URL, so a reload lands on the plain
// board. A reload BEFORE Done re-reads the query and shows the overlay again
// — the summary survives until the user has actually acknowledged it.

import { useState } from 'react'
import { STEP_LABEL } from '../../shared/settings.ts'
import type { BackgroundStyle, StepId } from '../../shared/settings.ts'
import { Background } from '../../popup/fx/Background.tsx'
import { Confetti } from '../../popup/fx/Confetti.tsx'

// The ?q= summary is keyed by Activities keys (the streaks the user finishes),
// ?s= by StepId (the routine steps skipped as already done). Two maps, one per
// query, with the raw key as the fallback label.
const STREAK_LABEL: Record<string, string> = {
  bingSearch: 'Bing searches',
  dailySet: 'Daily set',
  bingApp: 'Bing app check-in',
  visualSearch: 'Image search',
}

export type FinishPair = { key: string; value: string }

// Split on the FIRST ':' only: a display value can itself contain a colon, but
// the key never does (and the worker keeps ?s= reasons ':'-free), so slicing at
// the first colon reconstructs both halves cleanly.
function splitPairs(raw: string): FinishPair[] {
  if (!raw) return []
  return raw
    .split(';')
    .map((part): FinishPair | null => {
      const i = part.indexOf(':')
      if (i < 0) return null
      const key = part.slice(0, i).trim()
      const value = part.slice(i + 1).trim()
      return key ? { key, value } : null
    })
    .filter((p): p is FinishPair => p !== null)
}

export interface FinishSummary {
  todo: FinishPair[]
  skipped: FinishPair[]
  dev: boolean
}

// What the worker's finish URL carries, or null on a plain dashboard open —
// the dashboard's gate for showing this overlay at all.
export function readFinishSummary(): FinishSummary | null {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('q')
  const s = params.get('s')
  const dev = params.get('dev') === '1'
  if (!q && !s && !dev) return null
  return { todo: splitPairs(q || ''), skipped: splitPairs(s || ''), dev }
}

// How long the blur-out runs before the overlay unmounts (matches the CSS
// transition in dashboard.css).
const BLUR_OUT_MS = 450

export function FinishOverlay({
  summary,
  background,
  animate,
  onClose,
}: {
  summary: FinishSummary
  background: BackgroundStyle
  animate: boolean
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const allDone = summary.todo.length === 0

  const done = () => {
    // Still mode (animations off, low power, reduced motion) skips the
    // transition and the wait together.
    if (!animate) {
      onClose()
      return
    }
    setClosing(true)
    setTimeout(onClose, BLUR_OUT_MS)
  }

  return (
    <div
      className={`finish-overlay${closing ? ' finish-overlay--closing' : ''}${animate ? '' : ' finish-overlay--still'}`}
      role="dialog"
      aria-label="Daily routine complete"
    >
      <Background style={background} animate={animate} />
      <div className="finish-card">
        <Confetti fire={animate} />
        {summary.dev && <div className="finish-dev">Preview · dev</div>}
        <div className="finish-glyph" aria-hidden="true" />
        <h1 className="finish-title">Daily routine complete</h1>
        <p className="finish-sub">
          Reward Routine Automator finished its run.{' '}
          {allDone
            ? 'Every streak it can reach is done.'
            : 'A couple of streaks need you to finish them by hand.'}
        </p>

        {allDone && (
          <div className="finish-all-done">
            <span className="finish-dot finish-dot--done" />
            <span>All caught up — nothing left to do today. 🎉</span>
          </div>
        )}

        {summary.todo.length > 0 && (
          <section className="finish-section">
            <h2 className="finish-section-title">Finish these yourself</h2>
            <ul className="finish-list">
              {summary.todo.map(({ key, value }) => (
                <li className="finish-row" key={key}>
                  <span className="finish-dot finish-dot--todo" />
                  <span className="finish-name">{STREAK_LABEL[key] || key}</span>
                  <span className="finish-val">{value}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary.skipped.length > 0 && (
          <section className="finish-section">
            <h2 className="finish-section-title">Skipped — already done</h2>
            <ul className="finish-list">
              {summary.skipped.map(({ key, value }) => (
                <li className="finish-row finish-row--skip" key={key}>
                  <span className="finish-dot finish-dot--done" />
                  <span className="finish-name">{STEP_LABEL[key as StepId] || key}</span>
                  <span className="finish-val">{value}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="finish-actions">
          <button className="btn btn--primary finish-done" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
