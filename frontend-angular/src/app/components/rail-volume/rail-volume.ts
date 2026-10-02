import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RailBenchState, Vec3m } from '../../config/rail-bench';
import type { FuseTrack } from '../../models/fuse-update.model';

// Positions kept behind each track: about 3 s at 30 updates per second.
const TRAIL_POINTS = 90;
const TRACK_COLORS = [
  0xf59e0b, 0xec4899, 0xfacc15, 0x14b8a6, 0xef4444, 0xa3e635, 0xfb923c, 0xe2e8f0,
];

interface TrackVisual {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite;
  trail: THREE.Line;
  trailCount: number;
}

@Component({
  selector: 'app-rail-volume',
  imports: [DecimalPipe],
  templateUrl: './rail-volume.html',
  styleUrl: './rail-volume.css',
})
export class RailVolume implements AfterViewInit, OnDestroy {
  readonly bench = input<RailBenchState | null>(null);
  // Every confirmed track of the fusion engine, one marker per target.
  readonly tracks = input<FuseTrack[]>([]);
  readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private readonly trackVisuals = new Map<number, TrackVisual>();
  // Track id -> index in TRACK_COLORS, held for as long as the track lives.
  private readonly colorSlots = new Map<number, number>();
  private expectedMesh: THREE.Mesh | null = null;
  private rayLines: THREE.Line[] = [];
  private renderedBench: RailBenchState | null = null;
  readonly failed = signal(false);

  constructor() {
    effect(() => {
      this.bench();
      this.releaseColors(this.tracks());
      this.syncScene();
    });
  }

  ngAfterViewInit(): void {
    this.initScene();
    this.syncScene();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    for (const line of this.rayLines) {
      line.geometry.dispose();
      disposeMaterial(line.material);
    }
    for (const visual of this.trackVisuals.values()) disposeTrackVisual(visual);
    this.trackVisuals.clear();
    this.expectedMesh?.geometry.dispose();
    if (this.expectedMesh) disposeMaterial(this.expectedMesh.material);
    this.scene = null;
  }

  private initScene(): void {
    const el = this.host()?.nativeElement;
    if (!el) return;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1220);
      const camera = new THREE.PerspectiveCamera(
        50,
        Math.max(el.clientWidth, 1) / Math.max(el.clientHeight, 1),
        0.05,
        40,
      );
      camera.position.set(2.2, 2.4, 3.4);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      // Inline by default, a canvas leaves a text-line gap under itself.
      renderer.domElement.style.display = 'block';
      el.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.4, -1.4);
      controls.update();
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.8);
      sun.position.set(2, 6, 3);
      scene.add(sun);
      const grid = new THREE.GridHelper(8, 16, 0x1e3a5f, 0x132033);
      scene.add(grid);
      const axes = new THREE.AxesHelper(0.6);
      scene.add(axes);
      this.scene = scene;
      this.camera = camera;
      this.renderer = renderer;
      this.controls = controls;
      // The scene shares its row with panels that open and close, so it
      // follows its container rather than the window.
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.fitToHost());
        this.resizeObserver.observe(el);
      }
      const loop = () => {
        this.frame = requestAnimationFrame(loop);
        this.controls?.update();
        this.renderer?.render(scene, camera);
      };
      loop();
    } catch {
      this.failed.set(true);
    }
  }

  private fitToHost(): void {
    const el = this.host()?.nativeElement;
    if (!el || !this.renderer || !this.camera) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private syncScene(): void {
    const scene = this.scene;
    const bench = this.bench();
    if (!scene || !bench) return;

    if (this.renderedBench !== bench) {
      const oldRail = scene.getObjectByName('rail') as THREE.Mesh | null;
      if (oldRail) {
        scene.remove(oldRail);
        oldRail.geometry.dispose();
        disposeMaterial(oldRail.material);
      }
      const railLen = adjacentWidth(bench);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(railLen, 0.03, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x64748b }),
      );
      rail.name = 'rail';
      rail.position.set(0, 0.015, 0);
      scene.add(rail);

      for (const cam of bench.cameras) {
        let mesh = scene.getObjectByName(`cam-${cam.id}`) as THREE.Mesh | null;
        if (!mesh) {
          mesh = new THREE.Mesh(
            new THREE.ConeGeometry(0.07, 0.18, 8),
            new THREE.MeshStandardMaterial({
              color: cameraColor(cam.id),
            }),
          );
          mesh.name = `cam-${cam.id}`;
          scene.add(mesh);
        }
        const p = toThree(cam);
        mesh.position.copy(p);
        mesh.rotation.set((-90 * Math.PI) / 180, 0, 0);
      }
      this.renderedBench = bench;
    }

    if (!this.expectedMesh) {
      this.expectedMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16),
        new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.55,
        }),
      );
      this.expectedMesh.name = 'expected-target';
      scene.add(this.expectedMesh);
    }
    const radius = Math.max(0.06, bench.targetSizeM / 2);
    this.expectedMesh.scale.setScalar(radius / 0.1);
    this.expectedMesh.position.copy(toThree(bench.expected));

    const tracks = this.tracks();
    const alive = new Set<number>();
    for (const track of tracks) {
      alive.add(track.objectId);
      let visual = this.trackVisuals.get(track.objectId);
      if (!visual) {
        visual = createTrackVisual(track.objectId, this.colorOf(track.objectId));
        scene.add(visual.mesh, visual.label, visual.trail);
        this.trackVisuals.set(track.objectId, visual);
      }
      const p = toThree(track);
      visual.mesh.position.copy(p);
      visual.label.position.set(p.x, p.y + 0.12, p.z);
      // Two cameras give a weaker fix than three: draw those targets faint.
      const opacity = track.cameras.length >= 3 ? 1 : 0.35;
      visual.mesh.material.opacity = opacity;
      visual.label.material.opacity = opacity;
      extendTrail(visual, p);
    }
    for (const [id, visual] of this.trackVisuals) {
      if (alive.has(id)) continue;
      scene.remove(visual.mesh, visual.label, visual.trail);
      disposeTrackVisual(visual);
      this.trackVisuals.delete(id);
    }

    for (const line of this.rayLines) {
      scene.remove(line);
      line.geometry.dispose();
      disposeMaterial(line.material);
    }
    this.rayLines = [];
    for (const track of tracks) {
      const seeing = new Set(track.cameras);
      for (const cam of bench.cameras) {
        if (!seeing.has(cam.id)) continue;
        const geom = new THREE.BufferGeometry().setFromPoints([toThree(cam), toThree(track)]);
        const line = new THREE.Line(
          geom,
          new THREE.LineBasicMaterial({
            color: cameraColor(cam.id),
            transparent: true,
            opacity: 0.45,
          }),
        );
        scene.add(line);
        this.rayLines.push(line);
      }
    }
  }

  cssColor(objectId: number): string {
    return '#' + this.colorOf(objectId).toString(16).padStart(6, '0');
  }

  // Two tracks on screen never share a colour while a free one remains: ids
  // only grow, so colouring by id would repeat among simultaneous targets.
  private colorOf(objectId: number): number {
    let slot = this.colorSlots.get(objectId);
    if (slot === undefined) {
      const used = new Set(this.colorSlots.values());
      slot = 0;
      while (used.has(slot) && slot < TRACK_COLORS.length - 1) slot += 1;
      this.colorSlots.set(objectId, slot);
    }
    return TRACK_COLORS[slot];
  }

  private releaseColors(tracks: FuseTrack[]): void {
    const alive = new Set(tracks.map((track) => track.objectId));
    for (const id of this.colorSlots.keys()) {
      if (!alive.has(id)) this.colorSlots.delete(id);
    }
  }
}

function createTrackVisual(objectId: number, color: number): TrackVisual {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshStandardMaterial({ color, transparent: true }),
  );
  mesh.name = `track-${objectId}`;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(`#${objectId}`, 64, 32);
  }
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
    }),
  );
  label.scale.set(0.2, 0.1, 1);

  // Fixed-size buffer filled as the track moves; only the drawn range grows.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  const trail = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
  // The bounding sphere is never recomputed for the moving trail.
  trail.frustumCulled = false;
  return { mesh, label, trail, trailCount: 0 };
}

function extendTrail(visual: TrackVisual, p: THREE.Vector3): void {
  const attribute = visual.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
  const positions = attribute.array as Float32Array;
  // The same snapshot can be delivered twice; a trail point is a new position.
  const last = (visual.trailCount - 1) * 3;
  if (
    visual.trailCount > 0 &&
    positions[last] === Math.fround(p.x) &&
    positions[last + 1] === Math.fround(p.y) &&
    positions[last + 2] === Math.fround(p.z)
  ) {
    return;
  }
  if (visual.trailCount === TRAIL_POINTS) {
    positions.copyWithin(0, 3);
    visual.trailCount -= 1;
  }
  positions.set([p.x, p.y, p.z], visual.trailCount * 3);
  visual.trailCount += 1;
  attribute.needsUpdate = true;
  visual.trail.geometry.setDrawRange(0, visual.trailCount);
}

function disposeTrackVisual(visual: TrackVisual): void {
  visual.mesh.geometry.dispose();
  visual.mesh.material.dispose();
  visual.label.material.map?.dispose();
  visual.label.material.dispose();
  visual.trail.geometry.dispose();
  disposeMaterial(visual.trail.material);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

function adjacentWidth(bench: RailBenchState): number {
  const left = bench.cameras[0];
  const right = bench.cameras[bench.cameras.length - 1];
  return Math.abs(right.x - left.x) + 0.12;
}

function toThree(v: Vec3m): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

function cameraColor(id: string): number {
  if (id === 'tanel') return 0x38bdf8;
  if (id === 'walid') return 0xa78bfa;
  return 0x3b82f6;
}
