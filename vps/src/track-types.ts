export type TrackVerdict = 'CONFIRMED' | 'FALSE_POSITIVE' | 'UNSURE';
export const TrackVerdict = {
  CONFIRMED: 'CONFIRMED' as TrackVerdict,
  FALSE_POSITIVE: 'FALSE_POSITIVE' as TrackVerdict,
  UNSURE: 'UNSURE' as TrackVerdict,
};

export interface Track {
  id: string;
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  classification?: string | null;
  timestampUs: number;
  receivedAt: Date | string;
  verdict?: TrackVerdict | null;
  verdictNote?: string | null;
  verdictBy?: string | null;
  verdictAt?: Date | string | null;
}
