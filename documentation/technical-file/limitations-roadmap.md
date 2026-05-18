# Limites et feuille de route

Ce fichier liste les limites connues et les prochaines étapes importantes.

## Limites actuelles

### Détection et localisation

- Une seule caméra ne résout pas la profondeur. Elle sert surtout à tester le
  pipeline.
- Le détecteur de mouvement C++ est une différence d'images simple.
- Les vibrations, ombres, changements de lumière et mouvements d'arrière-plan
  peuvent créer des faux positifs.
- La localisation multi-caméras exige une calibration précise qui n'est pas
  encore complète.
- Le chemin C++ contient une variable d'atténuation avec la distance, mais elle
  n'est pas encore appliquée à l'accumulation.
- La prévisualisation temps réel échantillonne les rayons au lieu d'utiliser le
  DDA exact.

### Suivi

- Le moteur de détection n'extrait pas encore de clusters depuis la grille voxel.
- Il n'y a pas encore de filtre de Kalman de production.
- Les identifiants de piste dans l'interface sont simulés.
- La classification drone/oiseau n'est pas implémentée.

### Intégration frontend

- Le frontend utilise actuellement `pavoisSim.ts` comme source de données.
- Aucun flux backend réel ne connecte encore le détecteur à l'interface.
- Le repère de simulation et le repère ENU du prototype doivent être unifiés ou
  reliés par une conversion claire.

### Validation scientifique

- L'erreur de localisation n'est pas encore documentée avec une vérité terrain.
- Le taux de faux positifs n'est pas encore mesuré sur des scènes réalistes.
- Les performances ne sont pas encore benchmarkées systématiquement.

## Feuille de route prioritaire

### 1. Calibration

Ajouter :

- Intrinsèques : focale, point principal, distorsion.
- Extrinsèques : position et orientation dans un repère ENU commun.
- Procédure de validation avec cible ou mire.

Pourquoi :

L'erreur de calibration devient directement une erreur de localisation.

### 2. Test réel à deux caméras

Construire une expérience reproductible :

- Base connue entre caméras.
- Positions cible mesurées.
- Images synchronisées.
- Métadonnées et images sauvegardées.

Livrable :

- Tableau d'erreur de localisation selon distance et taille voxel.

### 3. Extraction de clusters voxel

Implémenter :

- Seuillage.
- Composantes connexes.
- Barycentre pondéré.
- Score de preuve.
- Nombre de caméras contributrices.
- Estimation de covariance.

Cette étape transforme la grille en mesures 3D exploitables.

### 4. Gestionnaire de pistes

Implémenter :

- Filtre de Kalman à vitesse constante.
- Association mesure-piste.
- États tentative, confirmée et perdue.
- Règles de création et suppression de piste.
- Mise à jour de confiance.

### 5. Flux backend

Ajouter un service qui émet :

- État des caméras.
- Mesures 3D.
- Pistes.
- Alertes.
- Historique replay.

Le frontend devrait consommer ces événements via WebSocket ou Server-Sent Events.

### 6. Classification

À ajouter après stabilisation du suivi :

- Caractéristiques de mouvement.
- Classifieur visuel sur crops.
- Séparation drone, oiseau, personne, véhicule.
- Calibration de confiance.

### 7. Performance

Améliorer :

- Grille voxel sparse.
- Décroissance temporelle stable.
- Kernels GPU ou chemin PyTorch optimisé.
- Batching des rayons par caméra.
- Sélection adaptative des pixels candidats.

## Ce qu'il ne faut pas prétendre trop tôt

Ne pas affirmer :

- capacité opérationnelle de défense anti-drone ;
- classification validée ;
- suivi multi-cibles fiable ;
- intégration Lattice fonctionnelle ;
- précision terrain prouvée.

Sauf si ces éléments sont effectivement implémentés et mesurés.

Formulation prudente actuelle :

```text
PAVOIS démontre le mécanisme logiciel de projection de mouvement optique dans
une grille voxel 3D partagée, ainsi qu'une interface de visualisation de
couverture et de pistes simulées.
```

Formulation plus forte après validation :

```text
Dans des essais contrôlés à deux caméras, PAVOIS localise des cibles aériennes
avec une erreur mesurée de X mètres à Y mètres de distance, à une performance de
Z images par seconde.
```

