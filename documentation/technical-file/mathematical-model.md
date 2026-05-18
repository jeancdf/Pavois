# Modèle mathématique

Ce fichier rassemble les équations minimales nécessaires pour reproduire la
méthode PAVOIS.

## Repères

Le repère monde local utilisé par le prototype est de type ENU :

```text
X = Est
Y = Nord
Z = Haut
```

Un point 3D est noté :

```text
p = [x, y, z]^T
```

La position d'une caméra est :

```text
c = [c_x, c_y, c_z]^T
```

Son orientation est définie par :

```text
yaw, pitch, roll
```

L'implémentation actuelle construit la matrice :

```text
R = Rz(yaw) * Ry(roll) * Rx(pitch)
```

où `R` transforme une direction du repère caméra vers le repère monde.

## Projection d'un pixel vers un rayon

Pour une image de largeur `W`, hauteur `H`, champ de vision horizontal `theta` et
pixel `(u, v)`, la focale en pixels est :

```text
f = (W / 2) / tan(theta / 2)
```

La direction brute dans le repère caméra est :

```text
d_cam_raw = [
  u - W / 2,
 -(v - H / 2),
 -f
]^T
```

On normalise :

```text
d_cam = d_cam_raw / ||d_cam_raw||
```

Puis on passe dans le repère monde :

```text
d_world = normalize(R * d_cam)
```

Le rayon associé au pixel est :

```text
r(t) = c + t * d_world,  t >= 0
```

## Score de mouvement

Le chemin C++ utilise une différence absolue en niveaux de gris :

```text
Delta_i(u, v) = |I_i(u, v) - I_{i-1}(u, v)|
```

Un pixel est considéré comme mobile si :

```text
M_i(u, v) = 1 si Delta_i(u, v) > tau
          = 0 sinon
```

où `tau` est le seuil de mouvement.

Le score actuel ajouté à la grille voxel est simplement :

```text
s_i(u, v) = Delta_i(u, v)
```

## Grille voxel

La grille est un cube défini par :

```text
N = nombre de cellules par axe
h = taille d'un voxel en mètres
g = centre de la grille
```

Les bornes dans le repère monde sont :

```text
grid_min = g - (N * h / 2)
grid_max = g + (N * h / 2)
```

Un point `p` est converti en indices voxel :

```text
i_x = floor((p_x - grid_min_x) / h)
i_y = floor((p_y - grid_min_y) / h)
i_z = floor((p_z - grid_min_z) / h)
```

L'index linéaire utilisé par le code est :

```text
idx = i_x * N * N + i_y * N + i_z
```

## Intersection rayon-boîte

Avant de parcourir la grille, le rayon est intersecté avec la boîte englobante de
la grille voxel. Pour chaque axe `a` :

```text
t_1a = (grid_min_a - c_a) / d_a
t_2a = (grid_max_a - c_a) / d_a
t_near_a = min(t_1a, t_2a)
t_far_a  = max(t_1a, t_2a)
```

Entrée et sortie :

```text
t_enter = max(0, max_a(t_near_a))
t_exit  = min_a(t_far_a)
```

Le rayon touche la grille si :

```text
t_enter <= t_exit
```

## Accumulation voxel

Pour un rayon issu d'un pixel mobile, soit `V(r)` l'ensemble des voxels traversés
par le rayon. La mise à jour actuelle est :

```text
E[k] <- E[k] + s_i(u, v)  pour chaque voxel k dans V(r)
```

Une version physiquement plus propre devrait inclure une atténuation avec la
distance :

```text
E[k] <- E[k] + s_i(u, v) * A(t_k)
```

Exemples :

```text
A(t) = 1 / (1 + alpha * t)
A(t) = 1 / (1 + alpha * t^2)
```

Le bon modèle dépend de ce que l'on veut représenter : preuve image, taille
angulaire attendue, ou probabilité d'occupation.

## Fusion multi-caméras

Pour les caméras `j = 1..C`, chaque pixel mobile ajoute une preuve dans la même
grille :

```text
E[k] = somme_j somme_i somme_(u,v) s_ij(u,v) * 1[k dans V(r_ijuv)]
```

Les voxels traversés par plusieurs rayons indépendants reçoivent plus de preuve.
Un candidat cible peut être défini comme une composante connexe au-dessus d'un
seuil :

```text
C_m = composante_connexe({ k | E[k] > lambda })
```

La position estimée peut être le barycentre pondéré :

```text
p_hat = (somme_k E[k] * centre(k)) / (somme_k E[k])
```

## Confiance

La simulation frontend utilise une règle simple selon le nombre de caméras actives
qui voient la cible :

```text
conf = 0       si n = 0
conf = 0.32    si n = 1
conf = 0.64    si n = 2
conf = min(0.96, 0.64 + 0.12 * (n - 2))  si n >= 3
```

Cette règle est utile pour l'interface mais ne doit pas être présentée comme une
probabilité validée. Une version scientifique doit calibrer la confiance à partir
des vrais taux de précision, rappel et erreur.

## Suivi de cible

Le moteur de détection ne contient pas encore de suivi complet. Un modèle futur
standard peut utiliser un état vitesse constante :

```text
x = [p_x, p_y, p_z, v_x, v_y, v_z]^T
```

Transition avec pas de temps `dt` :

```text
x_t = F x_{t-1} + w

F = [
  1 0 0 dt 0  0
  0 1 0 0  dt 0
  0 0 1 0  0  dt
  0 0 0 1  0  0
  0 0 0 0  1  0
  0 0 0 0  0  1
]
```

Mesure issue d'un cluster voxel :

```text
z_t = H x_t + v

H = [
  1 0 0 0 0 0
  0 1 0 0 0 0
  0 0 1 0 0 0
]
```

L'article devra préciser les bruits de processus, bruits de mesure, règles
d'association, création de piste et suppression de piste lorsque ces éléments
seront implémentés.

