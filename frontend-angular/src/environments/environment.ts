declare global {
  interface Window {
    __PAVOIS_ENV__?: {
      apiUrl?: string;
      wsBaseUrl?: string;
    };
  }
}

const browserWindow = typeof window !== 'undefined' ? window : undefined;
const runtimeEnv = browserWindow?.__PAVOIS_ENV__;
const origin = browserWindow?.location?.origin ?? 'http://localhost:8080';
const fallbackApiUrl = `${origin}/api`;
const originUrl = new URL(origin);
const wsScheme = originUrl.protocol === 'https:' ? 'wss' : 'ws';
// Same host:port as the page; Nginx proxies /ws to Nest.
const fallbackWsBaseUrl = `${wsScheme}://${originUrl.host}/ws`;

function resolveRuntimeValue(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export const environment = {
  production: false,
  apiUrl: resolveRuntimeValue(runtimeEnv?.apiUrl, fallbackApiUrl),
  wsBaseUrl: resolveRuntimeValue(runtimeEnv?.wsBaseUrl, fallbackWsBaseUrl),
  // Origine du repère local ENU : ancienne position GPS de cam0. Les positions des
  // caméras viennent désormais du backend (événement `camera_positions`).
  geoOrigin: { lat: 48.82608, lng: 2.3659, alt: 58.52 },
};
