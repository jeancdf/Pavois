import { PAVOISSim, type SimCamera } from '../sim/pavoisSim'
import type { Theme } from '../store/simStore'

interface Props {
  cameras: SimCamera[]
  theme: Theme
}

const THEME_VARS = {
  light: { bg: '#F7F9FC', card: '#fff',    text: '#0F172A', sub: '#64748B', border: '#E2E8F0', head: '#F1F5F9' },
  dark:  { bg: '#060C16', card: '#0F172A', text: '#F1F5F9', sub: '#64748B', border: '#1E293B', head: '#111827' },
  mono:  { bg: '#F4F5F6', card: '#FAFAFA', text: '#111',    sub: '#6B7280', border: '#E5E7EB', head: '#ECEEF0' },
}

const STATUS_COLORS: Record<string, string> = { active: '#10B981', degraded: '#F59E0B', offline: '#EF4444' }
const STATUS_LABELS: Record<string, string> = { active: 'Opérationnel', degraded: 'Dégradé', offline: 'Hors service' }

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#9CA3AF'
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

export default function DeploymentView({ cameras, theme }: Props) {
  const C = THEME_VARS[theme]

  const coverageStats = cameras.map(cam => {
    const area = Math.PI * cam.range * cam.range * (cam.fov / 360)
    return { ...cam, area: area.toFixed(1) }
  })
  const totalArea  = coverageStats.reduce((s, c) => s + parseFloat(c.area), 0)
  const gridArea   = PAVOISSim.GRID * PAVOISSim.GRID
  const coveragePct = Math.min(100, (totalArea / gridArea * 100)).toFixed(0)

  const summaryCards = [
    { label: 'Capteurs actifs', val: String(cameras.filter(c => c.status === 'active').length), sub: '/ ' + cameras.length, color: '#10B981' },
    { label: 'Couverture estimée', val: coveragePct + '%', sub: 'de la zone', color: '#3B82F6' },
    { label: 'Zones de recouv.', val: '4', sub: 'secteurs', color: '#8B5CF6' },
    { label: 'Angles morts', val: '2', sub: 'secteurs SO', color: '#F59E0B' },
  ]

  const colHeaders = ['ID', 'Nom', 'Az.', 'FoV', 'Portée', 'Altitude', 'Statut', 'Couverture']
  const colTemplate = '80px 100px 70px 70px 80px 80px 1fr 100px'

  return (
    <div style={{ flex: 1, background: C.bg, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {summaryCards.map(({ label, val, sub, color }) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', borderTop: `3px solid ${color}` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: 'IBM Plex Mono, monospace', marginBottom: 2 }}>{val}</div>
            <div style={{ fontSize: 11, color: C.sub }}>{sub}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginTop: 6 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Camera table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{ background: C.head, padding: '10px 18px', borderBottom: `1px solid ${C.border}`, display: 'grid', gridTemplateColumns: colTemplate, gap: 8 }}>
          {colHeaders.map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>
              {h.toUpperCase()}
            </span>
          ))}
        </div>
        {/* Table rows */}
        {coverageStats.map((cam, i) => (
          <div key={cam.id} style={{
            padding: '10px 18px',
            borderBottom: i < cameras.length - 1 ? `1px solid ${C.border}` : 'none',
            display: 'grid', gridTemplateColumns: colTemplate, gap: 8, alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: C.text, fontWeight: 600 }}>{cam.id}</span>
            <span style={{ fontSize: 12, color: C.text }}>{cam.name}</span>
            <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>{cam.azimuth}°</span>
            <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>{cam.fov}°</span>
            <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>{cam.range} u</span>
            <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>{cam.z * 12} m</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={cam.status} />
              <span style={{ fontSize: 11, color: STATUS_COLORS[cam.status] ?? '#9CA3AF' }}>
                {STATUS_LABELS[cam.status] ?? cam.status}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
                <div style={{
                  width: `${Math.min(100, parseFloat(cam.area) / 40 * 100)}%`,
                  height: '100%', background: cam.color, borderRadius: 2,
                  opacity: cam.status === 'offline' ? 0.3 : 1,
                }} />
              </div>
              <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: C.sub }}>{cam.area}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Coverage legend */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 12, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.06em' }}>
          LÉGENDE — COUVERTURE
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {([
            ['#10B981', 0.25, 'Couverture unique'],
            ['#3B82F6', 0.4,  'Recouvrement 2 capteurs'],
            ['#8B5CF6', 0.5,  'Recouvrement ≥3 capteurs'],
            ['#F59E0B', 0.3,  'Zone dégradée'],
            ['#EF4444', 0.25, 'Angle mort'],
          ] as [string, number, string][]).map(([col, , label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 14, borderRadius: 3, background: col, opacity: 0.4, border: `1px solid ${col}` }} />
              <span style={{ fontSize: 11, color: C.sub }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
