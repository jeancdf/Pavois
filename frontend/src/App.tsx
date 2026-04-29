import { useEffect, useRef } from 'react'
import MapViewer from './components/MapViewer'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import AlertPanel from './components/AlertPanel'
import TrackDetail from './components/TrackDetail'
import IsometricMap from './components/IsometricMap'
import DeploymentView from './components/DeploymentView'
import ReplayView from './components/ReplayView'
import { useSimStore } from './store/simStore'
import { PAVOISSim } from './sim/pavoisSim'

const THEME_VARS = {
  light: { bg: '#F7F9FC', border: '#E2E8F0', mapBg: '#EEF2F8' },
  dark:  { bg: '#060C16', border: '#1E293B', mapBg: '#111827' },
  mono:  { bg: '#ECEEF0', border: '#D9DCDF', mapBg: '#F4F5F6' },
}

export default function App() {
  const {
    theme, view, currentTime, running,
    selectedCamera, selectedTrack,
    showPrediction, showCoverage, alerts,
    setTheme, setView, tickTime, toggleRunning,
    setSelectedCamera, setSelectedTrack,
    setShowPrediction, setShowCoverage, ackAlert,
  } = useSimStore()

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Simulation clock
  useEffect(() => {
    if (running && view === 'live') {
      intervalRef.current = setInterval(() => tickTime(0.05), 80)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, view, tickTime])

  const C = THEME_VARS[theme]
  const cameras = PAVOISSim.CAMERAS
  const tracks  = PAVOISSim.TRACKS_DEF
  const selectedTrackData = tracks.find(t => t.id === selectedTrack)

  const MapOverlayControls = () => (
    <div style={{ position: 'absolute', bottom: 60, left: 14, display: 'flex', gap: 8, zIndex: 10 }}>
      {([
        [showCoverage,   () => setShowCoverage(!showCoverage),     '⬡ Couverture'],
        [showPrediction, () => setShowPrediction(!showPrediction), '⇢ Prédiction'],
      ] as [boolean, () => void, string][]).map(([active, toggle, label]) => (
        <button
          key={label}
          onClick={toggle}
          style={{
            fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${active ? '#3B82F6' : C.border}`,
            background: active ? '#3B82F622' : (theme === 'dark' ? '#0F172Acc' : '#ffffffcc'),
            color: active ? '#3B82F6' : '#64748B',
            cursor: 'pointer', backdropFilter: 'blur(4px)', fontFamily: 'IBM Plex Sans, sans-serif',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: 'IBM Plex Sans, sans-serif', overflow: 'hidden' }}>
      <TopBar
        view={view} onViewChange={setView}
        currentTime={currentTime} running={running} onToggleRun={toggleRunning}
        theme={theme} onThemeChange={setTheme}
      />

      {/* ── Live (Surveillance) ── */}
      {view === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: camera panel */}
          <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${C.border}` }}>
            <Sidebar
              cameras={cameras} tracks={tracks} currentTime={currentTime}
              selectedCamera={selectedCamera} onSelectCamera={setSelectedCamera} theme={theme}
            />
          </div>

          {/* Center: Cesium map + overlays */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <MapViewer />
              <MapOverlayControls />
            </div>
            {selectedTrackData && (
              <TrackDetail
                track={selectedTrackData} currentTime={currentTime}
                theme={theme} onClose={() => setSelectedTrack(null)}
              />
            )}
          </div>

          {/* Right: alert panel */}
          <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <AlertPanel alerts={alerts} onAck={ackAlert} theme={theme} />
          </div>
        </div>
      )}

      {/* ── Déploiement ── */}
      {view === 'deploy' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Isometric map preview */}
            <div style={{ height: 300, flexShrink: 0, position: 'relative', overflow: 'hidden', background: C.mapBg }}>
              <IsometricMap
                cameras={cameras} tracks={[]} currentTime={0}
                selectedCamera={selectedCamera} selectedTrack={null}
                onSelectCamera={setSelectedCamera} onSelectTrack={() => {}}
                showPrediction={false} showCoverage={true} theme={theme}
              />
              <div style={{ position: 'absolute', bottom: 14, left: 14 }}>
                <button
                  onClick={() => setShowCoverage(!showCoverage)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
                    border: `1px solid ${showCoverage ? '#3B82F6' : C.border}`,
                    background: showCoverage ? '#3B82F622' : (theme === 'dark' ? '#0F172Acc' : '#ffffffcc'),
                    color: showCoverage ? '#3B82F6' : '#64748B',
                    cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif',
                  }}
                >
                  ⬡ Couverture
                </button>
              </div>
            </div>
            {/* Table */}
            <DeploymentView cameras={cameras} theme={theme} />
          </div>
        </div>
      )}

      {/* ── Post-événement ── */}
      {view === 'replay' && (
        <ReplayView cameras={cameras} tracks={tracks} theme={theme} />
      )}
    </div>
  )
}
