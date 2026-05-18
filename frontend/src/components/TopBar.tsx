import type { Theme, View } from '../store/simStore'

interface Props {
  view: View
  onViewChange: (v: View) => void
  currentTime: number
  running: boolean
  onToggleRun: () => void
  theme: Theme
  onThemeChange: (t: Theme) => void
}

const THEME_VARS = {
  light: { bg: '#fff',    border: '#E2E8F0', text: '#0F172A', sub: '#64748B', tabActive: '#0F172A', tabActiveBg: '#F1F5F9' },
  dark:  { bg: '#0F172A', border: '#1E293B', text: '#F1F5F9', sub: '#475569', tabActive: '#F1F5F9', tabActiveBg: '#1E293B' },
  mono:  { bg: '#fafafa', border: '#E5E7EB', text: '#111',    sub: '#6B7280', tabActive: '#111',    tabActiveBg: '#F4F5F6' },
}

const THEMES_BTN: [Theme, string][] = [['light', '☀'], ['dark', '☾'], ['mono', '⊡']]

export default function TopBar({ view, onViewChange, currentTime, running, onToggleRun, theme, onThemeChange }: Props) {
  const C = THEME_VARS[theme]

  const tabs: [View, string][] = [
    ['live',   '● Surveillance'],
    ['deploy', '⬡ Déploiement'],
    ['replay', '↺ Post-événement'],
  ]

  const mm = String(Math.floor(currentTime / 60)).padStart(2, '0')
  const ss = String(Math.floor(currentTime % 60)).padStart(2, '0')
  const ms = String(Math.floor((currentTime % 1) * 10))

  return (
    <div style={{
      background: C.bg, borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', padding: '0 16px',
      height: 52, flexShrink: 0, fontFamily: 'IBM Plex Sans, sans-serif',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 24 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <polygon points="11,2 20,7 20,15 11,20 2,15 2,7" fill="#3B82F6" opacity="0.15" stroke="#3B82F6" strokeWidth="1.5" />
          <polygon points="11,5 17,8.5 17,13.5 11,17 5,13.5 5,8.5" fill="#3B82F6" opacity="0.3" />
          <circle cx="11" cy="11" r="2.5" fill="#3B82F6" />
        </svg>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.12em', color: C.text, fontFamily: 'IBM Plex Mono, monospace' }}>
          PAVOIS
        </span>
      </div>

      {/* Nav tabs */}
      <div style={{ display: 'flex', gap: 2 }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: view === key ? 700 : 500,
              fontFamily: 'IBM Plex Sans, sans-serif',
              background: view === key ? C.tabActiveBg : 'transparent',
              color: view === key ? C.tabActive : C.sub,
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Time control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 16 }}>
        <button
          onClick={onToggleRun}
          style={{
            width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`,
            background: 'transparent', color: running ? '#10B981' : '#3B82F6',
            cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {running ? '⏸' : '▶'}
        </button>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: '0.05em' }}>
          T+{mm}:{ss}.{ms}
        </div>
      </div>

      {/* Theme switcher */}
      <div style={{ display: 'flex', gap: 4 }}>
        {THEMES_BTN.map(([t, icon]) => (
          <button
            key={t}
            onClick={() => onThemeChange(t)}
            style={{
              width: 26, height: 26, borderRadius: 5,
              border: `1px solid ${C.border}`,
              background: theme === t ? C.tabActiveBg : 'transparent',
              color: theme === t ? C.tabActive : C.sub,
              cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  )
}
