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
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { useMapStore } from '../store/mapStore'
import { useCameraStore } from '../store/cameraStore'

// ── FOV frustum math ──────────────────────────────────────────────────────────
// Projects the 4 far-plane corners of the camera frustum at a fixed detection
// range. Works for any pitch (upward sky-watching or downward ground cameras).

const DETECTION_RANGE_M = 500 // metres to the far face of the frustum

type CamLike = {
  lat: number; lng: number; altitudeM: number
  yawDeg: number; pitchDeg: number; hFovDeg: number
}

function computeFrustumCorners(cam: CamLike): Cartesian3[] {
  const yaw   = CesiumMath.toRadians(cam.yawDeg)
  const pitch = CesiumMath.toRadians(cam.pitchDeg)
  const hHalf = CesiumMath.toRadians(cam.hFovDeg / 2)
  const vHalf = CesiumMath.toRadians((cam.hFovDeg * 9) / 16 / 2)

  // Forward vector in ENU (East-North-Up)
  const fE =  Math.sin(yaw) * Math.cos(pitch)
  const fN =  Math.cos(yaw) * Math.cos(pitch)
  const fU =  Math.sin(pitch)

  // Right vector (perpendicular to forward, in the horizontal plane)
  const rE =  Math.cos(yaw)
  const rN = -Math.sin(yaw)

  // Camera-up = cross(right, forward)
  const uE =  rN * fU
  const uN = -rE * fU
  const uU =  rE * fN - rN * fE

  const tanH = Math.tan(hHalf)
  const tanV = Math.tan(vHalf)

  const latRad    = CesiumMath.toRadians(cam.lat)
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos(latRad)

  // [left-bot, right-bot, right-top, left-top]
  const signs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

  return signs.map(([hs, vs]) => {
    const dE = fE + hs * tanH * rE + vs * tanV * uE
    const dN = fN + hs * tanH * rN + vs * tanV * uN
    const dU = fU +                  vs * tanV * uU

    // Normalize then scale to detection range
    const len = Math.sqrt(dE * dE + dN * dN + dU * dU)
    const s   = DETECTION_RANGE_M / len

    return Cartesian3.fromDegrees(
      cam.lng + (dE * s) / mPerDegLng,
      cam.lat + (dN * s) / mPerDegLat,
      cam.altitudeM + dU * s,   // altitude relative to camera mount
    )
  })
}

// ── component ────────────────────────────────────────────────────────────────

export default function MapViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Viewer | null>(null)
  const setViewer    = useMapStore((s) => s.setViewer)
  const getPendingClick = () => useMapStore.getState().pendingClick
  const cameras = useCameraStore((s) => s.cameras)
  const entityMapRef = useRef<Map<string, Entity[]>>(new Map())
  const [is3D, setIs3D] = useState(true)

  // ── init Cesium viewer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    const viewer = new Viewer(containerRef.current, {
      terrain: Ion.defaultAccessToken ? Terrain.fromWorldTerrain() : undefined,
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
      destination: Cartesian3.fromDegrees(-118.2437, 34.0522, 2000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch:   CesiumMath.toRadians(-35),
        roll:    0,
      },
    })

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((e: { position: { x: number; y: number } }) => {
      const cb = getPendingClick()
      if (!cb) return
      const cartesian = viewer.camera.pickEllipsoid(
        e.position as Cartesian2,
        Ellipsoid.WGS84,
      )
      if (!cartesian) return
      const carto = Ellipsoid.WGS84.cartesianToCartographic(cartesian)
      cb(CesiumMath.toDegrees(carto.latitude), CesiumMath.toDegrees(carto.longitude))
      useMapStore.getState().setPendingClick(null)
    }, ScreenSpaceEventType.LEFT_CLICK)

    viewerRef.current = viewer
    setViewer(viewer)

    return () => {
      handler.destroy()
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── sync cameras → Cesium entities ─────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.isDestroyed()) return

    const entityMap = entityMapRef.current
    const currentIds = new Set(cameras.map((c) => c.id))

    // Remove stale entities
    for (const [id, entities] of entityMap) {
      if (!currentIds.has(id)) {
        entities.forEach((e) => viewer.entities.remove(e))
        entityMap.delete(id)
      }
    }

    // Add entities for new cameras
    for (const cam of cameras) {
      if (entityMap.has(cam.id)) continue

      const apexPos = Cartesian3.fromDegrees(cam.lng, cam.lat, cam.altitudeM)
      const corners = computeFrustumCorners(cam)   // 4 far-plane corners
      const blue     = Color.fromCssColorString('#58a6ff')
      const blueEdge = Color.fromCssColorString('#58a6ff').withAlpha(0.7)
      const sideMat  = Color.fromCssColorString('#58a6ff').withAlpha(0.18)
      const farMat   = Color.fromCssColorString('#58a6ff').withAlpha(0.25)

      // 1 — apex marker + label
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
          style:       2, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })

      // 2 — far-face rectangle (the "mouth" of the frustum at detection range)
      const farFace = viewer.entities.add({
        polygon: {
          hierarchy:         corners,
          material:          farMat,
          outline:           true,
          outlineColor:      blueEdge,
          perPositionHeight: true,
        },
      })

      // 3 — four side faces (front + back so visible from any angle)
      //     corners order: [0]=left-bot [1]=right-bot [2]=right-top [3]=left-top
      const sidePairs: [number, number][] = [[0,1],[1,2],[2,3],[3,0]]
      const sideEntities = sidePairs.flatMap(([a, b]) => [
        viewer.entities.add({
          polygon: { hierarchy: [apexPos, corners[a], corners[b]], material: sideMat, outline: false, perPositionHeight: true },
        }),
        viewer.entities.add({
          polygon: { hierarchy: [apexPos, corners[b], corners[a]], material: sideMat, outline: false, perPositionHeight: true },
        }),
      ])

      // 4 — wireframe edges: apex → each corner + closed far-face loop
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

  const btnCls =
    'w-8 h-8 flex items-center justify-center font-mono text-[13px] ' +
    'bg-[#161b22]/90 border border-[#30363d] text-[#8b949e] ' +
    'hover:text-[#e6edf3] hover:border-[#58a6ff] transition-colors select-none'

  const handleZoomIn = () => {
    viewerRef.current?.camera.zoomIn(viewerRef.current.camera.positionCartographic.height * 0.4)
  }
  const handleZoomOut = () => {
    viewerRef.current?.camera.zoomOut(viewerRef.current.camera.positionCartographic.height * 0.6)
  }
  const handleHome = () => {
    viewerRef.current?.camera.setView({
      destination: Cartesian3.fromDegrees(-118.2437, 34.0522, 2000),
      orientation: { heading: CesiumMath.toRadians(0), pitch: CesiumMath.toRadians(-35), roll: 0 },
    })
  }
  const handleToggle3D = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (is3D) {
      viewer.scene.morphTo2D(1)
      setIs3D(false)
    } else {
      viewer.scene.morphTo3D(1)
      setIs3D(true)
    }
  }

  return (
    <div className="relative w-full h-full" style={{ background: '#090e15' }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Map controls — bottom-right */}
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
