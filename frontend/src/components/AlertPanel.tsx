import type { SimAlert } from '../sim/pavoisSim'
import type { Theme } from '../store/simStore'

interface Props {
  alerts: SimAlert[]
  onAck: (id: string) => void
  theme: Theme
}

const THEME_VARS = {
  light: { bg: '#FFFFFF', text: '#1E293B', sub: '#64748B', border: '#E2E8F0', ackBg: '#F8FAFC' },
  dark:  { bg: '#0F172A', text: '#CBD5E1', sub: '#475569', border: '#1E293B', ackBg: '#111827' },
  mono:  { bg: '#FAFAFA', text: '#1A1D20', sub: '#6B7280', border: '#E5E7EB', ackBg: '#F4F5F6' },
}

const SEV_MAP: Record<string, [string, string]> = {
  critical: ['#EF4444', '!'],
  high:     ['#F97316', '↑'],
  medium:   ['#F59E0B', '◈'],
  low:      ['#94A3B8', '◇'],
}

function SevIcon({ sev }: { sev: string }) {
  const [col, sym] = SEV_MAP[sev] ?? SEV_MAP.low
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: 4, background: `${col}22`,
      color: col, fontSize: 10, fontWeight: 900, fontFamily: 'monospace', flexShrink: 0,
    }}>
      {sym}
    </span>
  )
}

export default function AlertPanel({ alerts, onAck, theme }: Props) {
  const C = THEME_VARS[theme]
  const unack = alerts.filter(a => !a.ack)

  return (
    <div style={{ background: C.bg, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderLeft: `1px solid ${C.border}`, fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#64748B', fontFamily: 'IBM Plex Mono, monospace' }}>ALERTES</span>
        {unack.length > 0 && (
          <span style={{ background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px', fontFamily: 'IBM Plex Mono, monospace' }}>
            {unack.length}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {alerts.map(a => (
          <div key={a.id} style={{
            padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
            background: a.ack ? C.ackBg : C.bg,
            opacity: a.ack ? 0.55 : 1,
            transition: 'opacity 0.2s',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <SevIcon sev={a.sev} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.msg}
                </div>
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 4 }}>{a.sub}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: C.sub, fontFamily: 'IBM Plex Mono, monospace' }}>{a.time}</span>
                  {!a.ack && (
                    <button
                      onClick={() => onAck(a.id)}
                      style={{ fontSize: 10, color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    >
                      ACK
                    </button>
                  )}
                  {a.ack && (
                    <span style={{ fontSize: 10, color: '#10B981', fontFamily: 'IBM Plex Mono, monospace' }}>✓ acquitté</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
