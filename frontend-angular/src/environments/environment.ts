export const environment = {
  production: false,
  apiUrl: 'http://192.168.137.1:3000',
  // URL de base sans token — le token est injecté dynamiquement par AuthService
  wsBaseUrl: 'ws://192.168.137.8:3000',
  // Token de dev pré-rempli automatiquement en local pour éviter de saisir à
  // chaque démarrage. Ne jamais mettre de valeur ici en production.
  devToken: 'dev-pavois-token',
  // Origine du repère local ENU : position GPS réelle de cam0 (cf.
  // app/config/cameras.config.ts). cam0 se retrouve donc exactement à (0,0).
  geoOrigin: { lat: 48.82608, lng: 2.3659, alt: 58.52 },
};
