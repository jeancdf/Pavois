/** Position GPS d'une caméra (utilisée directement pour l'affichage sur la carte Leaflet). */
export interface CameraPosition {
  id: string;
  lat: number;
  lon: number;
  azimuthDeg: number;
  fovDeg: number;
  rangeM: number;
}
