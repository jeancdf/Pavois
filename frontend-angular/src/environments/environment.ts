export const environment = {
  production: false,
  // Backend du collègue, sur le même réseau WiFi (pas localhost : c'est une
  // autre machine).
  apiUrl: 'http://192.168.137.1:3000',
  wsUrl: 'ws://192.168.137.8:3000?token=dev-pavois-token',
  // Origine du repère local ENU : position GPS réelle de cam0 (cf.
  // app/config/cameras.config.ts). cam0 se retrouve donc exactement à (0,0).
  geoOrigin: { lat: 48.82608, lng: 2.3659, alt: 58.52 },
};
