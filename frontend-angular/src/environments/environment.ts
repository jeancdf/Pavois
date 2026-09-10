declare global {
  interface Window {
    __PAVOIS_ENV__?: {
      apiUrl?: string;
      wsBaseUrl?: string;
      devToken?: string;
    };
  }
}

const browserWindow = typeof window !== 'undefined' ? window : undefined;
const runtimeEnv = browserWindow?.__PAVOIS_ENV__;
const origin = browserWindow?.location?.origin ?? 'http://localhost:8080';
const fallbackApiUrl = `${origin}/api`;
const originUrl = new URL(origin);
const fallbackWsBaseUrl = `${originUrl.protocol === 'https:' ? 'wss' : 'ws'}://${originUrl.hostname}:3002`;
const isLocalhost = ['localhost', '127.0.0.1'].includes(originUrl.hostname);
const fallbackDevToken = isLocalhost ? 'dev-pavois-token' : '';

function resolveRuntimeValue(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export const environment = {
  production: false,
  apiUrl: resolveRuntimeValue(runtimeEnv?.apiUrl, fallbackApiUrl),
  // URL de base sans token — le token est injecté dynamiquement par AuthService
  wsBaseUrl: resolveRuntimeValue(runtimeEnv?.wsBaseUrl, fallbackWsBaseUrl),
  // Token de dev pré-rempli automatiquement en local pour éviter de saisir à
  // chaque démarrage. Ne jamais mettre de valeur ici en production.
  devToken: resolveRuntimeValue(runtimeEnv?.devToken, fallbackDevToken),
  // Origine du repère local ENU : ancienne position GPS de cam0. Les positions des
  // caméras viennent désormais du backend (événement `camera_positions`).
  geoOrigin: { lat: 48.82608, lng: 2.3659, alt: 58.52 },
};
