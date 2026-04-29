import { create } from 'zustand'
import { PAVOISSim, type SimAlert } from '../sim/pavoisSim'

export type Theme = 'light' | 'dark' | 'mono'
export type View  = 'live' | 'deploy' | 'replay'

interface SimStore {
  theme: Theme
  view: View
  currentTime: number
  running: boolean
  selectedCamera: string | null
  selectedTrack: string | null
  showPrediction: boolean
  showCoverage: boolean
  alerts: SimAlert[]

  setTheme: (t: Theme) => void
  setView: (v: View) => void
  tickTime: (delta: number) => void
  toggleRunning: () => void
  setSelectedCamera: (id: string | null) => void
  setSelectedTrack: (id: string | null) => void
  setShowPrediction: (v: boolean) => void
  setShowCoverage: (v: boolean) => void
  ackAlert: (id: string) => void
}

export const useSimStore = create<SimStore>((set) => ({
  theme: 'light',
  view: 'live',
  currentTime: 0,
  running: true,
  selectedCamera: null,
  selectedTrack: null,
  showPrediction: false,
  showCoverage: true,
  alerts: PAVOISSim.ALERTS_INIT.map(a => ({ ...a })),

  setTheme: (theme) => set({ theme }),
  setView: (view) => set({ view }),
  tickTime: (delta) => set((s) => ({
    currentTime: s.currentTime >= 9 ? 0 : +(s.currentTime + delta).toFixed(2),
  })),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setSelectedCamera: (selectedCamera) => set({ selectedCamera }),
  setSelectedTrack: (selectedTrack) => set({ selectedTrack }),
  setShowPrediction: (showPrediction) => set({ showPrediction }),
  setShowCoverage: (showCoverage) => set({ showCoverage }),
  ackAlert: (id) => set((s) => ({
    alerts: s.alerts.map(a => a.id === id ? { ...a, ack: true } : a),
  })),
}))
