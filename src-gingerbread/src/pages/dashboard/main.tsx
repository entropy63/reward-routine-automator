import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getSettings } from '../../shared/settings.ts'
import { applyTheme } from '../../theme/apply.ts'
import { Background } from '../../popup/fx/Background.tsx'
import { useSettings } from '../../popup/hooks/useSettings.ts'
import { useRunState } from '../../popup/hooks/useRunState.ts'
import { sendMessage } from '../../shared/messages.ts'
import type { Message, MessageResponse } from '../../shared/messages.ts'
import { Settings as SettingsView } from '../../popup/views/Settings.tsx'
import { GearIcon } from '../../popup/components/icons.tsx'
import { DashboardCtx } from './ctx.tsx'
import type { DashboardWiring } from './ctx.tsx'
import { DashboardGrid } from './layout/GridLayout.tsx'
import { FinishOverlay, readFinishSummary } from './FinishOverlay.tsx'
import '../../theme/tokens.css'
import '../../theme/backgrounds.css'
// The settings view reuses the popup's Settings component wholesale, so its
// sheet rides along (class-based; the one popup-scoped rule, .app's fixed
// 440px frame, is a class this page never renders).
import '../../popup/popup.css'
import './dashboard.css'

// The full-screen dashboard (user request, 2026-09-08): everything the
// extension knows, at full size. Same hooks and pure modules as the popup
// (one source of truth), its own stylesheet, and NO useMouseEscape (a
// full-screen surface doesn't dodge).
//
// No header bar (user request, 2026-09-09): the grid runs edge to edge; the
// Refresh button lives in the Balance tile's head, the Edit layout bar and
// the gear float over the board. pages.css is deliberately NOT imported:
// that sheet centers the worker-opened dialog pages (body flex + padding
// 24px), which fought this page's full viewport rules.
//
// 6.8.0 rewrite (user request, 2026-09-11: "I do not like the current
// layout. And layout handling I want you to start again from scratch… you
// are working in React. Reusable components take advantage of that"): the
// page is now a slim SHELL — the wiring (settings, run state, the message
// sender) plus the gear's settings surface and the board. Every tile is a
// self-contained component that owns its data hooks (tiles/), the board is
// react-grid-layout with per-tile designed steps (layout/), and the
// registry (tiles/registry.ts) is the single data source for sizes and the
// default board.

function DashboardPage({ animate }: { animate: boolean }) {
  const { settings, save } = useSettings()
  const runState = useRunState()
  // The routine's finish screen (6.8.0): the worker opens the dashboard with
  // the summary in the query (?q=/?s=, ?dev for the Developer-Option preview).
  // Captured ONCE at mount — the state decides whether the overlay shows, so
  // it must not flicker with re-renders. A reload before Done re-reads the
  // query and shows it again; Done strips the query, so a reload after lands
  // on the plain board.
  const [finish, setFinish] = useState(readFinishSummary)
  const closeFinish = useCallback(() => {
    setFinish(null)
    history.replaceState(null, '', window.location.pathname)
  }, [])
  // The gear's settings surface (user request, 2026-09-09): the dashboard's
  // content swaps for the same settings the popup edits, distributed across
  // the full width.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The run controls' in-flight marker (the popup's Run view's `busy`): one
  // message at a time, so each button disables itself while its action runs.
  const [busy, setBusy] = useState<Message['type'] | null>(null)
  // Stable identity so the wiring memo below only moves on real state changes.
  const send = useCallback((message: Message): Promise<MessageResponse> => {
    setBusy(message.type)
    return sendMessage(message).finally(() => setBusy(null))
  }, [])

  // One stable context value: rebuilt only when a field the tiles actually
  // read moves (busy per action, runState per tick, settings on save) — not on
  // every DashboardPage render (the gear toggle, any parent re-render). Without
  // it every consumer — Controls, Balance, History, Next — would reconcile on
  // each unrelated render.
  const wiring = useMemo<DashboardWiring>(
    () => ({ settings, save, runState, send, busy, animate }),
    [settings, save, runState, send, busy, animate],
  )

  return (
    <div className="dash">
      <Background style={settings.background} animate={animate} />

      {/* The gear, pinned top-right over whatever content is showing — the
       * dashboard's own way into its settings surface. */}
      <button
        className="icon-btn dash-gear"
        aria-label="Settings"
        title="Settings"
        aria-pressed={settingsOpen}
        onClick={() => setSettingsOpen((v) => !v)}
      >
        <GearIcon />
      </button>

      {settingsOpen ? (
        <div className="dash-settings">
          <SettingsView settings={settings} save={save} motionOn={animate} />
        </div>
      ) : (
        <DashboardCtx.Provider value={wiring}>
          <DashboardGrid animate={animate} />
        </DashboardCtx.Provider>
      )}

      {/* The finish overlay last and topmost: it covers the gear, the
       * settings surface and the board alike until the user presses Done. */}
      {finish && (
        <FinishOverlay
          summary={finish}
          background={settings.background}
          animate={animate}
          onClose={closeFinish}
        />
      )}
    </div>
  )
}

const root = document.getElementById('root')

// The mounting pattern from confirm/main.tsx: the theme applies before the
// first paint (settings read, a few ms), the hydration gate renders null
// until useSettings sees the stored blob — same rule as the popup's App.
// A storage failure still mounts with defaults (useSettings merges them).
getSettings()
  .then((s) => {
    applyTheme(s)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = s.animationsEnabled && !s.lowPowerMode && !reduce
    if (root) {
      createRoot(root).render(
        <StrictMode>
          <DashboardPage animate={animate} />
        </StrictMode>,
      )
    }
  })
  .catch(() => {
    if (root) {
      createRoot(root).render(
        <StrictMode>
          <DashboardPage animate={false} />
        </StrictMode>,
      )
    }
  })
