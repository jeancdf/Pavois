/** Nominal UDP traffic is silent unless UDP_VERBOSE=true (or 1). */

export function isUdpVerbose(): boolean {
  const raw = process.env.UDP_VERBOSE ?? '';
  return raw === 'true' || raw === '1';
}

export function udpDebug(message: string, extra?: unknown): void {
  if (!isUdpVerbose()) {
    return;
  }
  if (extra === undefined) {
    console.log(message);
    return;
  }
  console.log(message, extra);
}
