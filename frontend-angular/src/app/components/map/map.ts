import { AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { TrackSelectionService } from '../../services/track-selection.service';
import { CameraPosition } from '../../models/world-position.model';
import { ObjectClassification, TrackUpdate } from '../../models/track-update.model';

const EARTH_RADIUS_M = 6371000;
const TRAIL_LENGTH = 30;
const TILE_MAX_NATIVE_ZOOM = 19;
const MAX_ZOOM = 23;
const DEFAULT_ZOOM = 21;
const TRACK_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fb7185'];

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

function behindCameraPoint(camera: CameraPosition, distanceM = 1.5): L.LatLngExpression {
  return projectLatLng(camera.lat, camera.lon, camera.azimuthDeg + 180, distanceM);
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

  private map: L.Map | null = null;
  private cameraLayers: L.Layer[] = [];
  private readonly trackLayers = new Map<string, TrackLayers>();
  private readonly trailsByTrackId = new Map<string, L.LatLngExpression[]>();
  private readonly colorByTrackId = new Map<string, string>();
  private subscription: Subscription | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const cameras = this.realtime.cameras();
      if (this.map) this.renderCameras(cameras);
    });
  }

  ngAfterViewInit(): void {
    const cameras = this.realtime.cameras();
    const center: L.LatLngExpression = cameras.length ? [cameras[0].lat, cameras[0].lon] : [48.8566, 2.3522];

    this.map = L.map(this.mapElRef().nativeElement, { center, zoom: DEFAULT_ZOOM, maxZoom: MAX_ZOOM });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: MAX_ZOOM,
      maxNativeZoom: TILE_MAX_NATIVE_ZOOM,
    }).addTo(this.map);

    this.renderCameras(cameras);

    this.subscription = this.realtime.trackUpdates$.subscribe((track) => this.renderTrackUpdate(track));

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
    this.map?.remove();
  }

  resetView(): void {
    const cameras = this.realtime.cameras();
    if (this.map && cameras.length) {
      this.map.setView([cameras[0].lat, cameras[0].lon], DEFAULT_ZOOM);
    }
  }

  private renderCameras(cameras: CameraPosition[]): void {
    if (!this.map) return;
    this.cameraLayers.forEach((layer) => layer.remove());
    this.cameraLayers = cameras.flatMap((camera) => {
      const cone = L.polygon(buildFovLatLngs(camera), {
        color: '#3b82f6',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.25,
      }).addTo(this.map!);

      const label = L.circleMarker(behindCameraPoint(camera), {
        radius: 4,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 1,
      })
        .addTo(this.map!)
        .bindTooltip(camera.id, { permanent: true, direction: 'center' });

      return [cone, label];
    });
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
