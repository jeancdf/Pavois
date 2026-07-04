/** Conversion GPS (lat/lng) vers le repère local ENU en mètres (X=Est, Y=Nord). */

const EARTH_RADIUS_M = 6371000;

export interface GeoOrigin {
  lat: number;
  lng: number;
  alt: number;
}

export function llaToLocalEnu(
  lat: number,
  lng: number,
  alt: number,
  origin: GeoOrigin,
): { x: number; y: number; z: number } {
  const x =
    (lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180) * EARTH_RADIUS_M * (Math.PI / 180);
  const y = (lat - origin.lat) * EARTH_RADIUS_M * (Math.PI / 180);
  const z = alt - origin.alt;
  return { x, y, z };
}
