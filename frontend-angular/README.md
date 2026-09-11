# Frontend Angular (PAVOIS)

Interface opérateur. Générée avec Angular CLI 22.

## Serveur mock (deux modes)

Le mock (`mock-server/server.mjs`) n’est **pas** le VPS. Il pousse des
événements WebSocket pour travailler l’UI hors des trois Pi.

| Mode | Commande | Ce qu’il émet | Reflète la production ? |
|---|---|---|---|
| **demo** (défaut) | `npm run mock:ws` | `imu_update`, `raw_detection`, **`track_update` classées**, previews | Non. Pistes fictives toutes les 200 ms. |
| **terrain** | `npm run mock:ws:terrain` | `imu_update` + `raw_detection` des Pi jean / tanel / walid | **Oui.** Une Pi n’envoie pas de piste 3D. La carte reste à PISTES 0. |

Lancer l’UI contre le mock :

```bash
npm run mock:ws            # ou mock:ws:terrain
npm run start:mock         # http://localhost:4200 → ws://localhost:3000
```

`MOCK_MODE=terrain` active le profil réel. Le mode demo sert au design
(icônes, alertes, liste de pistes). Ne pas s’en servir pour juger que la
fusion marche.

## Development server

Contre le vrai backend (VPS) :

```bash
npm start
```

Puis ouvrir `http://localhost:4200/`.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
