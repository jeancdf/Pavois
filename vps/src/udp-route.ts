import { parseAttitudeLine, type AttitudePacket } from './udp-attitude';
import { parseDetectorConfigLine, type DetectorReport } from './udp-config';
import { parseRawDetectionLine, type RawDetection } from './udp-raw';
import { parseCameraStatsLine, type CameraStats } from './udp-stats';

/** GPS track from an `obj*` CSV line, broadcast as track_update. */
export type UdpObjTrack = {
  type: 'track_update';
  trackId: string;
  lat: number;
  lng: number;
  alt: number;
  timestamp: number;
  classification?: string;
};

/**
 * Result of classifying one UDP payload line.
 * unknown.data is JSON.parse output, or null if the line is not JSON.
 * drop: att with >=6 fields that failed to parse; do not broadcast.
 */
export type RoutedUdp =
  | { kind: 'att'; attitude: AttitudePacket }
  | { kind: 'raw'; detection: RawDetection }
  | { kind: 'stats'; stats: CameraStats }
  | { kind: 'cfg'; report: DetectorReport }
  | { kind: 'obj'; track: UdpObjTrack }
  | { kind: 'unknown'; raw: string; data: unknown }
  | { kind: 'drop' };

function toNumber(value: string): number {
  return parseFloat(value);
}

function toOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseObjLine(parts: string[]): UdpObjTrack | null {
  if (!parts[0]?.startsWith('obj') || parts.length < 5) {
    return null;
  }
  const track: UdpObjTrack = {
    type: 'track_update',
    trackId: parts[0],
    lat: toNumber(parts[1]),
    lng: toNumber(parts[2]),
    alt: toNumber(parts[3]),
    timestamp: toNumber(parts[4]),
  };
  const classification = toOptionalString(parts[5]);
  if (classification !== undefined) {
    track.classification = classification;
  }
  return track;
}

function parseUnknown(trimmed: string): {
  kind: 'unknown';
  raw: string;
  data: unknown;
} {
  try {
    return {
      kind: 'unknown',
      raw: trimmed,
      data: JSON.parse(trimmed),
    };
  } catch {
    return { kind: 'unknown', raw: trimmed, data: null };
  }
}

/** Classifies a trimmed UDP CSV/JSON line. HMAC stays in UdpService. */
export function routeUdpLine(line: string): RoutedUdp {
  const trimmed = line.trim();
  const parts = trimmed.split(',');

  if (parts[0] === 'att' && parts.length >= 6) {
    const attitude = parseAttitudeLine(trimmed);
    if (!attitude) {
      return { kind: 'drop' };
    }
    return { kind: 'att', attitude };
  }

  const stats = parseCameraStatsLine(trimmed);
  if (stats) {
    return { kind: 'stats', stats };
  }

  const report = parseDetectorConfigLine(trimmed);
  if (report) {
    return { kind: 'cfg', report };
  }

  const detection = parseRawDetectionLine(trimmed);
  if (detection) {
    return { kind: 'raw', detection };
  }

  if (parts[0]?.startsWith('obj') && parts.length >= 5) {
    const track = parseObjLine(parts);
    if (track) {
      return { kind: 'obj', track };
    }
  }

  return parseUnknown(trimmed);
}
