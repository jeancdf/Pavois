import { AfterViewInit, Component, ElementRef, OnDestroy, effect, inject, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { CameraPosition } from '../../models/world-position.model';
import { TrackUpdate } from '../../models/track-update.model';

const EARTH_RADIUS_M = 6371000;
const TRAIL_LENGTH = 30;
// Niveau de zoom natif max des tuiles OpenStreetMap : au-delà, Leaflet
// agrandit numériquement les tuiles (flou) mais les cônes/marqueurs restent
// nets et s'écartent visuellement — utile pour un test à l'échelle d'une
// pièce (quelques mètres) où la résolution native (~20 cm/px à z19) est trop
// grossière pour bien distinguer les positions.
const TILE_MAX_NATIVE_ZOOM = 19;
const MAX_ZOOM = 23;
const DEFAULT_ZOOM = 21;
const TRACK_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fb7185'];

/** Déplace un point GPS d'une distance (m) dans une direction (cap en degrés). */
function projectLatLng(lat: number, lon: number, bearingDeg: number, distanceM: number): L.LatLngExpression {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(bearingRad)) / EARTH_RADIUS_M;
  const dLon = (distanceM * Math.sin(bearingRad)) / (EARTH_RADIUS_M * Math.cos(latRad));
  return [lat + (dLat * 180) / Math.PI, lon + (dLon * 180) / Math.PI];
}

/** Polygone du cône de champ de vision, directement en GPS (cf. PLAN.md buildFovPolygon). */
function buildFovLatLngs(camera: CameraPosition, segments = 24): L.LatLngExpression[] {
  const points: L.LatLngExpression[] = [[camera.lat, camera.lon]];
  const halfFov = camera.fovDeg / 2;
  for (let i = 0; i <= segments; i++) {
    const bearingDeg = camera.azimuthDeg - halfFov + (camera.fovDeg * i) / segments;
    points.push(projectLatLng(camera.lat, camera.lon, bearingDeg, camera.rangeM));
  }
  return points;
}

/** Point juste derrière la caméra (direction opposée à son cap), pour poser l'étiquette
 *  sans qu'elle ne recouvre le champ de vision. */
function behindCameraPoint(camera: CameraPosition, distanceM = 1.5): L.LatLngExpression {
  return projectLatLng(camera.lat, camera.lon, camera.azimuthDeg + 180, distanceM);
}

interface TrackLayers {
  line: L.Polyline;
  marker: L.CircleMarker;
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

    // Le conteneur n'a pas forcément sa taille finale au moment où Leaflet
    // s'initialise (la mise en page flex se stabilise après ce premier rendu),
    // ce qui fait que les tuiles se positionnent mal ("bouts de carte"
    // dispersés). On force un recalcul une fois la mise en page posée, puis à
    // chaque redimensionnement du conteneur.
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

      // Étiquette posée juste derrière la caméra (côté opposé au cap), pour
      // ne pas recouvrir le champ de vision qu'elle représente.
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
    const color = this.colorByTrackId.get(track.trackId)!;
    const point: L.LatLngExpression = [track.lat, track.lng];

    const trail = [point, ...(this.trailsByTrackId.get(track.trackId) ?? [])].slice(0, TRAIL_LENGTH);
    this.trailsByTrackId.set(track.trackId, trail);

    let layers = this.trackLayers.get(track.trackId);
    if (!layers) {
      layers = {
        line: L.polyline(trail, { color, weight: 2, opacity: 0.7 }).addTo(this.map),
        marker: L.circleMarker(point, { radius: 6, color, fillColor: color, fillOpacity: 1 })
          .addTo(this.map)
          .bindTooltip(track.trackId, { permanent: true, direction: 'right' }),
      };
      this.trackLayers.set(track.trackId, layers);
    } else {
      layers.line.setLatLngs(trail);
      layers.marker.setLatLng(point);
    }
  }
}
