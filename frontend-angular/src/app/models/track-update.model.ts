/** Position 3D d'une piste, telle qu'envoyée par le backend (GPS, pas le repère local). */
export interface TrackUpdate {
  type: string;
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  timestamp: number;
}
