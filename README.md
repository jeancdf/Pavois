# P.A.V.O.I.S.

Frontend canonique : **`frontend-angular/`** (Angular 22, signaux, serveur mock intégré).

L'ancien frontend React + Vite + Cesium a été retiré de `main` et archivé sur la
branche `archive/frontend-react-vite-cesium`.

## Lancer le frontend

```bash
cd frontend-angular
npm install
npm start              # ng serve, configuration development
```

Sans backend disponible, utiliser le serveur mock à la place :

```bash
npm run mock:ws        # sert des données WebSocket simulées
npm run start:mock     # dans un second terminal, ng serve en configuration mock
```
