// PAVOIS Simulation Engine — TypeScript port of pavois-sim.js

export type CamStatus = 'active' | 'degraded' | 'offline'

export interface SimCamera {
  id: string
  name: string
  x: number
  y: number
  z: number
  azimuth: number
  fov: number
  range: number
  status: CamStatus
  color: string
}

export interface Waypoint { x: number; y: number; z: number; t: number }

export interface SimTrack {
  id: string
  name: string
  color: string
  status: 'confirmed' | 'tentative' | 'lost'
  waypoints: Waypoint[]
}

export interface SimAlert {
  id: string
  type: 'detection' | 'sensor' | 'coverage' | 'system'
  sev: 'critical' | 'high' | 'medium' | 'low'
  msg: string
  sub: string
  time: string
  ack: boolean
}

export interface EventEntry {
  t: number
  type: 'system' | 'detection' | 'track' | 'alert'
  msg: string
}

export interface Pos3 { x: number; y: number; z: number }
export interface Velocity { vx: number; vy: number; vz: number; speed: number }

const GRID = 24

const CAMERAS: SimCamera[] = [
  { id:'CAM-01', name:'Alpha',   x:2,  y:2,  z:6, azimuth:135, fov:65, range:13, status:'active',   color:'#3B82F6' },
  { id:'CAM-02', name:'Bravo',   x:12, y:0,  z:6, azimuth:160, fov:72, range:15, status:'active',   color:'#8B5CF6' },
  { id:'CAM-03', name:'Charlie', x:22, y:2,  z:6, azimuth:210, fov:65, range:13, status:'active',   color:'#EC4899' },
  { id:'CAM-04', name:'Delta',   x:24, y:8,  z:6, azimuth:255, fov:62, range:13, status:'active',   color:'#F59E0B' },
  { id:'CAM-05', name:'Echo',    x:23, y:16, z:5, azimuth:280, fov:60, range:10, status:'degraded', color:'#10B981' },
  { id:'CAM-06', name:'Foxtrot', x:22, y:22, z:6, azimuth:320, fov:65, range:13, status:'active',   color:'#06B6D4' },
  { id:'CAM-07', name:'Golf',    x:12, y:24, z:6, azimuth:355, fov:72, range:15, status:'active',   color:'#F97316' },
  { id:'CAM-08', name:'Hotel',   x:2,  y:22, z:6, azimuth:45,  fov:65, range:13, status:'offline',  color:'#EF4444' },
  { id:'CAM-09', name:'India',   x:0,  y:16, z:6, azimuth:80,  fov:62, range:13, status:'active',   color:'#84CC16' },
  { id:'CAM-10', name:'Juliet',  x:0,  y:8,  z:6, azimuth:98,  fov:62, range:13, status:'active',   color:'#A78BFA' },
]

const TRACKS_DEF: SimTrack[] = [
  {
    // Assault drone: sprint → 180° reversal → hover recon → panic escape
    // ~80 m/s sprints  ↔  ~7 m/s hover  (11:1 ratio)
    id: 'TRK-001', name: 'Contact Alpha', color: '#EF4444', status: 'confirmed',
    waypoints: [
      { x:22, y:3,  z:5, t:0.0 },  // NE entry
      { x:18, y:3,  z:6, t:0.5 },  // W sprint        4 u / 0.5 s → 80 m/s
      { x:14, y:5,  z:7, t:1.0 },  // SW fast
      { x:17, y:8,  z:7, t:1.5 },  // 180° REVERSAL NE
      { x:14, y:11, z:6, t:2.0 },  // SW sharp again
      { x:12, y:12, z:5, t:3.0 },  // slows down      2 u / 1.0 s → 20 m/s
      { x:11, y:12, z:5, t:4.5 },  // HOVER           1 u / 1.5 s → 7 m/s
      { x:11, y:13, z:5, t:6.0 },  // still hovering / recon
      { x:7,  y:10, z:4, t:6.7 },  // ESCAPE sprint   5.1 u / 0.7 s → 73 m/s
      { x:4,  y:7,  z:3, t:7.4 },  // continues fast
      { x:2,  y:5,  z:3, t:8.2 },  // slows
      { x:1,  y:3,  z:2, t:9.0 },  // slow exit
    ],
  },
  {
    // Surveillance drone: fast ingress → slow recon loop → fast egress
    // ~70 m/s transit  ↔  ~15 m/s recon crawl  (5:1 ratio)
    id: 'TRK-002', name: 'Contact Bravo', color: '#F59E0B', status: 'tentative',
    waypoints: [
      { x:2,  y:15, z:4, t:1.0 },  // W entry
      { x:6,  y:11, z:5, t:1.6 },  // NE sprint       5.7 u / 0.6 s → 95 m/s
      { x:11, y:7,  z:6, t:2.3 },  // continues NE    6.4 u / 0.7 s → 91 m/s
      { x:16, y:5,  z:6, t:3.0 },  // E fast
      { x:19, y:9,  z:5, t:3.8 },  // SE turn, moderate
      { x:20, y:14, z:4, t:4.8 },  // S, slows        5.1 u / 1.0 s → 51 m/s
      { x:18, y:17, z:3, t:6.2 },  // SW SLOW recon   3.6 u / 1.4 s → 26 m/s
      { x:16, y:19, z:3, t:7.4 },  // crawling W      2.8 u / 1.2 s → 23 m/s
      { x:12, y:16, z:4, t:8.0 },  // NW — picks up   5 u / 0.6 s → 83 m/s
      { x:8,  y:12, z:5, t:8.6 },  // fast exit NW
      { x:4,  y:9,  z:5, t:9.0 },  // exit
    ],
  },
  {
    // Evasive zigzag: hard direction reversals every 0.6 s, bleeds off at end
    // ~70 m/s zigzag  ↔  ~18 m/s bleed-off  (4:1 ratio + constant heading flips)
    id: 'TRK-003', name: 'Contact Charlie', color: '#8B5CF6', status: 'tentative',
    waypoints: [
      { x:20, y:20, z:3, t:3.0 },  // SE entry, low
      { x:16, y:17, z:5, t:3.6 },  // NW         5 u / 0.6 s → 83 m/s
      { x:19, y:14, z:6, t:4.2 },  // NE REVERSE 4.2 u / 0.6 s → 70 m/s
      { x:15, y:11, z:7, t:4.8 },  // NW REVERSE
      { x:19, y:8,  z:7, t:5.4 },  // NE REVERSE
      { x:15, y:6,  z:6, t:6.0 },  // W
      { x:12, y:9,  z:6, t:6.6 },  // SW
      { x:8,  y:6,  z:7, t:7.2 },  // NW
      { x:5,  y:9,  z:5, t:8.0 },  // SW, slows   4.2 u / 0.8 s → 52 m/s
      { x:3,  y:7,  z:4, t:8.6 },  // bleeds down 2.8 u / 0.6 s → 47 m/s
      { x:2,  y:5,  z:3, t:9.0 },  // slow exit   2.2 u / 0.4 s → 55 m/s... still decelerating
    ],
  },
  {
    // Bird: slow, organic wandering at low altitude — not a threat
    // ~14-18 m/s throughout, gentle curves, no sharp turns
    id: 'TRK-004', name: 'Contact Delta', color: '#34d399', status: 'tentative',
    waypoints: [
      { x:9,  y:19, z:2, t:0.0 },  // starts SW area, low
      { x:11, y:17, z:2, t:1.5 },  // drifts NE       2.8 u / 1.5 s → 19 m/s
      { x:13, y:15, z:1, t:3.0 },  // gentle NE       2.8 u / 1.5 s → 19 m/s
      { x:15, y:16, z:2, t:4.5 },  // turns E         2.2 u / 1.5 s → 15 m/s
      { x:16, y:18, z:2, t:6.0 },  // drifts S        2.2 u / 1.5 s → 15 m/s
      { x:14, y:20, z:1, t:7.5 },  // turns SW        2.8 u / 1.5 s → 19 m/s
      { x:11, y:21, z:2, t:9.0 },  // wanders W       3.2 u / 1.5 s → 21 m/s
    ],
  },
]

const ALERTS_INIT: SimAlert[] = [
  { id:'ALT-001', type:'detection', sev:'high',     msg:'Nouvelle piste confirmée',         sub:'TRK-001 · 3 capteurs',        time:'11:42:08', ack:false },
  { id:'ALT-002', type:'sensor',    sev:'critical', msg:'Capteur hors service',             sub:'CAM-08 Hotel',                time:'11:38:55', ack:false },
  { id:'ALT-003', type:'detection', sev:'medium',   msg:'Détection tentative',              sub:'TRK-002 · 1 capteur',         time:'11:41:30', ack:false },
  { id:'ALT-004', type:'coverage',  sev:'medium',   msg:'Couverture insuffisante',          sub:'Secteur SO — angle mort',     time:'11:35:00', ack:true  },
  { id:'ALT-005', type:'detection', sev:'medium',   msg:'Détection tentative',              sub:'TRK-003 · 2 capteurs',        time:'11:43:10', ack:false },
  { id:'ALT-006', type:'sensor',    sev:'low',      msg:'Capteur dégradé',                  sub:'CAM-05 Echo — signal faible', time:'11:30:12', ack:true  },
  { id:'ALT-007', type:'detection', sev:'low',      msg:'Contact lent — probablement oiseau', sub:'TRK-004 · vitesse ~16 m/s', time:'11:44:02', ack:false },
]

const EVENT_LOG: EventEntry[] = [
  { t:0.0, type:'system',    msg:'Système opérationnel — 9 capteurs actifs' },
  { t:0.3, type:'detection', msg:'TRK-001 : détection — CAM-03, vitesse ~80 m/s' },
  { t:0.5, type:'detection', msg:'TRK-004 : contact lent détecté — CAM-07, ~16 m/s' },
  { t:0.8, type:'alert',     msg:'TRK-001 : approche rapide cap SW' },
  { t:1.2, type:'track',     msg:'TRK-001 : changement de cap 180° — vire NE' },
  { t:1.8, type:'track',     msg:'TRK-001 : confirmation — CAM-02 + CAM-03 (64%)' },
  { t:1.5, type:'detection', msg:'TRK-002 : détection tentative — CAM-10 Juliet' },
  { t:1.9, type:'detection', msg:'TRK-004 : vitesse constante ~16 m/s — probable oiseau' },
  { t:2.5, type:'detection', msg:'TRK-002 : transit rapide NE — 91 m/s' },
  { t:3.2, type:'detection', msg:'TRK-001 : décélération — 20 m/s' },
  { t:3.5, type:'alert',     msg:'TRK-003 : contact haute vitesse — CAM-06, 83 m/s' },
  { t:4.2, type:'alert',     msg:'TRK-003 : trajectoire erratique — cap NE brutal' },
  { t:4.5, type:'track',     msg:'TRK-001 : hover détecté — recon zone 11/12' },
  { t:4.8, type:'detection', msg:'TRK-002 : phase recon — 26 m/s cap SW' },
  { t:5.4, type:'alert',     msg:'TRK-003 : zigzag NE/NW — comportement évasif' },
  { t:6.7, type:'track',     msg:'TRK-001 : fuite — 73 m/s cap SW' },
  { t:7.0, type:'alert',     msg:'CAM-08 Hotel : perte de signal' },
  { t:8.0, type:'detection', msg:'TRK-002 : fuite NW — 83 m/s' },
  { t:8.5, type:'track',     msg:'TRK-003 : décélération — 47 m/s, sortie imminente' },
  { t:9.0, type:'system',    msg:'TRK-001 : sortie périmètre — suivi perdu' },
]

function lerpPos(waypoints: Waypoint[], time: number): Pos3 | null {
  if (!waypoints || waypoints.length === 0) return null
  if (time <= waypoints[0].t) return { ...waypoints[0] }
  if (time >= waypoints[waypoints.length - 1].t) return { ...waypoints[waypoints.length - 1] }
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (time >= waypoints[i].t && time <= waypoints[i + 1].t) {
      const t = (time - waypoints[i].t) / (waypoints[i + 1].t - waypoints[i].t)
      return {
        x: waypoints[i].x + t * (waypoints[i + 1].x - waypoints[i].x),
        y: waypoints[i].y + t * (waypoints[i + 1].y - waypoints[i].y),
        z: waypoints[i].z + t * (waypoints[i + 1].z - waypoints[i].z),
      }
    }
  }
  return null
}

function getTrailPoints(track: SimTrack, time: number, count = 8): (Pos3 & { age: number })[] {
  const pts: (Pos3 & { age: number })[] = []
  const step = 0.4
  for (let i = count; i >= 0; i--) {
    const t = time - i * step
    if (t < track.waypoints[0].t) continue
    const p = lerpPos(track.waypoints, t)
    if (p) pts.push({ ...p, age: i })
  }
  return pts
}

function getVelocity(track: SimTrack, time: number, dt = 0.2): Velocity {
  const p1 = lerpPos(track.waypoints, time)
  const p2 = lerpPos(track.waypoints, Math.min(time + dt, track.waypoints[track.waypoints.length - 1].t))
  if (!p1 || !p2) return { vx: 0, vy: 0, vz: 0, speed: 0 }
  const vx = (p2.x - p1.x) / dt
  const vy = (p2.y - p1.y) / dt
  const vz = (p2.z - p1.z) / dt
  return { vx, vy, vz, speed: Math.sqrt(vx * vx + vy * vy) * 10 }
}

function getPrediction(track: SimTrack, time: number, horizon = 2.5, steps = 8): Pos3[] {
  const pts: Pos3[] = []
  const p0 = lerpPos(track.waypoints, time)
  if (!p0) return pts
  const vel = getVelocity(track, time)
  for (let i = 1; i <= steps; i++) {
    const dt = (i / steps) * horizon
    pts.push({ x: p0.x + vel.vx * dt, y: p0.y + vel.vy * dt, z: p0.z + vel.vz * dt })
  }
  return pts
}

function getDetectingCameras(pos: Pos3 | null): SimCamera[] {
  if (!pos) return []
  return CAMERAS.filter(cam => {
    if (cam.status === 'offline') return false
    const dx = pos.x - cam.x, dy = pos.y - cam.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > cam.range) return false
    const angleToTarget = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360
    let diff = ((cam.azimuth - angleToTarget) % 360 + 360) % 360
    if (diff > 180) diff = 360 - diff
    return diff <= cam.fov / 2
  })
}

function getConfidence(cams: SimCamera[]): number {
  const n = cams.filter(c => c.status === 'active').length
  if (n === 0) return 0
  if (n === 1) return 0.32
  if (n === 2) return 0.64
  return Math.min(0.96, 0.64 + (n - 2) * 0.12)
}

function getCoveragePolygon(cam: SimCamera): { x: number; y: number }[] {
  const r = cam.range
  const azRad = cam.azimuth * Math.PI / 180
  const halfFov = (cam.fov / 2) * Math.PI / 180
  const pts: { x: number; y: number }[] = [{ x: cam.x, y: cam.y }]
  const segs = 14
  for (let i = 0; i <= segs; i++) {
    const a = azRad - halfFov + (i / segs) * cam.fov * Math.PI / 180
    pts.push({ x: cam.x + r * Math.sin(a), y: cam.y - r * Math.cos(a) })
  }
  return pts
}

export const PAVOISSim = {
  GRID,
  CAMERAS,
  TRACKS_DEF,
  ALERTS_INIT,
  EVENT_LOG,
  lerpPos,
  getTrailPoints,
  getVelocity,
  getPrediction,
  getDetectingCameras,
  getConfidence,
  getCoveragePolygon,
}
