# Algorithmes

Ce fichier décrit les algorithmes principaux du prototype actuel et ceux qui
seront nécessaires pour obtenir un système complet.

## Pipeline pixel-vers-voxel par lot

Implémenté principalement dans `pixeltovoxelprojector/ray_voxel.cpp`.

```text
Entrée :
  metadata.json
  dossier d'images
  chemin du fichier voxel_grid.bin

Étapes :
  1. Charger les métadonnées.
  2. Grouper les images par camera_index.
  3. Trier les images de chaque caméra par frame_index.
  4. Créer une grille voxel partagée N x N x N.
  5. Pour chaque caméra :
       a. Charger deux images consécutives en niveaux de gris.
       b. Calculer la différence absolue.
       c. Seuiler les pixels en mouvement.
       d. Pour chaque pixel mobile :
            i. Convertir le pixel en rayon caméra.
           ii. Transformer le rayon dans le repère monde.
          iii. Intersecter le rayon avec la grille.
           iv. Parcourir les voxels traversés par DDA.
            v. Ajouter le score de mouvement aux voxels.
  6. Écrire la grille voxel dans un fichier binaire.
  7. Écrire les métadonnées de visualisation.
```

## Détection de mouvement

Règle de base :

```text
diff = abs(image_courante - image_précédente)
motion = diff > threshold
```

La prévisualisation temps réel ajoute des options de réduction du bruit :

- Flou gaussien.
- Filtre bilatéral.
- Lissage temporel.
- Filtre médian sur la différence.
- Ouverture morphologique pour supprimer les pixels isolés.
- Fermeture morphologique pour connecter des fragments.
- Filtrage par taille de composante connexe.
- Soustraction de fond MOG2.
- Vote local 3x3 pour rejeter le bruit isolé.

Dans un article, il faut distinguer la méthode minimale des filtres pratiques.

## Parcours voxel DDA

Implémenté dans `cast_ray_into_grid`.

Le DDA parcourt les voxels dans l'ordre où le rayon traverse leurs frontières.

```text
Entrée :
  position caméra
  direction de rayon normalisée
  bornes de grille
  taille voxel

Étapes :
  1. Intersecter le rayon avec la boîte de la grille.
  2. Calculer le voxel de départ au point d'entrée.
  3. Déterminer le sens de déplacement sur x, y et z.
  4. Calculer le prochain temps de passage de frontière pour chaque axe.
  5. Répéter :
       a. Émettre le voxel courant.
       b. Avancer sur l'axe dont la frontière est la plus proche.
       c. Arrêter si le rayon sort de la grille ou dépasse t_exit.
```

L'intérêt du DDA est de ne visiter que les voxels effectivement traversés.

## Prévisualisation temps réel

Implémentée dans `pixeltovoxelprojector/realtime_voxel_preview.py`.

Le chemin temps réel utilise une accumulation vectorisée avec PyTorch :

```text
Pour chaque image :
  1. Lire l'image caméra.
  2. Construire un masque de mouvement.
  3. Sélectionner les pixels mobiles, avec limite max-rays si nécessaire.
  4. Utiliser les directions de rayons pré-calculées.
  5. Intersecter les rayons avec la grille voxel.
  6. Échantillonner un nombre fixe de points sur chaque rayon.
  7. Convertir les points en indices voxel.
  8. Ajouter les scores dans un tenseur voxel plat avec scatter_add.
  9. Appliquer une décroissance temporelle.
 10. Afficher les projections maximales XY, XZ et YZ.
```

Ce chemin n'est pas exactement identique au DDA C++. Il échantillonne les rayons
pour être plus simple à vectoriser sur GPU.

## Couverture caméra

Implémentée dans `PAVOISSim.getCoveragePolygon`.

```text
Entrée :
  position caméra
  azimut
  champ de vision
  portée

Étapes :
  1. Démarrer le polygone à la position de la caméra.
  2. Balayer de azimut - FOV/2 à azimut + FOV/2.
  3. Ajouter des points d'arc à portée maximale.
  4. Utiliser le polygone pour l'affichage et le test de détection simulé.
```

Le test simulé vérifie :

- caméra non hors service ;
- cible dans la portée ;
- angle cible dans le demi-champ de vision.

## Interpolation des pistes simulées

Implémentée dans `PAVOISSim.lerpPos`.

Une piste est une suite de points :

```text
waypoint = { x, y, z, t }
```

La position à un temps `t` est interpolée linéairement entre les deux points
voisins. La vitesse est estimée par différence finie :

```text
v = (p(t + dt) - p(t)) / dt
```

## Prédiction

La prédiction actuelle est une extrapolation à vitesse constante :

```text
p_future(t + h) = p(t) + v(t) * h
```

Elle est utile pour l'interface mais insuffisante pour des cibles très
manoeuvrantes. Une version réelle devrait utiliser un filtre de Kalman ou un
modèle de mouvement plus robuste.

## Extraction future de clusters

Un système complet doit convertir la grille voxel en mesures 3D :

```text
Entrée :
  grille de preuve E

Étapes :
  1. Normaliser ou lisser E.
  2. Seuiler E au-dessus de lambda.
  3. Trouver les composantes connexes en 3D.
  4. Supprimer les petites composantes.
  5. Calculer barycentre pondéré et covariance.
  6. Envoyer les mesures au gestionnaire de pistes.
```

Sortie proposée :

```text
measurement = {
  position_m: [x, y, z],
  covariance: 3x3,
  confidence: float,
  supporting_cameras: string[]
}
```

## Gestion future des pistes

Boucle recommandée :

```text
Pour chaque pas de temps :
  1. Prédire les pistes existantes.
  2. Associer les mesures voxel aux pistes.
  3. Corriger les pistes associées.
  4. Créer des pistes temporaires pour les mesures non associées.
  5. Confirmer une piste après plusieurs observations.
  6. Marquer les pistes absentes comme perdues après timeout.
  7. Envoyer les pistes confirmées à l'interface.
```

