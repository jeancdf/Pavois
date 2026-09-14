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
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  MAX_RAIL_VOXELS,
  RAIL_VOXEL_SIZE_M,
  RailBenchState,
  RailVoxel,
  Vec3m,
} from '../../config/rail-bench';

@Component({
  selector: 'app-rail-volume',
  templateUrl: './rail-volume.html',
  styleUrl: './rail-volume.css',
})
export class RailVolume implements AfterViewInit, OnDestroy {
  readonly bench = input<RailBenchState | null>(null);
  readonly voxels = input<RailVoxel[]>([]);
  readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private frame = 0;
  private voxelMesh: THREE.InstancedMesh | null = null;
  private rayLines: THREE.Line[] = [];
  private renderedBench: RailBenchState | null = null;
  readonly failed = signal(false);

  constructor() {
    effect(() => {
      this.bench();
      this.voxels();
      this.syncScene();
    });
  }

  ngAfterViewInit(): void {
    this.initScene();
    this.syncScene();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.controls?.dispose();
    this.renderer?.dispose();
    for (const line of this.rayLines) {
      line.geometry.dispose();
      disposeMaterial(line.material);
    }
    this.voxelMesh?.geometry.dispose();
    const voxelMaterial = this.voxelMesh?.material;
    if (Array.isArray(voxelMaterial)) {
      for (const material of voxelMaterial) material.dispose();
    } else {
      voxelMaterial?.dispose();
    }
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

    if (!this.voxelMesh) {
      this.voxelMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(
          RAIL_VOXEL_SIZE_M * 0.9,
          RAIL_VOXEL_SIZE_M * 0.9,
          RAIL_VOXEL_SIZE_M * 0.9,
        ),
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.75,
        }),
        MAX_RAIL_VOXELS,
      );
      this.voxelMesh.name = 'raw-intersection-voxels';
      this.voxelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(this.voxelMesh);
    }
    const voxels = this.voxels().slice(-MAX_RAIL_VOXELS);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < voxels.length; ++i) {
      const point = toThree(voxels[i]);
      matrix.makeTranslation(point.x, point.y, point.z);
      this.voxelMesh.setMatrixAt(i, matrix);
    }
    this.voxelMesh.count = voxels.length;
    this.voxelMesh.instanceMatrix.needsUpdate = true;

    for (const line of this.rayLines) {
      scene.remove(line);
      line.geometry.dispose();
      disposeMaterial(line.material);
    }
    this.rayLines = [];
    const end = voxels[voxels.length - 1];
    if (!end) return;
    const seeing = new Set(end.cameras);
    for (const cam of bench.cameras) {
      if (!seeing.has(cam.id)) continue;
      const geom = new THREE.BufferGeometry().setFromPoints([toThree(cam), toThree(end)]);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: cameraColor(cam.id) }),
      );
      scene.add(line);
      this.rayLines.push(line);
    }
  }
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
