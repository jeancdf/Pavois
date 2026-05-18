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

3. [Modèle mathématique](mathematical-model.md)
   - Repères, projection caméra, équation de rayon, indexation voxel, score de
     mouvement, fusion multi-caméras et base du suivi.

4. [Algorithmes](algorithms.md)
   - Description étape par étape de la différence d'images, du lancer de rayon,
     du parcours voxel, de l'accumulation temps réel, de la couverture et de la
     prédiction.

5. [Architecture d'implémentation](implementation-architecture.md)
   - Organisation du code actuel et rôle des parties C++/Python et
     React/Cesium.

6. [Formats de données](data-formats.md)
   - `metadata.json`, fichier voxel binaire, types de simulation et contrats de
     données proposés pour l'intégration future.

7. [Expériences et validation](experiments-validation.md)
   - Comment tester le système, quelles métriques publier et quelles bases de
     comparaison utiliser.

8. [Limites et feuille de route](limitations-roadmap.md)
   - Limites connues, questions ouvertes et prochaines étapes prioritaires.

## État actuel du projet

PAVOIS contient actuellement deux grands blocs :

- Un prototype de détection optique dans `pixeltovoxelprojector/`. Il détecte
  les pixels en mouvement, les projette sous forme de rayons 3D, puis accumule
  cette preuve dans une grille voxel. La version C++ produit un volume voxel sur
  disque. La version Python temps réel utilise OpenCV, NumPy et PyTorch pour
  afficher une prévisualisation.

- Une interface opérateur React/Vite/Cesium dans `frontend/`. Elle visualise des
  caméras simulées, des secteurs de couverture, des pistes, des alertes et un
  mode replay.

Certaines notes de planification parlent d'Angular, Django ou d'intégration
Lattice. Dans la documentation scientifique, ces éléments doivent être présentés
comme des objectifs futurs tant qu'ils ne sont pas présents dans le code actuel.

