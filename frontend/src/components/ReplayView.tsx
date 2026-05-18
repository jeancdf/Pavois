import { useState, useEffect, useRef } from 'react'
import { PAVOISSim, type SimCamera, type SimTrack } from '../sim/pavoisSim'
import IsometricMap from './IsometricMap'
import type { Theme } from '../store/simStore'

interface Props {
  cameras: SimCamera[]
  tracks: SimTrack[]
  theme: Theme
}

const THEME_VARS = {
  light: { bg: '#F7F9FC', card: '#fff',    text: '#0F172A', sub: '#64748B', border: '#E2E8F0', mapBg: '#EEF2F8' },
  dark:  { bg: '#060C16', card: '#0F172A', text: '#F1F5F9', sub: '#64748B', border: '#1E293B', mapBg: '#111827' },
  mono:  { bg: '#F4F5F6', card: '#FAFAFA', text: '#111',    sub: '#6B7280', border: '#E5E7EB', mapBg: '#ECEEF0' },
}

const TYPE_COLORS: Record<string, string> = { system: '#3B82F6', detection: '#F59E0B', track: '#10B981', alert: '#EF4444' }
const TYPE_ICONS:  Record<string, string> = { system: '◈', detection: '◎', track: '▸', alert: '⚠' }

const MAX_TIME = 9

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.7 ? '#10B981' : value >= 0.4 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 32, height: 4, background: '#E2E8F0', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600, color }}>{pct}%</span>
    </div>
  )
}

export default function ReplayView({ cameras, tracks, theme }: Props) {
  const [replayTime, setReplayTime] = useState(0)
  const [playing, setPlaying]       = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const C = THEME_VARS[theme]

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setReplayTime(t => {
          if (t >= MAX_TIME) { setPlaying(false); return MAX_TIME }
          return +(t + 0.1).toFixed(1)
        })
      }, 100)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [playing])

  const visibleEvents = PAVOISSim.EVENT_LOG.filter(e => e.t <= replayTime)

  return (
    <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Left: map + scrubber */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', background: C.mapBg }}>
          <IsometricMap
            cameras={cameras} tracks={tracks} currentTime={replayTime}
            selectedCamera={null} selectedTrack={null}
            onSelectCamera={() => {}} onSelectTrack={() => {}}
            showPrediction={false} showCoverage={true} theme={theme}
          />
        </div>

        {/* Scrubber */}
        <div style={{ background: C.card, borderTop: `1px solid ${C.border}`, padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
            <button
              onClick={() => { setReplayTime(0); setPlaying(false) }}
              style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 10px', color: C.sub, cursor: 'pointer', fontSize: 12 }}
            >
              ↩ Reset
            </button>
            <button
              onClick={() => setPlaying(p => !p)}
              style={{
                background: playing ? '#EF444422' : '#3B82F622',
                border: `1px solid ${playing ? '#EF4444' : '#3B82F6'}`,
                borderRadius: 5, padding: '4px 14px',
                color: playing ? '#EF4444' : '#3B82F6',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              {playing ? '⏸ Pause' : '▶ Lecture'}
            </button>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: C.text }}>
              T+{replayTime.toFixed(1)}s
            </span>
            <div style={{ flex: 1 }}>
              <input
                type="range" min={0} max={MAX_TIME} step={0.1} value={replayTime}
                onChange={e => { setReplayTime(parseFloat(e.target.value)); setPlaying(false) }}
                style={{ width: '100%', accentColor: '#3B82F6' }}
              />
            </div>
            <span style={{ fontSize: 11, color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>/{MAX_TIME}s</span>
          </div>

          {/* Track state */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {tracks.map(t => {
              const pos = PAVOISSim.lerpPos(t.waypoints, replayTime)
              const active = pos !== null && replayTime >= t.waypoints[0].t
              const cams = active ? PAVOISSim.getDetectingCameras(pos) : []
              const conf = PAVOISSim.getConfidence(cams)
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                  background: active ? `${t.color}12` : C.card,
                  border: `1px solid ${active ? t.color + '44' : C.border}`,
                  borderRadius: 7, opacity: active ? 1 : 0.4,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text, fontFamily: 'IBM Plex Mono, monospace' }}>{t.id}</span>
                  {active ? <ConfidenceBadge value={conf} /> : <span style={{ fontSize: 10, color: C.sub }}>— non actif</span>}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Right: event log */}
      <div style={{ width: 280, background: C.card, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>
            JOURNAL ÉVÉNEMENTS
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {[...visibleEvents].reverse().map((ev, i) => (
            <div key={i} style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}44`, opacity: Math.max(0.2, 1 - i * 0.04) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                <span style={{ color: TYPE_COLORS[ev.type] ?? '#64748B', fontSize: 12 }}>{TYPE_ICONS[ev.type]}</span>
                <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>T+{ev.t.toFixed(1)}s</span>
              </div>
              <span style={{ fontSize: 11, color: C.text }}>{ev.msg}</span>
            </div>
          ))}
          {visibleEvents.length === 0 && (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: C.sub, fontSize: 12 }}>
              Démarrez la lecture pour voir les événements
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
