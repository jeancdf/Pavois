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
import { RailBenchState, Vec3m } from '../../config/rail-bench';

@Component({
  selector: 'app-rail-volume',
  templateUrl: './rail-volume.html',
  styleUrl: './rail-volume.css',
})
export class RailVolume implements AfterViewInit, OnDestroy {
  readonly bench = input<RailBenchState | null>(null);
  readonly estimated = input<Vec3m | null>(null);
  readonly seeing = input<string[]>([]);
  readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private frame = 0;
  private estimatedMesh: THREE.Mesh | null = null;
  private expectedMesh: THREE.Mesh | null = null;
  private rayLines: THREE.Line[] = [];
  readonly failed = signal(false);

  constructor() {
    effect(() => {
      this.bench();
      this.estimated();
      this.seeing();
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

    const oldRail = scene.getObjectByName('rail');
    if (oldRail) scene.remove(oldRail);
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

    if (!this.expectedMesh) {
      this.expectedMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16),
        new THREE.MeshStandardMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: 0.55,
        }),
      );
      this.expectedMesh.name = 'expected';
      scene.add(this.expectedMesh);
    }
    const radius = Math.max(0.06, bench.targetSizeM / 2);
    this.expectedMesh.scale.setScalar(radius / 0.1);
    this.expectedMesh.position.copy(toThree(bench.expected));

    const estimated = this.estimated();
    if (estimated) {
      if (!this.estimatedMesh) {
        this.estimatedMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 16, 16),
          new THREE.MeshStandardMaterial({ color: 0xf59e0b }),
        );
        this.estimatedMesh.name = 'estimated';
        scene.add(this.estimatedMesh);
      }
      this.estimatedMesh.visible = true;
      this.estimatedMesh.position.copy(toThree(estimated));
    } else if (this.estimatedMesh) {
      this.estimatedMesh.visible = false;
    }

    for (const line of this.rayLines) scene.remove(line);
    this.rayLines = [];
    const seeing = new Set(this.seeing());
    const end = estimated ?? bench.expected;
    for (const cam of bench.cameras) {
      if (!seeing.has(cam.id) && !estimated) continue;
      if (!seeing.has(cam.id)) continue;
      const geom = new THREE.BufferGeometry().setFromPoints([
        toThree(cam),
        toThree(end),
      ]);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: cameraColor(cam.id) }),
      );
      scene.add(line);
      this.rayLines.push(line);
    }
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
