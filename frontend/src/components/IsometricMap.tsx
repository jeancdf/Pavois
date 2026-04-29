import { useRef, useEffect, useCallback } from 'react'
import { PAVOISSim, type SimCamera, type SimTrack } from '../sim/pavoisSim'
import type { Theme } from '../store/simStore'

// ── Isometric projection constants ────────────────────────────────────────────
const TW = 44, TH = 22, ZSCALE = 14

interface ScreenPt { sx: number; sy: number }

function proj(x: number, y: number, z: number, ox: number, oy: number): ScreenPt {
  return {
    sx: ox + (x - y) * TW / 2,
    sy: oy + (x + y) * TH / 2 - z * ZSCALE,
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function drawDiamond(ctx: CanvasRenderingContext2D, sx: number, sy: number, w: number, h: number) {
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(sx + w / 2, sy + h / 2)
  ctx.lineTo(sx, sy + h)
  ctx.lineTo(sx - w / 2, sy + h / 2)
  ctx.closePath()
}

function drawTileAt(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke: string, ox: number, oy: number) {
  const p = proj(x, y, 0, ox, oy)
  drawDiamond(ctx, p.sx, p.sy, TW, TH)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 0.5
  ctx.stroke()
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, zBot: number, zTop: number,
  topColor: string, rightColor: string, leftColor: string,
  ox: number, oy: number,
) {
  const tl  = proj(x,     y,     zTop, ox, oy)
  const tr  = proj(x + w, y,     zTop, ox, oy)
  const br  = proj(x + w, y + h, zTop, ox, oy)
  const bl  = proj(x,     y + h, zTop, ox, oy)
  const brB = proj(x + w, y + h, zBot, ox, oy)
  const trB = proj(x + w, y,     zBot, ox, oy)
  const blB = proj(x,     y + h, zBot, ox, oy)

  // Right face
  ctx.beginPath()
  ctx.moveTo(tr.sx, tr.sy); ctx.lineTo(br.sx, br.sy)
  ctx.lineTo(brB.sx, brB.sy); ctx.lineTo(trB.sx, trB.sy)
  ctx.closePath(); ctx.fillStyle = rightColor; ctx.fill()

  // Left face
  ctx.beginPath()
  ctx.moveTo(bl.sx, bl.sy); ctx.lineTo(br.sx, br.sy)
  ctx.lineTo(brB.sx, brB.sy); ctx.lineTo(blB.sx, blB.sy)
  ctx.closePath(); ctx.fillStyle = leftColor; ctx.fill()

  // Top face
  ctx.beginPath()
  ctx.moveTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy)
  ctx.lineTo(br.sx, br.sy); ctx.lineTo(bl.sx, bl.sy)
  ctx.closePath(); ctx.fillStyle = topColor; ctx.fill()
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  cameras: SimCamera[]
  tracks: SimTrack[]
  currentTime: number
  selectedCamera: string | null
  selectedTrack: string | null
  onSelectCamera: (id: string | null) => void
  onSelectTrack: (id: string | null) => void
  showPrediction: boolean
  showCoverage: boolean
  theme: Theme
}

const THEME_VARS = {
  light: { tileFill: '#EEF2F8', tileStroke: '#D5DCE9', tileFillAlt: '#E6EBF4', gridBg: '#F0F4FB', camLabelBg: 'rgba(255,255,255,0.85)', camLabelText: '#1E293B' },
  dark:  { tileFill: '#1A2535', tileStroke: '#243047', tileFillAlt: '#1E2C40', gridBg: '#111827', camLabelBg: 'rgba(15,23,42,0.85)',     camLabelText: '#CBD5E1' },
  mono:  { tileFill: '#F4F5F6', tileStroke: '#D9DCDF', tileFillAlt: '#EAECEE', gridBg: '#ECEEF0', camLabelBg: 'rgba(255,255,255,0.9)',   camLabelText: '#111' },
}

type HitTarget = { type: 'camera' | 'track'; id: string; sx: number; sy: number; r: number }

export default function IsometricMap({
  cameras, tracks, currentTime,
  selectedCamera, selectedTrack,
  onSelectCamera, onSelectTrack,
  showPrediction, showCoverage, theme,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitRef    = useRef<HitTarget[]>([])
  const T = THEME_VARS[theme]
  const GRID = PAVOISSim.GRID

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const hits: HitTarget[] = []

    const ox = W / 2 + TW * 0.5
    const oy = 55

    ctx.fillStyle = T.gridBg
    ctx.fillRect(0, 0, W, H)

    // Ground tiles (painter's order — diagonal bands)
    for (let sum = 0; sum <= GRID * 2; sum++) {
      for (let xi = Math.max(0, sum - GRID); xi <= Math.min(GRID, sum); xi++) {
        const yi = sum - xi
        if (yi < 0 || yi > GRID) continue
        const alt = (xi + yi) % 2 === 0
        drawTileAt(ctx, xi, yi, alt ? T.tileFillAlt : T.tileFill, T.tileStroke, ox, oy)
      }
    }

    // Coverage zones — 3D cones
    if (showCoverage) {
      const sortedCams = [...cameras].sort((a, b) => (a.x + a.y) - (b.x + b.y))
      for (const cam of sortedCams) {
        if (cam.status === 'offline') continue
        const poly = PAVOISSim.getCoveragePolygon(cam)
        const base = cam.status === 'degraded' ? 0.07 : 0.12
        const apex = proj(cam.x, cam.y, cam.z, ox, oy)

        const arcPts = poly.slice(1).map(p => proj(p.x, p.y, 0, ox, oy))
        const mid = Math.floor(arcPts.length / 2)

        // Back faces
        for (let i = 0; i < mid; i++) {
          const p1 = arcPts[i], p2 = arcPts[i + 1] ?? arcPts[i]
          ctx.beginPath()
          ctx.moveTo(apex.sx, apex.sy); ctx.lineTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy)
          ctx.closePath()
          ctx.fillStyle = hexToRgba(cam.color, base * 0.55)
          ctx.fill()
          ctx.strokeStyle = hexToRgba(cam.color, base * 1.2)
          ctx.lineWidth = 0.4
          ctx.stroke()
        }

        // Ground polygon (base)
        ctx.beginPath()
        poly.forEach((p, i) => {
          const s = proj(p.x, p.y, 0, ox, oy)
          i === 0 ? ctx.moveTo(s.sx, s.sy) : ctx.lineTo(s.sx, s.sy)
        })
        ctx.closePath()
        ctx.fillStyle = hexToRgba(cam.color, base * 1.1)
        ctx.fill()
        ctx.strokeStyle = hexToRgba(cam.color, base * 2.2)
        ctx.lineWidth = 0.7
        ctx.stroke()

        // Front faces
        for (let i = mid; i < arcPts.length - 1; i++) {
          const p1 = arcPts[i], p2 = arcPts[i + 1]
          ctx.beginPath()
          ctx.moveTo(apex.sx, apex.sy); ctx.lineTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy)
          ctx.closePath()
          ctx.fillStyle = hexToRgba(cam.color, base * 0.72)
          ctx.fill()
          ctx.strokeStyle = hexToRgba(cam.color, base * 1.5)
          ctx.lineWidth = 0.4
          ctx.stroke()
        }

        // Edge rays
        ;[arcPts[0], arcPts[arcPts.length - 1]].forEach(gp => {
          ctx.beginPath()
          ctx.moveTo(apex.sx, apex.sy); ctx.lineTo(gp.sx, gp.sy)
          ctx.strokeStyle = hexToRgba(cam.color, base * 3.5)
          ctx.lineWidth = 1.2
          ctx.setLineDash([])
          ctx.stroke()
        })

        // Vertical pole
        const camGnd = proj(cam.x, cam.y, 0, ox, oy)
        ctx.beginPath()
        ctx.moveTo(apex.sx, apex.sy); ctx.lineTo(camGnd.sx, camGnd.sy)
        ctx.strokeStyle = hexToRgba(cam.color, base * 4)
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Track trails
    for (const track of tracks) {
      const trail = PAVOISSim.getTrailPoints(track, currentTime, 10)
      if (trail.length < 2) continue
      for (let i = 1; i < trail.length; i++) {
        const p1 = proj(trail[i - 1].x, trail[i - 1].y, trail[i - 1].z, ox, oy)
        const p2 = proj(trail[i].x,     trail[i].y,     trail[i].z,     ox, oy)
        const alpha = 0.2 + (i / trail.length) * 0.7
        ctx.beginPath()
        ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy)
        ctx.strokeStyle = hexToRgba(track.color, alpha)
        ctx.lineWidth = selectedTrack === track.id ? 2.5 : 1.5
        ctx.setLineDash([])
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(p2.sx, p2.sy, selectedTrack === track.id ? 3 : 2, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(track.color, alpha)
        ctx.fill()
      }
    }

    // Predicted paths
    if (showPrediction) {
      for (const track of tracks) {
        const pred = PAVOISSim.getPrediction(track, currentTime)
        if (!pred.length) continue
        const cur = PAVOISSim.lerpPos(track.waypoints, currentTime)
        if (!cur) continue
        const p0 = proj(cur.x, cur.y, cur.z, ox, oy)
        ctx.beginPath()
        ctx.moveTo(p0.sx, p0.sy)
        pred.forEach(p => {
          const s = proj(p.x, p.y, p.z, ox, oy)
          ctx.lineTo(s.sx, s.sy)
        })
        ctx.strokeStyle = hexToRgba(track.color, 0.45)
        ctx.lineWidth = 1.2
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        if (pred.length >= 2) {
          const last = proj(pred[pred.length - 1].x, pred[pred.length - 1].y, pred[pred.length - 1].z, ox, oy)
          const prev = proj(pred[pred.length - 2].x, pred[pred.length - 2].y, pred[pred.length - 2].z, ox, oy)
          const ang = Math.atan2(last.sy - prev.sy, last.sx - prev.sx)
          ctx.beginPath()
          ctx.moveTo(last.sx, last.sy)
          ctx.lineTo(last.sx - 8 * Math.cos(ang - 0.4), last.sy - 8 * Math.sin(ang - 0.4))
          ctx.moveTo(last.sx, last.sy)
          ctx.lineTo(last.sx - 8 * Math.cos(ang + 0.4), last.sy - 8 * Math.sin(ang + 0.4))
          ctx.strokeStyle = hexToRgba(track.color, 0.55)
          ctx.lineWidth = 1.5
          ctx.stroke()
        }
      }
    }

    // Camera markers
    for (const cam of cameras) {
      const isSelected = selectedCamera === cam.id
      const alpha = cam.status === 'offline' ? 0.3 : 1
      const bx = cam.x - 0.35, by = cam.y - 0.35, bw = 0.7, bh = 0.7

      const darken = (hex: string, factor: number) => {
        const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor)
        const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor)
        const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor)
        return `rgba(${r},${g},${b},${alpha})`
      }

      ctx.globalAlpha = alpha
      drawIsoBox(ctx, bx, by, bw, bh, 0, 2.5,
        hexToRgba(cam.color, 0.9),
        darken(cam.color, 0.65),
        darken(cam.color, 0.5),
        ox, oy,
      )
      ctx.globalAlpha = 1

      if (isSelected) {
        const p = proj(cam.x, cam.y, 2.5, ox, oy)
        ctx.beginPath()
        ctx.arc(p.sx, p.sy + TH / 4, TW * 0.55, 0, Math.PI * 2)
        ctx.strokeStyle = cam.color
        ctx.lineWidth = 2
        ctx.setLineDash([4, 3])
        ctx.stroke()
        ctx.setLineDash([])
      }

      const lp = proj(cam.x, cam.y, 3.2, ox, oy)
      const label = cam.id.replace('CAM-', '')
      ctx.font = '500 9px IBM Plex Mono, monospace'
      const tw = ctx.measureText(label).width
      ctx.fillStyle = T.camLabelBg
      ctx.fillRect(lp.sx - tw / 2 - 3, lp.sy - 9, tw + 6, 13)
      ctx.fillStyle = cam.status === 'offline' ? '#9CA3AF' : cam.color
      ctx.fillText(label, lp.sx - tw / 2, lp.sy)

      const hp = proj(cam.x, cam.y, 1.5, ox, oy)
      hits.push({ type: 'camera', id: cam.id, sx: hp.sx, sy: hp.sy, r: 16 })
    }

    // Drone markers
    for (const track of tracks) {
      const pos = PAVOISSim.lerpPos(track.waypoints, currentTime)
      if (!pos) continue
      if (pos.x < 0 || pos.x > GRID || pos.y < 0 || pos.y > GRID) continue

      const p = proj(pos.x, pos.y, pos.z, ox, oy)
      const isSelected = selectedTrack === track.id
      const vel = PAVOISSim.getVelocity(track, currentTime)

      // Velocity vector
      const vScale = 1.8
      const vEnd = proj(pos.x + vel.vx * vScale, pos.y + vel.vy * vScale, pos.z + vel.vz * vScale, ox, oy)
      ctx.beginPath()
      ctx.moveTo(p.sx, p.sy); ctx.lineTo(vEnd.sx, vEnd.sy)
      ctx.strokeStyle = hexToRgba(track.color, 0.8)
      ctx.lineWidth = 2
      ctx.stroke()
      const ang2 = Math.atan2(vEnd.sy - p.sy, vEnd.sx - p.sx)
      ctx.beginPath()
      ctx.moveTo(vEnd.sx, vEnd.sy)
      ctx.lineTo(vEnd.sx - 7 * Math.cos(ang2 - 0.5), vEnd.sy - 7 * Math.sin(ang2 - 0.5))
      ctx.lineTo(vEnd.sx - 7 * Math.cos(ang2 + 0.5), vEnd.sy - 7 * Math.sin(ang2 + 0.5))
      ctx.closePath()
      ctx.fillStyle = hexToRgba(track.color, 0.85)
      ctx.fill()

      // Pulsing ring
      const pulse = Math.sin(Date.now() / 400) * 0.3 + 0.7
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, (isSelected ? 14 : 11) * pulse, 0, Math.PI * 2)
      ctx.strokeStyle = hexToRgba(track.color, 0.3)
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Main marker
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, isSelected ? 7 : 5.5, 0, Math.PI * 2)
      ctx.fillStyle = track.color
      ctx.fill()
      ctx.strokeStyle = theme === 'dark' ? '#1A2535' : '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Label
      ctx.font = `${isSelected ? '600' : '500'} 10px IBM Plex Mono, monospace`
      const tid = track.id.replace('TRK-', '#')
      const tw2 = ctx.measureText(tid).width
      ctx.fillStyle = T.camLabelBg
      ctx.fillRect(p.sx + 10, p.sy - 10, tw2 + 8, 14)
      ctx.fillStyle = track.color
      ctx.fillText(tid, p.sx + 14, p.sy)

      hits.push({ type: 'track', id: track.id, sx: p.sx, sy: p.sy, r: 14 })
    }

    hitRef.current = hits
  }, [cameras, tracks, currentTime, selectedCamera, selectedTrack, showPrediction, showCoverage, theme, T, GRID])

  // Animation loop (for pulse effect)
  useEffect(() => {
    let raf: number
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    for (const h of hitRef.current) {
      const d = Math.sqrt((mx - h.sx) ** 2 + (my - h.sy) ** 2)
      if (d <= h.r) {
        if (h.type === 'camera') onSelectCamera(h.id)
        else onSelectTrack(h.id)
        return
      }
    }
    onSelectCamera(null)
    onSelectTrack(null)
  }, [onSelectCamera, onSelectTrack])

  return (
    <canvas
      ref={canvasRef}
      width={780}
      height={520}
      onClick={handleClick}
      style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
    />
  )
}
