import { useState } from 'react'
import { useCameraStore } from '../store/cameraStore'
import { useMapStore } from '../store/mapStore'

// ── tiny shared primitives ───────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="font-mono text-[9px] text-[#484f58] tracking-[4px] uppercase">
      {label}
    </p>
  )
}

function Divider() {
  return <div className="border-b border-[#21262d]" />
}

const inputCls =
  'bg-[#0d1117] border border-[#30363d] text-[#e6edf3] font-mono ' +
  'text-[12px] px-2.5 py-1.5 focus:outline-none focus:border-[#58a6ff] ' +
  'transition-colors w-full'

// ── camera row ───────────────────────────────────────────────────────────────

function CameraRow({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between group py-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-[#58a6ff] shrink-0" />
        <span className="font-mono text-[11px] text-[#e6edf3] truncate">
          {name}
        </span>
      </div>
      <button
        onClick={onRemove}
        className="ml-2 font-mono text-[13px] leading-none text-[#484f58] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
        title="Remove camera"
      >
        ×
      </button>
    </div>
  )
}

// ── add-camera form (inline in sidebar) ─────────────────────────────────────

const DEFAULTS = {
  name: '',
  lat: '',
  lng: '',
  altitudeM: '5',
  yawDeg: '0',
  pitchDeg: '30',
  hFovDeg: '90',
}

function AddCameraForm({ onDone }: { onDone: () => void }) {
  const addCamera = useCameraStore((s) => s.addCamera)
  const setPendingClick = useMapStore((s) => s.setPendingClick)
  const [form, setForm] = useState(DEFAULTS)
  const [error, setError] = useState('')
  const [pickingFromMap, setPickingFromMap] = useState(false)

  const set = (key: keyof typeof DEFAULTS) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  const handlePickOnMap = () => {
    setPickingFromMap(true)
    setPendingClick((lat, lng) => {
      setForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }))
      setPickingFromMap(false)
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const lat = parseFloat(form.lat)
    const lng = parseFloat(form.lng)
    if (!form.name.trim()) return setError('Name is required.')
    if (isNaN(lat) || lat < -90 || lat > 90)
      return setError('Latitude must be −90 to 90.')
    if (isNaN(lng) || lng < -180 || lng > 180)
      return setError('Longitude must be −180 to 180.')
    addCamera({
      name: form.name.trim(),
      lat,
      lng,
      altitudeM: parseFloat(form.altitudeM) || 10,
      yawDeg: parseFloat(form.yawDeg) || 0,
      pitchDeg: parseFloat(form.pitchDeg) || -30,
      hFovDeg: parseFloat(form.hFovDeg) || 90,
    })
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Name */}
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[9px] text-[#484f58] tracking-[3px] uppercase">
          Name
        </label>
        <input
          className={inputCls}
          placeholder="e.g. Roof NW"
          value={form.name}
          onChange={set('name')}
          autoFocus
        />
      </div>

      {/* Position */}
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[9px] text-[#484f58] tracking-[3px] uppercase">
          Position
        </label>
        <button
          type="button"
          onClick={handlePickOnMap}
          className={`w-full font-mono text-[11px] px-3 py-1.5 border transition-colors ${
            pickingFromMap
              ? 'text-[#0d1117] bg-[#58a6ff] border-[#58a6ff]'
              : 'text-[#58a6ff] border-[#58a6ff] hover:bg-[#58a6ff]/10'
          }`}
        >
          {pickingFromMap ? '▶ Click on the map…' : '⊕ Pick on map'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Lat" value={form.lat} onChange={set('lat')} />
          <input className={inputCls} placeholder="Lng" value={form.lng} onChange={set('lng')} />
        </div>
      </div>

      {/* Altitude */}
      <div className="flex flex-col gap-1">
        <label className="font-mono text-[9px] text-[#484f58] tracking-[3px] uppercase">
          Altitude <span className="normal-case tracking-normal text-[#3d444d]">m above ground</span>
        </label>
        <input className={inputCls} type="number" value={form.altitudeM} onChange={set('altitudeM')} />
      </div>

      {/* Yaw / Pitch / H-FOV */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['Yaw °', 'yawDeg'],
            ['Pitch °', 'pitchDeg'],
            ['H-FOV °', 'hFovDeg'],
          ] as const
        ).map(([lbl, key]) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="font-mono text-[9px] text-[#484f58] tracking-[2px] uppercase">
              {lbl}
            </label>
            <input className={inputCls} type="number" value={form[key]} onChange={set(key)} />
          </div>
        ))}
      </div>

      {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="flex-1 font-mono text-[11px] text-[#8b949e] border border-[#30363d] px-3 py-1.5 hover:bg-[#21262d] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex-1 font-mono text-[11px] text-[#0d1117] bg-[#58a6ff] border border-[#58a6ff] px-3 py-1.5 hover:bg-[#79b8ff] transition-colors"
        >
          Add
        </button>
      </div>
    </form>
  )
}

// ── sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const [addingCamera, setAddingCamera] = useState(false)
  const cameras = useCameraStore((s) => s.cameras)
  const removeCamera = useCameraStore((s) => s.removeCamera)

  return (
    <div className="w-64 shrink-0 bg-[#161b22] border-r border-[#21262d] flex flex-col overflow-y-auto">

      {/* ── Cameras section ── */}
      <div className="flex flex-col gap-3 px-4 py-4 border-b border-[#21262d]">
        <div className="flex items-center justify-between">
          <SectionLabel label="Cameras" />
          {cameras.length > 0 && !addingCamera && (
            <span className="font-mono text-[9px] text-[#484f58]">
              {cameras.length}
            </span>
          )}
        </div>

        {/* Camera list */}
        {cameras.length > 0 && (
          <div className="flex flex-col gap-1">
            {cameras.map((cam) => (
              <CameraRow
                key={cam.id}
                name={cam.name}
                onRemove={() => removeCamera(cam.id)}
              />
            ))}
          </div>
        )}

        {/* Inline form or add button */}
        {addingCamera ? (
          <>
            <Divider />
            <AddCameraForm onDone={() => setAddingCamera(false)} />
          </>
        ) : (
          <button
            onClick={() => setAddingCamera(true)}
            className="w-full font-mono text-[11px] text-[#58a6ff] border border-[#30363d] px-3 py-1.5 hover:bg-[#58a6ff]/10 hover:border-[#58a6ff] transition-colors text-left"
          >
            + Add Camera
          </button>
        )}
      </div>

      {/* ── Voxel Grid section ── */}
      <div className="flex flex-col gap-3 px-4 py-4 border-b border-[#21262d]">
        <SectionLabel label="Voxel Grid" />
        <p className="font-mono text-[11px] text-[#484f58]">Not configured.</p>
      </div>

      {/* ── Coverage Metrics section ── */}
      <div className="flex flex-col gap-3 px-4 py-4">
        <SectionLabel label="Coverage Metrics" />
        <p className="font-mono text-[11px] text-[#484f58]">
          {cameras.length === 0
            ? 'Add cameras to compute coverage.'
            : `${cameras.length} camera${cameras.length > 1 ? 's' : ''} active`}
        </p>
      </div>

    </div>
  )
}
