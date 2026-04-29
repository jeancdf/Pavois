import { PAVOISSim, type SimTrack } from '../sim/pavoisSim'
import type { Theme } from '../store/simStore'

interface Props {
  track: SimTrack
  currentTime: number
  theme: Theme
  onClose: () => void
}

const THEME_VARS = {
  light: { bg: '#fff',    text: '#0F172A', sub: '#64748B', border: '#E2E8F0' },
  dark:  { bg: '#0F172A', text: '#F1F5F9', sub: '#64748B', border: '#1E293B' },
  mono:  { bg: '#fafafa', text: '#111',    sub: '#6B7280', border: '#E5E7EB' },
}

const STATUS_COLORS: Record<string, string> = { confirmed: '#10B981', tentative: '#F59E0B', lost: '#EF4444' }
const STATUS_LABELS: Record<string, string> = { confirmed: 'CONFIRMÉE', tentative: 'TENTATIVE', lost: 'PERDUE' }

function ConfidenceBadgeLg({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.7 ? '#10B981' : value >= 0.4 ? '#F59E0B' : '#EF4444'
  const label = value >= 0.7 ? 'ÉLEVÉE' : value >= 0.4 ? 'MOY.' : 'FAIBLE'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 600, color, minWidth: 36 }}>{pct}%</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color, opacity: 0.8 }}>{label}</span>
    </div>
  )
}

export default function TrackDetail({ track, currentTime, theme, onClose }: Props) {
  const C = THEME_VARS[theme]
  const pos  = PAVOISSim.lerpPos(track.waypoints, currentTime)
  const vel  = PAVOISSim.getVelocity(track, currentTime)
  const cams = PAVOISSim.getDetectingCameras(pos)
  const conf = PAVOISSim.getConfidence(cams)
  const statusColor = STATUS_COLORS[track.status] ?? '#94A3B8'

  const Row = ({ label, val }: { label: string; val: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11, color: C.sub, width: 110, flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace' }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}>{val}</span>
    </div>
  )

  const heading = ((Math.atan2(vel.vy, vel.vx) * 180 / Math.PI) + 360) % 360

  return (
    <div style={{
      background: C.bg, borderTop: `2px solid ${track.color}`,
      padding: '14px 18px', borderLeft: `1px solid ${C.border}`,
      borderRight: `1px solid ${C.border}`, fontFamily: 'IBM Plex Sans, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: track.color }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{track.name}</span>
        <span style={{
          fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 700,
          color: statusColor, background: `${statusColor}18`,
          padding: '2px 7px', borderRadius: 4,
        }}>
          {STATUS_LABELS[track.status] ?? track.status.toUpperCase()}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>{track.id}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
        <div>
          <Row label="Position X" val={pos ? pos.x.toFixed(1) + ' u' : '—'} />
          <Row label="Position Y" val={pos ? pos.y.toFixed(1) + ' u' : '—'} />
          <Row label="Altitude Z" val={pos ? (pos.z * 12).toFixed(0) + ' m' : '—'} />
          <Row label="Capteurs" val={`${cams.length} actif${cams.length > 1 ? 's' : ''}`} />
        </div>
        <div>
          <Row label="Vitesse" val={`${vel.speed.toFixed(1)} m/s`} />
          <Row label="Cap" val={`${heading.toFixed(0)}°`} />
          <Row label="T+" val={`${currentTime.toFixed(1)} s`} />
          <div style={{ padding: '6px 0' }}>
            <span style={{ fontSize: 11, color: C.sub, fontFamily: 'IBM Plex Mono, monospace', display: 'block', marginBottom: 5 }}>Confiance</span>
            <ConfidenceBadgeLg value={conf} />
          </div>
        </div>
      </div>

      {cams.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 11, color: C.sub, fontFamily: 'IBM Plex Mono, monospace', display: 'block', marginBottom: 5 }}>
            Capteurs actifs sur cette piste
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cams.map(c => (
              <span key={c.id} style={{
                fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
                background: c.color + '22', color: c.color,
                padding: '2px 8px', borderRadius: 4, fontWeight: 600,
              }}>
                {c.id} {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
