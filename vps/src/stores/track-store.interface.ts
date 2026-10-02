import { Track, TrackVerdict } from '../track-types';

export interface CreateTrackData {
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  classification?: string | null;
  timestampUs: number;
}

export interface UpdateTrackVerdictData {
  verdict: TrackVerdict;
  verdictNote?: string | null;
  verdictBy?: string | null;
}

export interface ListTracksOptions {
  limit?: number;
}

export const TRACK_STORE = Symbol('TRACK_STORE');

export interface TrackStore {
  create(data: CreateTrackData): Promise<Track>;
  findMany(options?: ListTracksOptions): Promise<Track[]>;
  findUnique(id: string): Promise<Track | null>;
  updateVerdict(id: string, data: UpdateTrackVerdictData): Promise<Track | null>;
}
