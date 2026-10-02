/**
 * UDP: cfg,<cameraId>,<ts_us>,<version>,<key>=<value>,...
 * What a detector really runs: the version of its live settings (0 = its own
 * config file), then the frame size and every live setting as key=value.
 */

export interface DetectorReport {
  type: 'detector_config';
  cameraId: string;
  timestamp: number;
  version: number;
  values: Record<string, number>;
}

export function parseDetectorConfigLine(line: string): DetectorReport | null {
  const parts = line.trim().split(',');
  if (parts[0] !== 'cfg' || parts.length < 4) return null;

  const cameraId = parts[1];
  const timestamp = Number(parts[2]);
  const version = Number(parts[3]);
  if (
    !cameraId ||
    !Number.isFinite(timestamp) ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    return null;
  }

  const values: Record<string, number> = {};
  for (const field of parts.slice(4)) {
    const eq = field.indexOf('=');
    if (eq <= 0) continue;
    const value = Number(field.slice(eq + 1));
    if (field.length > eq + 1 && Number.isFinite(value)) {
      values[field.slice(0, eq)] = value;
    }
  }
  return { type: 'detector_config', cameraId, timestamp, version, values };
}
