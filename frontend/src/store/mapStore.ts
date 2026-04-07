import { create } from 'zustand'
import type { Viewer } from 'cesium'

interface MapStore {
  viewer: Viewer | null
  /** Set to a callback when a component needs one map click, null otherwise */
  pendingClick: ((lat: number, lng: number) => void) | null
  setViewer: (v: Viewer) => void
  setPendingClick: (cb: ((lat: number, lng: number) => void) | null) => void
}

export const useMapStore = create<MapStore>((set) => ({
  viewer: null,
  pendingClick: null,
  setViewer: (v) => set({ viewer: v }),
  setPendingClick: (cb) => set({ pendingClick: cb }),
}))
