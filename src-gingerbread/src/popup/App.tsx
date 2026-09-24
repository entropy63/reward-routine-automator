import { useEffect, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import { AnimatePresence } from 'framer-motion'
import { getSettings, DEFAULT_SETTINGS } from '../shared/settings.ts'
import { sendMessage } from '../shared/messages.ts'
import type { RunState } from '../shared/storage.ts'
import { slotMissingDefaults } from '../background/pure/orders.ts'
import { useSettings } from './hooks/useSettings.ts'
import { useRunState } from './hooks/useRunState.ts'
import { usePointsHistory, useStats } from './hooks/useStats.ts'
import { useMessage } from './hooks/useMessage.ts'
import { useTheme } from './hooks/useTheme.ts'
import { useMouseEscape } from './hooks/useMouseEscape.ts'
import { useMotionEnabled } from './fx/motion-presets.ts'
import { Background } from './fx/Background.tsx'
import { Banners } from './components/Banners.tsx'
import { Today } from './views/Today.tsx'
import { Run } from './views/Run.tsx'
import { Activity } from './views/Activity.tsx'
import { Redeem } from './views/Redeem.tsx'
import { Settings } from './views/Settings.tsx'
import {
  ActivityIcon,
  BackIcon,
  BellIcon,
  CheckCircleIcon,
  CometMark,
  FlaskIcon,
  GearIcon,
  GiftIcon,
  HomeIcon,
  LayoutDashboardIcon,
  PlayIcon,
  RedoIcon,
  RefreshIcon,
} from './components/icons.tsx'

type Tab = 'today' | 'runNow' | 'redeem' | 'activity'

const TABS: { id: Tab; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: 'today', label: 'Today', Icon: HomeIcon },
  { id: 'runNow', label: 'Run', Icon: PlayIcon },
  { id: 'redeem', label: 'Redeem', Icon: GiftIcon },
  { id: 'activity', label: 'Activity', Icon: ActivityIcon },
]

// The status pill's read of "what's running now", from the same run-state doc
// the Activity view uses.
function statusOf(rs: RunState): { label: string; live: boolean } {
  if (rs.batch) return { label: `Searching · ${rs.batch.remaining}`, live: true }
  if (rs.routine) return { label: 'Routine', live: true }
  if (rs.activity) return { label: rs.activity.label, live: true }
  return { label: 'Idle', live: false }
}

export function App() {
  const { settings, save, loaded } = useSettings()
  const runState = useRunState()
  const stats = useStats()
  const history = usePointsHistory()
  const { send, busy } = useMessage()

  useTheme(settings)
  // Low power mode overrides the animations toggle: everything that moves —
  // view transitions, the troll, the backdrop — goes still in one switch.
  const motionOn = useMotionEnabled(settings.animationsEnabled && !settings.lowPowerMode)
  // The troll: everything dodges the cursor while this is on. Same motion gate
  // as the rest of the popup (the animations toggle + OS reduced-motion).
  useMouseEscape(settings.mouseEscapeEnabled && motionOn)

  const [tab, setTab] = useState<Tab>('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Developer Option "preview every banner": local state only — the sample
  // payloads live in the component (src-donut's testNotificationsBtn was DOM-only
  // the same way), so the preview vanishes on the next popup open.
  const [bannerPreview, setBannerPreview] = useState(false)

  // Refresh-on-open: read the setting authoritatively (not the default-merged
  // first render) and fire once. sendMessage/getSettings directly — this is a
  // one-shot, not a subscription.
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    getSettings().then((s) => {
      if (s.refreshStatsOnPopupOpen) sendMessage({ type: 'REFRESH_STATS' })
    })
  }, [])

  const status = statusOf(runState)
  // One height for every tab (the frame never resizes on tab switches — the
  // stage scrolls); the popupHeight setting (240–600) overrides the 560
  // default, and anything else falls back to it.
  const height = settings.popupHeight >= 240 && settings.popupHeight <= 600 ? settings.popupHeight : 560

  // The tabbar follows the layout editor: the saved sectionOrder (normalized
  // the same way the routine normalizes its step order), minus the tabs the
  // user hid. If today's own tab is ever hidden or the current tab goes away,
  // fall back to the first visible one so the stage is never empty.
  const visibleTabs = slotMissingDefaults(settings.sectionOrder, DEFAULT_SETTINGS.sectionOrder).filter(
    (id) => !settings.hiddenSections.includes(id),
  ) as Tab[]
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0] || 'today'

  // Withhold the UI until the stored settings arrive: rendering from the
  // defaults first meant a visible flash when they differ (the glass tint's
  // alpha now tracks the blur knob, so a default-blur frame looked
  // near-transparent before the user's blur loaded — plus theme/appearance/
  // frame-height jumps). storage.sync answers in tens of ms warm.
  if (!loaded) return null

  return (
    <div className="app" style={{ height }}>
      <Background style={settings.background} animate={motionOn} />

      <header className="topbar">
        <div className="brand">
          {/* data-no-escape on Back: the way OUT of Settings must stay
           * clickable while the troll is on, same as the gear that leads in. */}
          {settingsOpen ? (
            <button
              className="icon-btn"
              onClick={() => setSettingsOpen(false)}
              aria-label="Back"
              title="Back"
              data-no-escape
            >
              <BackIcon />
            </button>
          ) : (
            // The extension's own comet mark beside the title — matches the
            // toolbar icon (see icons.tsx), not a blank gradient square.
            <CometMark className="brand-glyph" />
          )}
          <span className="brand-title">{settingsOpen ? 'Settings' : 'Reward Routine Automator — Gingerbread'}</span>
        </div>
        <div className="topbar-actions">
          <span className={`status-pill${status.live ? ' status-pill--live' : ''}`} title={status.label}>
            {status.label}
          </span>
          {/* The full-screen dashboard (user request, 2026-09-08): always
           * visible, not dev-gated — it is the extension's analytics surface,
           * the same data the popup shows, at full size. The worker opens it
           * in a foreground tab (OPEN_DASHBOARD). */}
          <button
            className="icon-btn"
            onClick={() => send({ type: 'OPEN_DASHBOARD' })}
            aria-label="Open the dashboard"
            title="Open the full-screen dashboard"
          >
            <LayoutDashboardIcon />
          </button>
          <button
            className={`icon-btn${busy === 'REFRESH_STATS' ? ' spinning' : ''}`}
            onClick={() => send({ type: 'REFRESH_STATS' })}
            aria-label="Refresh stats"
            title="Refresh stats"
          >
            <RefreshIcon />
          </button>
          {/* Developer Options (gated on the Settings toggle, like the other
           * builds): the finish-screen opener — the dashboard overlay the
           * routine itself opens at endRoutine — the once-per-day reset, so
           * the next browser start runs the startup routine again, the
           * Rewards-API probe, which fetches the JSON endpoint the dashboard
           * itself loads and logs its shape to the worker console, and the
           * banner preview, which raises every banner the extension can show
           * with sample payloads. The launches themselves walk their own
           * gates. */}
          {!settingsOpen && settings.developerOptionsEnabled && (
            <>
              <button
                className="icon-btn"
                onClick={() => send({ type: 'OPEN_ROUTINE_DONE' })}
                aria-label="Open the finish screen"
                title="Open the routine finish screen (preview)"
              >
                <CheckCircleIcon />
              </button>
              <button
                className="icon-btn"
                onClick={() => send({ type: 'RESET_ROUTINE_DAY' })}
                aria-label="Run the routine again on the next browser start"
                title="Run the routine again on the next browser start"
              >
                <RedoIcon />
              </button>
              <button
                className="icon-btn"
                onClick={() => send({ type: 'PROBE_REWARDS_API' })}
                aria-label="Probe the Rewards API"
                title="Fetch the Rewards API the dashboard uses; logs the shape to the service worker console"
              >
                <FlaskIcon />
              </button>
              <button
                className={`icon-btn${bannerPreview ? ' icon-btn--on' : ''}`}
                onClick={() => setBannerPreview((v) => !v)}
                aria-label="Preview every banner"
                title="Preview every banner (Developer Option)"
              >
                <BellIcon />
              </button>
            </>
          )}
          {!settingsOpen && (
            /* data-no-escape: the gear never dodges — it's the way into
             * Settings, where the troll feature lives (user request). */
            <button
              className="icon-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              data-no-escape
            >
              <GearIcon />
            </button>
          )}
        </div>
      </header>

      <main className="stage">
        {/* The banners sit above the stage inside the fixed frame (compact
         * single-line styling keeps the tabbar visible): the Bing-app warning,
         * a restock, a newly sold-out amount. src-donut parity — not dismissible. */}
        {!settingsOpen && <Banners stats={stats} preview={bannerPreview} />}
        <AnimatePresence mode="wait">
          {settingsOpen ? (
            <Settings key="settings" settings={settings} save={save} motionOn={motionOn} />
          ) : activeTab === 'today' ? (
            <Today key="today" settings={settings} stats={stats} history={history} motionOn={motionOn} />
          ) : activeTab === 'runNow' ? (
            <Run key="run" settings={settings} save={save} runState={runState} send={send} busy={busy} motionOn={motionOn} />
          ) : activeTab === 'redeem' ? (
            <Redeem key="redeem" stats={stats} send={send} busy={busy} motionOn={motionOn} />
          ) : (
            <Activity key="activity" runState={runState} />
          )}
        </AnimatePresence>
      </main>

      {!settingsOpen && (
        <nav className="tabbar">
          {TABS.filter(({ id }) => visibleTabs.includes(id)).map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`tab${activeTab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
              aria-current={activeTab === id}
            >
              <span className="tab-icon">
                <Icon />
              </span>
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
