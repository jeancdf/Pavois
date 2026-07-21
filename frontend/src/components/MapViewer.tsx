import { useEffect, useRef, useState } from 'react'
import {
  Viewer,
  Terrain,
  Ion,
  Cartesian3,
  Cartesian2,
  Math as CesiumMath,
  Ellipsoid,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Color,
  Entity,
  CallbackProperty,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useMapStore } from '../store/mapStore'
import { useCameraStore } from '../store/cameraStore'
import { useSimStore } from '../store/simStore'
import { PAVOISSim } from '../sim/pavoisSim'

// ── Grid → geographic projection ──────────────────────────────────────────────
// PAVOISSim uses a 24×24 grid. We map it centred on downtown Los Angeles.
// x increases East, y increases South (compass convention used by the sim).

const GRID_CENTER_LAT =  34.0522
const GRID_CENTER_LNG = -118.2437
const METERS_PER_UNIT =  120   // 1 grid unit = 120 m  → full grid ≈ 2.9 km²
const GRID_CENTER     =  12    // grid is 0–24, centre at 12
const ALT_SCALE       =  12    // sim z unit → metres  (z=6 → 72 m)

const M_PER_DEG_LAT = 111320
const M_PER_DEG_LNG = 111320 * Math.cos(CesiumMath.toRadians(GRID_CENTER_LAT))

function gridToCart3(gx: number, gy: number, altM: number): Cartesian3 {
  const lat = GRID_CENTER_LAT + (GRID_CENTER - gy) * METERS_PER_UNIT / M_PER_DEG_LAT
  const lng = GRID_CENTER_LNG + (gx - GRID_CENTER) * METERS_PER_UNIT / M_PER_DEG_LNG
  return Cartesian3.fromDegrees(lng, lat, altM)
}

// ── FOV frustum math (user-added cameras) ─────────────────────────────────────

const DETECTION_RANGE_M = 500

type CamLike = {
  lat: number; lng: number; altitudeM: number
  yawDeg: number; pitchDeg: number; hFovDeg: number
}

function computeFrustumCorners(cam: CamLike): Cartesian3[] {
  const yaw   = CesiumMath.toRadians(cam.yawDeg)
  const pitch = CesiumMath.toRadians(cam.pitchDeg)
  const hHalf = CesiumMath.toRadians(cam.hFovDeg / 2)
  const vHalf = CesiumMath.toRadians((cam.hFovDeg * 9) / 16 / 2)

  const fE =  Math.sin(yaw) * Math.cos(pitch)
  const fN =  Math.cos(yaw) * Math.cos(pitch)
  const fU =  Math.sin(pitch)
  const rE =  Math.cos(yaw)
  const rN = -Math.sin(yaw)
  const uE =  rN * fU
  const uN = -rE * fU
  const uU =  rE * fN - rN * fE

  const tanH = Math.tan(hHalf)
  const tanV = Math.tan(vHalf)

  const latRad    = CesiumMath.toRadians(cam.lat)
  const mPerDegLat2 = 111320
  const mPerDegLng2 = 111320 * Math.cos(latRad)

  const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  return signs.map(([hs, vs]) => {
    const dE = fE + hs * tanH * rE + vs * tanV * uE
    const dN = fN + hs * tanH * rN + vs * tanV * uN
    const dU = fU +                  vs * tanV * uU
    const len = Math.sqrt(dE * dE + dN * dN + dU * dU)
    const s   = DETECTION_RANGE_M / len
    return Cartesian3.fromDegrees(
      cam.lng + (dE * s) / mPerDegLng2,
      cam.lat + (dN * s) / mPerDegLat2,
      cam.altitudeM + dU * s,
    )
  })
}

// ── Entity stores for sim overlay ─────────────────────────────────────────────

interface DroneEntityGroup {
  marker:     Entity
  trail:      Entity
  velocity:   Entity
  prediction: Entity
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Viewer | null>(null)
  const setViewer    = useMapStore((s) => s.setViewer)
  const getPendingClick = () => useMapStore.getState().pendingClick
  const cameras = useCameraStore((s) => s.cameras)
  const entityMapRef = useRef<Map<string, Entity[]>>(new Map())
  const [is3D, setIs3D] = useState(true)

  // Sim overlay refs
  const simCamEntitiesRef = useRef<Entity[]>([])
  const droneEntitiesRef  = useRef<Map<string, DroneEntityGroup>>(new Map())
  const simTimeRef        = useRef(0)
  const showCoverageRef   = useRef(true)
  const showPredRef       = useRef(false)

  // Subscribe to sim store
  const currentTime    = useSimStore((s) => s.currentTime)
  const showCoverage   = useSimStore((s) => s.showCoverage)
  const showPrediction = useSimStore((s) => s.showPrediction)

  // Live WebSocket tracks refs & subscription
  const liveEntitiesRef = useRef<Map<string, DroneEntityGroup>>(new Map())
  const liveTracks = useSimStore((s) => s.liveTracks)

  // Keep refs in sync
  useEffect(() => { simTimeRef.current = currentTime }, [currentTime])
  useEffect(() => {
    showCoverageRef.current = showCoverage
    simCamEntitiesRef.current.forEach(e => { e.show = showCoverage })
  }, [showCoverage])
  useEffect(() => {
    showPredRef.current = showPrediction
    droneEntitiesRef.current.forEach(g => { g.prediction.show = showPrediction })
  }, [showPrediction])

  // ── Render live WebSocket tracks ──────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    const liveEntities = liveEntitiesRef.current
    const currentLiveIds = new Set(Object.keys(liveTracks))

    // 1. Supprimer les pistes perdues/effacées du store
    for (const [id, group] of liveEntities.entries()) {
      if (!currentLiveIds.has(id)) {
        viewer.entities.remove(group.marker)
        viewer.entities.remove(group.trail)
        viewer.entities.remove(group.velocity)
        viewer.entities.remove(group.prediction)
        liveEntities.delete(id)
      }
    }

    // 2. Ajouter ou mettre à jour les pistes actives
    for (const [id, track] of Object.entries(liveTracks)) {
      if (track.positions.length === 0) continue

      const lastPos = track.positions[track.positions.length - 1]
      const lastCartesian = Cartesian3.fromDegrees(lastPos.lng, lastPos.lat, lastPos.alt)

      const droneColor = Color.fromCssColorString(track.status === 'lost' ? '#64748B' : track.color)
      const trailColor = droneColor.withAlpha(0.6)

      let group = liveEntities.get(id)

      if (!group) {
        // Créer les entités Cesium
        const marker = viewer.entities.add({
          position: lastCartesian,
          point: {
            pixelSize: 14,
            color: droneColor,
            outlineColor: Color.WHITE,
            outlineWidth: 2.5,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${track.classification === 'drone' ? '🛸 ' : track.classification === 'airplane' ? '✈️ ' : track.classification === 'bird' ? '🐦 ' : '❓ '}${track.name}`,
            font: '700 11px IBM Plex Mono, monospace',
            fillColor: droneColor,
            outlineColor: Color.fromCssColorString('#0d1117'),
            outlineWidth: 2,
            style: 2,
            pixelOffset: new Cartesian2(18, 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })

        const trail = viewer.entities.add({
          polyline: {
            positions: track.positions.map(p => Cartesian3.fromDegrees(p.lng, p.lat, p.alt)),
            width: 3.0,
            material: trailColor,
            clampToGround: false,
          },
        })

        // Entités vides pour compatibilité
        const velocity = viewer.entities.add({ polyline: { positions: [], show: false } })
        const prediction = viewer.entities.add({ polyline: { positions: [], show: false } })

        group = { marker, trail, velocity, prediction }
        liveEntities.set(id, group)
      } else {
        // Mettre à jour les entités existantes
        group.marker.position = lastCartesian as any
        if (group.marker.point) {
          group.marker.point.color = droneColor as any
        }
        if (group.marker.label) {
          const emoji = track.classification === 'drone' ? '🛸 ' : track.classification === 'airplane' ? '✈️ ' : track.classification === 'bird' ? '🐦 ' : '❓ '
          group.marker.label.text = (track.status === 'lost' ? `[PERDU] ${emoji}${track.name}` : `${emoji}${track.name}`) as any
          group.marker.label.fillColor = droneColor as any
        }
        if (group.trail.polyline) {
          group.trail.polyline.positions = track.positions.map(p => Cartesian3.fromDegrees(p.lng, p.lat, p.alt)) as any
          group.trail.polyline.material = trailColor as any
        }
      }
    }
  }, [liveTracks])

  // ── Init Cesium viewer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    const viewer = new Viewer(containerRef.current, {
      terrain:               Ion.defaultAccessToken ? Terrain.fromWorldTerrain() : undefined,
      timeline:              false,
      animation:             false,
      baseLayerPicker:       false,
      geocoder:              false,
      homeButton:            false,
      sceneModePicker:       false,
      navigationHelpButton:  false,
      fullscreenButton:      false,
      infoBox:               false,
      selectionIndicator:    false,
    })

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(GRID_CENTER_LNG, GRID_CENTER_LAT, 4500),
      orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-40), roll: 0 },
    })

    // ── Map click handler ───────────────────────────────────────────────────────
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((e: { position: { x: number; y: number } }) => {
      const cb = getPendingClick()
      if (!cb) return
      const cartesian = viewer.camera.pickEllipsoid(e.position as Cartesian2, Ellipsoid.WGS84)
      if (!cartesian) return
      const carto = Ellipsoid.WGS84.cartesianToCartographic(cartesian)
      cb(CesiumMath.toDegrees(carto.latitude), CesiumMath.toDegrees(carto.longitude))
      useMapStore.getState().setPendingClick(null)
    }, ScreenSpaceEventType.LEFT_CLICK)

    viewerRef.current = viewer
    setViewer(viewer)

    // ── Sim cameras ─────────────────────────────────────────────────────────────
    const camEntities: Entity[] = []
    for (const cam of PAVOISSim.CAMERAS) {
      if (cam.status === 'offline') continue

      const camColor  = Color.fromCssColorString(cam.color)
      const fillColor = camColor.withAlpha(cam.status === 'degraded' ? 0.12 : 0.22)
      const lineColor = camColor.withAlpha(cam.status === 'degraded' ? 0.45 : 0.7)

      const apexPos   = gridToCart3(cam.x, cam.y, cam.z * ALT_SCALE)
      const coveragePts = PAVOISSim.getCoveragePolygon(cam)

      // Ground coverage sector
      const sectorGround = coveragePts.map(p => gridToCart3(p.x, p.y, 1))
      const sector = viewer.entities.add({
        polygon: {
          hierarchy:         sectorGround,
          material:          fillColor,
          outline:           true,
          outlineColor:      lineColor,
          outlineWidth:      1.5,
          perPositionHeight: true,
        },
      })

      // Left + right boundary lines (apex → sector edge)
      const leftPt  = gridToCart3(coveragePts[1].x,                    coveragePts[1].y,                    1)
      const rightPt = gridToCart3(coveragePts[coveragePts.length - 1].x, coveragePts[coveragePts.length - 1].y, 1)

      const leftLine = viewer.entities.add({
        polyline: {
          positions:  [apexPos, leftPt],
          width:      1.5,
          material:   lineColor,
          clampToGround: false,
        },
      })
      const rightLine = viewer.entities.add({
        polyline: {
          positions:  [apexPos, rightPt],
          width:      1.5,
          material:   lineColor,
          clampToGround: false,
        },
      })

      // Apex marker + label
      const apex = viewer.entities.add({
        position: apexPos,
        point: {
          pixelSize:    10,
          color:        camColor,
          outlineColor: Color.fromCssColorString('#0d1117'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:        cam.id,
          font:        '11px IBM Plex Mono, monospace',
          fillColor:   Color.WHITE,
          outlineColor: Color.fromCssColorString('#0d1117'),
          outlineWidth: 2,
          style:        2,
          pixelOffset:  new Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })

      // Vertical pole (apex → ground)
      const camGround = gridToCart3(cam.x, cam.y, 1)
      const pole = viewer.entities.add({
        polyline: {
          positions:  [apexPos, camGround],
          width:      1,
          material:   lineColor,
          clampToGround: false,
        },
      })

      camEntities.push(sector, leftLine, rightLine, apex, pole)
    }
    simCamEntitiesRef.current = camEntities

    // ── Drone tracks ─────────────────────────────────────────────────────────────
    for (const track of PAVOISSim.TRACKS_DEF) {
      const droneColor  = Color.fromCssColorString(track.color)
      const trailColor  = droneColor.withAlpha(0.75)
      const velColor    = droneColor.withAlpha(0.9)
      const predColor   = droneColor.withAlpha(0.5)

      // ── Marker (pulsing point) ──────────────────────────────────────────────
      const markerPos = new CallbackProperty(() => {
        const pos = PAVOISSim.lerpPos(track.waypoints, simTimeRef.current)
        if (!pos) return Cartesian3.fromDegrees(0, 0, 0)
        return gridToCart3(pos.x, pos.y, pos.z * ALT_SCALE)
      }, false)

      const marker = viewer.entities.add({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        position: markerPos as any,
        point: {
          pixelSize:    12,
          color:        droneColor,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:        track.id.replace('TRK-', '#'),
          font:        '700 11px IBM Plex Mono, monospace',
          fillColor:   droneColor,
          outlineColor: Color.fromCssColorString('#0d1117'),
          outlineWidth: 2,
          style:        2,
          pixelOffset:  new Cartesian2(16, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })

      // ── Trail polyline ──────────────────────────────────────────────────────
      const trailPositions = new CallbackProperty(() => {
        const pts = PAVOISSim.getTrailPoints(track, simTimeRef.current, 12)
        if (pts.length < 2) return []
        return pts.map(p => gridToCart3(p.x, p.y, p.z * ALT_SCALE))
      }, false)

      const trail = viewer.entities.add({
        polyline: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          positions:  trailPositions as any,
          width:      2.5,
          material:   trailColor,
          clampToGround: false,
        },
      })

      // ── Velocity vector ─────────────────────────────────────────────────────
      const velPositions = new CallbackProperty(() => {
        const pos = PAVOISSim.lerpPos(track.waypoints, simTimeRef.current)
        if (!pos) return []
        const vel = PAVOISSim.getVelocity(track, simTimeRef.current)
        const scale = 0.6   // visual scale of velocity arrow (in grid units·s)
        const start = gridToCart3(pos.x, pos.y, pos.z * ALT_SCALE)
        const end   = gridToCart3(
          pos.x + vel.vx * scale,
          pos.y + vel.vy * scale,
          (pos.z + vel.vz * scale) * ALT_SCALE,
        )
        return [start, end]
      }, false)

      const velocity = viewer.entities.add({
        polyline: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          positions:  velPositions as any,
          width:      3,
          material:   velColor,
          clampToGround: false,
        },
      })

      // ── Prediction path ─────────────────────────────────────────────────────
      const predPositions = new CallbackProperty(() => {
        if (!showPredRef.current) return []
        const cur  = PAVOISSim.lerpPos(track.waypoints, simTimeRef.current)
        const pred = PAVOISSim.getPrediction(track, simTimeRef.current)
        if (!cur || pred.length === 0) return []
        return [
          gridToCart3(cur.x, cur.y, cur.z * ALT_SCALE),
          ...pred.map(p => gridToCart3(p.x, p.y, p.z * ALT_SCALE)),
        ]
      }, false)

      const prediction = viewer.entities.add({
        show: false,
        polyline: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          positions:  predPositions as any,
          width:      1.5,
          material:   predColor,
          clampToGround: false,
        },
      })

      droneEntitiesRef.current.set(track.id, { marker, trail, velocity, prediction })
    }

    return () => {
      handler.destroy()
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync user-added cameras → Cesium entities ─────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    const entityMap = entityMapRef.current
    const currentIds = new Set(cameras.map((c) => c.id))

    for (const [id, entities] of entityMap) {
      if (!currentIds.has(id)) {
        entities.forEach((e) => viewer.entities.remove(e))
        entityMap.delete(id)
      }
    }

    for (const cam of cameras) {
      if (entityMap.has(cam.id)) continue

      const apexPos = Cartesian3.fromDegrees(cam.lng, cam.lat, cam.altitudeM)
      const corners = computeFrustumCorners(cam)
      const blue     = Color.fromCssColorString('#58a6ff')
      const blueEdge = Color.fromCssColorString('#58a6ff').withAlpha(0.7)
      const sideMat  = Color.fromCssColorString('#58a6ff').withAlpha(0.18)
      const farMat   = Color.fromCssColorString('#58a6ff').withAlpha(0.25)

      const pointEntity = viewer.entities.add({
        position: apexPos,
        point: {
          pixelSize:    10,
          color:        blue,
          outlineColor: Color.fromCssColorString('#0d1117'),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text:        cam.name,
          font:        '11px monospace',
          fillColor:   Color.fromCssColorString('#e6edf3'),
          outlineColor: Color.fromCssColorString('#0d1117'),
          outlineWidth: 2,
          style:       2,
          pixelOffset: new Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })

      const farFace = viewer.entities.add({
        polygon: {
          hierarchy:         corners,
          material:          farMat,
          outline:           true,
          outlineColor:      blueEdge,
          perPositionHeight: true,
        },
      })

      const sidePairs: [number, number][] = [[0,1],[1,2],[2,3],[3,0]]
      const sideEntities = sidePairs.flatMap(([a, b]) => [
        viewer.entities.add({
          polygon: { hierarchy: [apexPos, corners[a], corners[b]], material: sideMat, outline: false, perPositionHeight: true },
        }),
        viewer.entities.add({
          polygon: { hierarchy: [apexPos, corners[b], corners[a]], material: sideMat, outline: false, perPositionHeight: true },
        }),
      ])

      const farLoop = viewer.entities.add({
        polyline: { positions: [...corners, corners[0]], width: 1.5, material: blueEdge, clampToGround: false },
      })
      const apexLines = corners.map((corner) =>
        viewer.entities.add({
          polyline: { positions: [apexPos, corner], width: 1.5, material: blueEdge, clampToGround: false },
        }),
      )

      entityMap.set(cam.id, [pointEntity, farFace, farLoop, ...sideEntities, ...apexLines])
    }
  }, [cameras])

  // ── Map control helpers ───────────────────────────────────────────────────
  const btnCls =
    'w-8 h-8 flex items-center justify-center font-mono text-[13px] ' +
    'bg-[#161b22]/90 border border-[#30363d] text-[#8b949e] ' +
    'hover:text-[#e6edf3] hover:border-[#58a6ff] transition-colors select-none'

  const handleZoomIn  = () => viewerRef.current?.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.4)
  const handleZoomOut = () => viewerRef.current?.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.6)
  const handleHome    = () => viewerRef.current?.camera.setView({
    destination: Cartesian3.fromDegrees(GRID_CENTER_LNG, GRID_CENTER_LAT, 4500),
    orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-40), roll: 0 },
  })
  const handleToggle3D = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (is3D) { viewer.scene.morphTo2D(1); setIs3D(false) }
    else       { viewer.scene.morphTo3D(1); setIs3D(true)  }
  }

  return (
    <div className="relative w-full h-full" style={{ background: '#090e15' }}>
      <div ref={containerRef} className="w-full h-full" />

      <div className="absolute bottom-6 right-4 flex flex-col gap-1 z-10">
        <button className={btnCls} onClick={handleZoomIn}  title="Zoom in">+</button>
        <button className={btnCls} onClick={handleZoomOut} title="Zoom out">−</button>
        <div className="h-px bg-[#21262d] my-0.5" />
        <button className={btnCls} onClick={handleHome}   title="Reset view">⌂</button>
        <button
          className={`${btnCls} ${!is3D ? 'text-[#58a6ff] border-[#58a6ff]' : ''}`}
          onClick={handleToggle3D}
          title={is3D ? 'Switch to 2D' : 'Switch to 3D'}
        >
          {is3D ? '3D' : '2D'}
        </button>
      </div>
    </div>
  )
}
