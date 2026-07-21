import { PAVOISSim, type SimCamera, type SimTrack } from '../sim/pavoisSim'
import type { Theme } from '../store/simStore'

// ── Shared primitives ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = { active: '#10B981', degraded: '#F59E0B', offline: '#EF4444' }
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: colors[status] ?? '#9CA3AF',
      boxShadow: status === 'active' ? `0 0 0 2px ${colors.active}33` : 'none',
      flexShrink: 0,
    }} />
  )
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.7 ? '#10B981' : value >= 0.4 ? '#F59E0B' : '#EF4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 32, height: 4, background: '#334155', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 600, color }}>{pct}%</span>
    </div>
  )
}

// ── Camera Panel ──────────────────────────────────────────────────────────────

interface Props {
  cameras: SimCamera[]
  tracks: SimTrack[]
  currentTime: number
  selectedCamera: string | null
  onSelectCamera: (id: string | null) => void
  theme: Theme
}

const THEME_VARS = {
  light: { bg: '#0F172A', text: '#F1F5F9', sub: '#94A3B8', border: '#1E293B', hover: '#1E2A3B', selBg: '#1E3A5F' },
  dark:  { bg: '#060C16', text: '#E2E8F0', sub: '#64748B', border: '#111827', hover: '#111D2E', selBg: '#0E2440' },
  mono:  { bg: '#1A1D20', text: '#F0F0F0', sub: '#9CA3AF', border: '#272B30', hover: '#22262A', selBg: '#1E3040' },
}

const CLASSIFICATION_ICONS: Record<string, string> = {
  drone: '🛸',
  airplane: '✈️',
  bird: '🐦',
  other: '❓'
}

export default function Sidebar({ cameras, tracks, currentTime, selectedCamera, onSelectCamera, theme }: Props) {
  const C = THEME_VARS[theme]
  const totalActive   = cameras.filter(c => c.status === 'active').length
  const totalDegraded = cameras.filter(c => c.status === 'degraded').length
  const totalOffline  = cameras.filter(c => c.status === 'offline').length

  return (
    <div style={{ background: C.bg, color: C.text, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#64748B', marginBottom: 8, fontFamily: 'IBM Plex Mono, monospace' }}>
          CAPTEURS
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {([
            ['#10B981', totalActive,   'active',   String(totalActive)   + ' actifs'],
            ['#F59E0B', totalDegraded, 'degraded', String(totalDegraded) + ' dégradé'],
            ['#EF4444', totalOffline,  'offline',  String(totalOffline)  + ' hors ligne'],
          ] as [string, number, string, string][]).map(([, , status, label]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <StatusDot status={status} />
              <span style={{ fontSize: 11, color: C.sub }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Camera list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {cameras.map(cam => {
          const isSel = selectedCamera === cam.id
          const detectingTracks = tracks.filter(t => {
            const pos = PAVOISSim.lerpPos(t.waypoints, currentTime)
            return PAVOISSim.getDetectingCameras(pos).some(c => c.id === cam.id)
          })
          return (
            <div
              key={cam.id}
              onClick={() => onSelectCamera(isSel ? null : cam.id)}
              style={{
                padding: '10px 16px', cursor: 'pointer',
                borderLeft: isSel ? `3px solid ${cam.color}` : '3px solid transparent',
                background: isSel ? C.selBg : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = isSel ? C.selBg : C.hover }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSel ? C.selBg : 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <StatusDot status={cam.status} />
                <span style={{ fontSize: 12, fontWeight: 600, color: cam.status === 'offline' ? C.sub : C.text }}>{cam.id}</span>
                <span style={{ fontSize: 11, color: C.sub, marginLeft: 'auto' }}>{cam.name}</span>
                <div style={{ width: 8, height: 8, borderRadius: 1, background: cam.color, opacity: cam.status === 'offline' ? 0.3 : 0.9 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 15 }}>
                {cam.status === 'offline' && (
                  <span style={{ fontSize: 10, color: '#EF4444', fontFamily: 'IBM Plex Mono, monospace', fontStyle: 'italic' }}>Signal perdu</span>
                )}
                {cam.status === 'degraded' && (
                  <span style={{ fontSize: 10, color: '#F59E0B', fontFamily: 'IBM Plex Mono, monospace', fontStyle: 'italic' }}>Signal dégradé</span>
                )}
                {cam.status === 'active' && detectingTracks.length > 0 && (
                  <span style={{ fontSize: 10, color: '#10B981', fontFamily: 'IBM Plex Mono, monospace' }}>
                    ▸ {detectingTracks.length} contact{detectingTracks.length > 1 ? 's' : ''}
                  </span>
                )}
                {cam.status === 'active' && detectingTracks.length === 0 && (
                  <span style={{ fontSize: 10, color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>En veille</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>{cam.fov}° FoV</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Track summary */}
      <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#64748B', marginBottom: 8, fontFamily: 'IBM Plex Mono, monospace' }}>
          PISTES ACTIVES
        </div>
        {tracks.map(t => {
          const pos = PAVOISSim.lerpPos(t.waypoints, currentTime)
          const cams = PAVOISSim.getDetectingCameras(pos)
          const conf = PAVOISSim.getConfidence(cams)
          const icon = CLASSIFICATION_ICONS[t.classification] || '❓'
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: C.text, flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span title={t.classification.toUpperCase()} style={{ cursor: 'help' }}>{icon}</span>
                <span>{t.id}</span>
              </span>
              <ConfidenceBadge value={conf} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
