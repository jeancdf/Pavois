import { AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { TrackSelectionService } from '../../services/track-selection.service';
import { CameraConfigService } from '../../services/camera-config.service';
import { NotificationService } from '../../services/notification.service';
import { CameraPosition } from '../../models/world-position.model';
import { ObjectClassification, TrackUpdate } from '../../models/track-update.model';
import { RawDetection } from '../../models/raw-detection.model';

const EARTH_RADIUS_M = 6371000;
const TRAIL_LENGTH = 30;
const TILE_MAX_NATIVE_ZOOM = 19;
const MAX_ZOOM = 23;
const DEFAULT_ZOOM = 21;
const DEFAULT_CENTER: L.LatLngExpression = [48.8566, 2.3522];
// 7 décimales ≈ 1 cm : suffisant pour une position posée à la souris
const COORD_DECIMALS = 7;
const TRACK_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fb7185'];

// raw_detection ne transporte pas la largeur d'image ; toutes les caméras du
// parc tournent avec camstream.sh en --width 1280, donc c'est la référence
// utilisée pour convertir un pixel en angle dans le FOV.
const DETECTION_FRAME_WIDTH = 1280;
const RAW_RAY_COLOR = '#fbbf24';
const RAW_RAY_FADE_MS = 1000;

const CLASSIFICATION_ICONS: Record<ObjectClassification, { emoji: string; color: string }> = {
  drone:    { emoji: '🚁', color: '#ef4444' },
  airplane: { emoji: '✈️', color: '#3b82f6' },
  bird:     { emoji: '🐦', color: '#10b981' },
  other:    { emoji: '❓', color: '#64748b' },
};

function buildTrackIcon(track: TrackUpdate, borderColor: string): L.DivIcon {
  const { emoji, color } = track.classification
    ? CLASSIFICATION_ICONS[track.classification]
    : { emoji: '❓', color: '#64748b' };

  const html = `<div style="
    width: 28px; height: 28px; border-radius: 50%;
    background: ${color}33;
    border: 2px solid ${borderColor};
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1; cursor: pointer;
    box-shadow: 0 0 6px ${color}66;
  ">${emoji}</div>`;

  return L.divIcon({ html, className: '', iconSize: [28, 28], iconAnchor: [14, 14], tooltipAnchor: [14, 0] });
}

function buildCameraIcon(draggable: boolean): L.DivIcon {
  const size = draggable ? 18 : 12;
  const html = `<div style="
    width: ${size}px; height: ${size}px; border-radius: 50%;
    background: #3b82f6;
    border: 2px solid ${draggable ? '#f59e0b' : '#e2e8f0'};
    box-shadow: 0 0 6px #3b82f699;
    cursor: ${draggable ? 'grab' : 'default'};
  "></div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [size / 2, 0],
  });
}

/** Déplace un point GPS d'une distance (m) dans une direction (cap en degrés). */
function projectLatLng(lat: number, lon: number, bearingDeg: number, distanceM: number): L.LatLngExpression {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(bearingRad)) / EARTH_RADIUS_M;
  const dLon = (distanceM * Math.sin(bearingRad)) / (EARTH_RADIUS_M * Math.cos(latRad));
  return [lat + (dLat * 180) / Math.PI, lon + (dLon * 180) / Math.PI];
}

/** Polygone du cône de champ de vision, directement en GPS. */
function buildFovLatLngs(camera: CameraPosition, segments = 24): L.LatLngExpression[] {
  const points: L.LatLngExpression[] = [[camera.lat, camera.lon]];
  const halfFov = camera.fovDeg / 2;
  for (let i = 0; i <= segments; i++) {
    const bearingDeg = camera.azimuthDeg - halfFov + (camera.fovDeg * i) / segments;
    points.push(projectLatLng(camera.lat, camera.lon, bearingDeg, camera.rangeM));
  }
  return points;
}

function roundCoord(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

interface TrackLayers {
  line: L.Polyline;
  marker: L.Marker;
}

@Component({
  selector: 'app-map',
  imports: [],
  templateUrl: './map.html',
  styleUrl: './map.css',
})
export class MapView implements AfterViewInit, OnDestroy {
  private readonly mapElRef = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');
  private readonly realtime = inject(RealtimeService);
  private readonly trackSelection = inject(TrackSelectionService);
  private readonly cameraConfig = inject(CameraConfigService);
  private readonly notifications = inject(NotificationService);

  // Désactivé par défaut : naviguer sur la carte ne doit pas déplacer une caméra
  readonly cameraDragEnabled = signal(false);
  readonly showRawRays = signal(true);

  private map: L.Map | null = null;
  private centeredOnCameras = false;
  private cameraLayers: L.Layer[] = [];
  private rawRayLayers: L.Polyline[] = [];
  private readonly trackLayers = new Map<string, TrackLayers>();
  private readonly trailsByTrackId = new Map<string, L.LatLngExpression[]>();
  private readonly colorByTrackId = new Map<string, string>();
  private subscription: Subscription | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const cameras = this.realtime.cameras();
      const draggable = this.cameraDragEnabled();
      if (this.map) this.renderCameras(cameras, draggable);
    });
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapElRef().nativeElement, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: MAX_ZOOM,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: MAX_ZOOM,
      maxNativeZoom: TILE_MAX_NATIVE_ZOOM,
    }).addTo(this.map);

    this.renderCameras(this.realtime.cameras(), this.cameraDragEnabled());

    this.subscription = this.realtime.trackUpdates$.subscribe((track) => this.renderTrackUpdate(track));
    this.subscription.add(
      this.realtime.rawDetections$.subscribe((det) => this.renderRawDetection(det)),
    );

    const mapEl = this.mapElRef().nativeElement;
    requestAnimationFrame(() => this.map?.invalidateSize());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
      this.resizeObserver.observe(mapEl);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.subscription?.unsubscribe();
    this.clearRawRays();
    this.map?.remove();
  }

  resetView(): void {
    const cameras = this.realtime.cameras();
    if (this.map && cameras.length) {
      this.map.setView([cameras[0].lat, cameras[0].lon], DEFAULT_ZOOM);
    }
  }

  toggleCameraDrag(): void {
    this.cameraDragEnabled.update((enabled) => !enabled);
  }

  toggleRawRays(): void {
    this.showRawRays.update((enabled) => !enabled);
    if (!this.showRawRays()) this.clearRawRays();
  }

  private clearRawRays(): void {
    this.rawRayLayers.forEach((layer) => layer.remove());
    this.rawRayLayers = [];
  }

  /**
   * Convertit le centroïde pixel d'une détection brute en rayon GPS parti de
   * la caméra, et l'affiche brièvement avec un fondu — sert de retour visuel
   * immédiat et de vérification de calibration (rayons convergents = cible
   * probable, divergents = cap de caméra mal réglé), avant même que la
   * fusion multi-caméra ne soit disponible.
   */
  private renderRawDetection(det: RawDetection): void {
    if (!this.map || !this.showRawRays()) return;
    const camera = this.realtime.cameras().find((c) => c.id === det.cameraId);
    if (!camera) return;

    const offsetFraction = det.x / DETECTION_FRAME_WIDTH - 0.5;
    const bearingDeg = camera.azimuthDeg + offsetFraction * camera.fovDeg;
    const endpoint = projectLatLng(camera.lat, camera.lon, bearingDeg, camera.rangeM);

    const ray = L.polyline([[camera.lat, camera.lon], endpoint], {
      color: RAW_RAY_COLOR,
      weight: 2,
      opacity: 0.75,
      className: 'raw-ray',
    }).addTo(this.map);
    this.rawRayLayers.push(ray);

    // Léger délai pour laisser le premier paint se faire avant de déclencher
    // la transition CSS de fondu (sinon le navigateur peut fusionner les deux
    // changements de style et sauter directement à l'état final).
    setTimeout(() => {
      if (!this.map) return;
      ray.setStyle({ opacity: 0 });
    }, 50);
    setTimeout(() => {
      ray.remove();
      this.rawRayLayers = this.rawRayLayers.filter((l) => l !== ray);
    }, RAW_RAY_FADE_MS);
  }

  private renderCameras(cameras: CameraPosition[], draggable: boolean): void {
    if (!this.map) return;
    // Les positions arrivent du backend après la connexion : centrer une seule fois
    if (!this.centeredOnCameras && cameras.length) {
      this.map.setView([cameras[0].lat, cameras[0].lon], DEFAULT_ZOOM);
      this.centeredOnCameras = true;
    }

    this.cameraLayers.forEach((layer) => layer.remove());
    this.cameraLayers = cameras.flatMap((camera) => {
      const cone = L.polygon(buildFovLatLngs(camera), {
        color: '#3b82f6',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.25,
      }).addTo(this.map!);

      const marker = L.marker([camera.lat, camera.lon], {
        icon: buildCameraIcon(draggable),
        draggable,
      })
        .addTo(this.map!)
        .bindTooltip(camera.id, { permanent: true, direction: 'right' });

      marker.on('drag', () => {
        const { lat, lng } = marker.getLatLng();
        cone.setLatLngs(buildFovLatLngs({ ...camera, lat, lon: lng }));
      });
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        void this.saveDraggedCamera(camera, roundCoord(lat), roundCoord(lng));
      });

      return [cone, marker];
    });
  }

  private async saveDraggedCamera(camera: CameraPosition, lat: number, lon: number): Promise<void> {
    try {
      await this.cameraConfig.updatePosition(camera.id, { lat, lon, alt: camera.alt });
      this.notifications.push('info', `${camera.id} déplacée en ${lat}, ${lon}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.notifications.push('alert', `Position de ${camera.id} non enregistrée : ${reason}`);
      // La liste n'a pas changé : redessiner remet la caméra à sa dernière position enregistrée
      this.renderCameras(this.realtime.cameras(), this.cameraDragEnabled());
    }
  }

  private renderTrackUpdate(track: TrackUpdate): void {
    if (!this.map) return;
    if (!this.colorByTrackId.has(track.trackId)) {
      this.colorByTrackId.set(track.trackId, TRACK_COLORS[this.colorByTrackId.size % TRACK_COLORS.length]);
    }
    const trailColor = this.colorByTrackId.get(track.trackId)!;
    const point: L.LatLngExpression = [track.lat, track.lng];

    const trail = [point, ...(this.trailsByTrackId.get(track.trackId) ?? [])].slice(0, TRAIL_LENGTH);
    this.trailsByTrackId.set(track.trackId, trail);

    let layers = this.trackLayers.get(track.trackId);
    if (!layers) {
      const icon = buildTrackIcon(track, trailColor);
      layers = {
        line: L.polyline(trail, { color: trailColor, weight: 2, opacity: 0.7 }).addTo(this.map),
        marker: L.marker(point, { icon })
          .addTo(this.map)
          .bindTooltip(track.trackId, { permanent: true, direction: 'right' })
          .on('click', () => this.trackSelection.select(track.trackId)),
      };
      this.trackLayers.set(track.trackId, layers);
    } else {
      layers.line.setLatLngs(trail);
      layers.marker.setLatLng(point);
      // Mise à jour de l'icône si la classification change
      layers.marker.setIcon(buildTrackIcon(track, trailColor));
    }
  }
}
