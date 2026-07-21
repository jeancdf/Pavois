import { create } from 'zustand'
import { PAVOISSim, type SimAlert, type ObjectClassification } from '../sim/pavoisSim'

export type Theme = 'light' | 'dark' | 'mono'
export type View  = 'live' | 'deploy' | 'replay'

export interface LiveTrack {
  id: string
  name: string
  color: string
  status: 'confirmed' | 'lost'
  positions: { lat: number; lng: number; alt: number; timestamp: number }[]
  lastUpdate: number
  classification: ObjectClassification
  smoothedSpeed?: number
  smoothedAcceleration?: number
  lastHeading?: number
}

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
  liveTracks: Record<string, LiveTrack>

  setTheme: (t: Theme) => void
  setView: (v: View) => void
  tickTime: (delta: number) => void
  toggleRunning: () => void
  setSelectedCamera: (id: string | null) => void
  setSelectedTrack: (id: string | null) => void
  setShowPrediction: (v: boolean) => void
  setShowCoverage: (v: boolean) => void
  ackAlert: (id: string) => void
  addLiveTrackUpdate: (update: { trackId: string; lat: number; lng: number; alt: number; timestamp: number; classification?: ObjectClassification }) => void
  clearOfflineLiveTracks: () => void
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
  liveTracks: {},

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
  addLiveTrackUpdate: (update) => set((s) => {
    const existing = s.liveTracks[update.trackId];
    const newPos = { lat: update.lat, lng: update.lng, alt: update.alt, timestamp: update.timestamp };
    
    const positions = existing 
      ? [...existing.positions, newPos].slice(-50)
      : [newPos];
      
    const colors = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899'];
    const color = existing?.color || colors[Object.keys(s.liveTracks).length % colors.length];

    let classification: ObjectClassification = update.classification || 'drone';
    let smoothedSpeed = existing?.smoothedSpeed;
    let smoothedAcceleration = existing?.smoothedAcceleration;
    let lastHeading = existing?.lastHeading;

    if (!update.classification && existing && existing.positions.length > 0) {
      const lastPos = existing.positions[existing.positions.length - 1];
      const lat1Rad = lastPos.lat * Math.PI / 180;
      const dy = (update.lat - lastPos.lat) * 111320;
      const dx = (update.lng - lastPos.lng) * 111320 * Math.cos(lat1Rad);
      const dz = update.alt - lastPos.alt;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let dt = Math.abs(update.timestamp - lastPos.timestamp);
      
      if (dt > 10000000) dt = dt / 1000000;
      else if (dt > 10000) dt = dt / 1000;

      if (dt > 0.001) {
        const rawSpeed = dist / dt; // m/s
        
        // 1. Filtrage Passe-Bas (Alpha-Beta filter)
        const alpha = 0.25;
        const beta = 0.20;
        
        smoothedSpeed = smoothedSpeed !== undefined ? (1 - alpha) * smoothedSpeed + alpha * rawSpeed : rawSpeed;
        
        const rawAcc = Math.abs(smoothedSpeed - (existing.smoothedSpeed || 0)) / dt;
        smoothedAcceleration = smoothedAcceleration !== undefined ? (1 - beta) * smoothedAcceleration + beta * rawAcc : rawAcc;
        
        // Cap & manoeuvrabilité
        const heading = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        let headingChangeRate = 0;
        if (lastHeading !== undefined) {
          let diff = Math.abs(heading - lastHeading);
          if (diff > 180) diff = 360 - diff;
          headingChangeRate = diff / dt; // deg/s
        }
        lastHeading = heading;

        // 2. Scorecard Multi-Critères
        let scoreAirplane = 0;
        let scoreBird = 0;
        let scoreDrone = 0;

        // Vitesse
        if (smoothedSpeed > 85) scoreAirplane += 3;
        if (smoothedSpeed > 45 && smoothedSpeed <= 85) scoreDrone += 2;
        if (smoothedSpeed > 15 && smoothedSpeed <= 45) {
          scoreDrone += 1;
          scoreBird += 1;
        }
        if (smoothedSpeed <= 15) scoreBird += 3;

        // Accélération (Inertie)
        if (smoothedAcceleration > 15) {
          scoreDrone += 3;
          scoreBird += 1;
          scoreAirplane -= 3;
        } else if (smoothedAcceleration < 5) {
          scoreAirplane += 2;
        }

        // Altitude
        if (update.alt > 120) {
          scoreAirplane += 2;
          scoreBird -= 3;
        } else if (update.alt < 60) {
          scoreBird += 2;
          scoreAirplane -= 2;
        }

        // Changement de cap
        if (headingChangeRate > 90) {
          scoreDrone += 3;
          scoreBird += 2;
          scoreAirplane -= 4;
        }

        // Stationnaire
        if (smoothedSpeed < 3) {
          scoreDrone += 2;
          scoreBird += 1;
        }

        // Decision finale
        if (scoreAirplane > scoreBird && scoreAirplane > scoreDrone) {
          classification = 'airplane';
        } else if (scoreBird > scoreAirplane && scoreBird > scoreDrone) {
          classification = 'bird';
        } else {
          classification = 'drone';
        }
      } else {
        classification = existing.classification;
      }
    } else if (!update.classification && existing) {
      classification = existing.classification;
    }

    return {
      liveTracks: {
        ...s.liveTracks,
        [update.trackId]: {
          id: update.trackId,
          name: existing?.name || `Cible Live ${update.trackId}`,
          color,
          status: 'confirmed',
          positions,
          lastUpdate: Date.now(),
          classification,
          smoothedSpeed,
          smoothedAcceleration,
          lastHeading
        }
      }
    };
  }),
  clearOfflineLiveTracks: () => set((s) => {
    const now = Date.now();
    const updated = { ...s.liveTracks };
    let changed = false;
    
    for (const [id, track] of Object.entries(updated)) {
      // Si aucune update depuis 10 secondes, marquer comme perdu
      if (now - track.lastUpdate > 10000 && track.status !== 'lost') {
        updated[id] = { ...track, status: 'lost' };
        changed = true;
      }
      // Si aucune update depuis 30 secondes, supprimer complètement la piste
      if (now - track.lastUpdate > 30000) {
        delete updated[id];
        changed = true;
      }
    }
    
    return changed ? { liveTracks: updated } : {};
  })
}))
