# Documentation PAVOIS

Ce dossier documente PAVOIS comme un projet scientifique et technique. Il est
destiné à un chercheur, un ingénieur ou un développeur qui doit comprendre le
problème, les hypothèses, les mathématiques, les algorithmes et l'état réel de
l'implémentation.

## Ordre de lecture conseillé

1. [Guide pour l'article scientifique](scientific-paper-guide.md)
   - Comment transformer le projet en article technique ou scientifique.
   - Quoi mettre dans l'introduction, les méthodes, la partie mathématique, les
     expériences, les résultats et les limites.

2. [Vue d'ensemble du système](system-overview.md)
   - Vision globale : caméras, détection de mouvement, projection de rayons,
     fusion voxel, pistes, alertes et visualisation.

3. [Modèle mathématique](technical-file/mathematical-model.md)
   - Repères, projection caméra, équation de rayon, indexation voxel, score de
     mouvement, fusion multi-caméras et base du suivi.

4. [Algorithmes](technical-file/algorithms.md)
   - Description étape par étape de la différence d'images, du lancer de rayon,
     du parcours voxel, de l'accumulation temps réel, de la couverture et de la
     prédiction.

5. [Architecture d'implémentation](technical-file/implementation-architecture.md)
   - Organisation du code actuel et rôle des parties C++/Python et frontend.
     Certains détails datent de l'ancien frontend React/Cesium (retiré,
     SCRUM-74) et restent à mettre à jour.

5b. [Où se rencontrent les trois caméras](fusion-emplacement.md)
   - Décision SCRUM-56 : la fusion 3D s'exécute sur le VPS, pas sur une
     Pi maîtresse ni dans un binaire C++ à part.

6. [Formats de données](technical-file/data-formats.md)
   - `metadata.json`, fichier voxel binaire, types de simulation et contrats de
     données proposés pour l'intégration future.

7. [Expériences et validation](technical-file/experiments-validation.md)
   - Comment tester le système, quelles métriques publier et quelles bases de
     comparaison utiliser.

8. [Limites et feuille de route](technical-file/limitations-roadmap.md)
   - Limites connues, questions ouvertes et prochaines étapes prioritaires.

## État actuel du projet

PAVOIS est aujourd'hui composé de trois parties en production (voir le
[README racine](../README.md)) : le détecteur C++ `pavois++/` sur chaque Pi,
le backend NestJS `vps/`, et l'interface opérateur Angular
`frontend-angular/` (carte, pistes, alertes, panneau latéral IMU).

`pixeltovoxelprojector/` reste un prototype de détection optique séparé,
antérieur à `pavois++` : il détecte les pixels en mouvement, les projette
sous forme de rayons 3D et accumule cette preuve dans une grille voxel
(version C++ vers disque, version Python temps réel avec OpenCV/NumPy/PyTorch
pour prévisualisation). Il n'est pas branché sur le pipeline `pavois++` → `vps`.

L'ancien frontend React/Vite/Cesium a été retiré de `main` (SCRUM-74),
archivé sur `archive/frontend-react-vite-cesium`.

## Autres documents

- [Intégration UDP → WebSocket](udp-integration.md) — protocole, événements
  temps réel et sécurisation du pont `pavois++` → `vps` → frontend.
- [analysis/](analysis/) — analyses HTML autonomes (couverture caméra,
  détection drone, usage militaire), déplacées ici depuis la racine.
- [PLAN.md](PLAN.md) et [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) — plan de
  projet et synthèse historiques, datés ; utiles pour le contexte, pas comme
  état actuel (voir [limitations-roadmap.md](limitations-roadmap.md) pour
  l'état vérifié).

