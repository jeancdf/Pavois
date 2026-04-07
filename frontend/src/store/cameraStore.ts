import { create } from 'zustand'

export interface Camera {
  id: string
  name: string
  lat: number
  lng: number
  altitudeM: number
  yawDeg: number
  pitchDeg: number
  hFovDeg: number
}

interface CameraStore {
  cameras: Camera[]
  addCamera: (cam: Omit<Camera, 'id'>) => void
  removeCamera: (id: string) => void
}

export const useCameraStore = create<CameraStore>((set) => ({
  cameras: [],

  addCamera: (cam) =>
    set((state) => ({
      cameras: [
        ...state.cameras,
        { ...cam, id: crypto.randomUUID() },
      ],
    })),

  removeCamera: (id) =>
    set((state) => ({
      cameras: state.cameras.filter((c) => c.id !== id),
    })),
}))
