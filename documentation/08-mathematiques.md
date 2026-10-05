[← Protocoles](07-protocoles.md) · [🏠 Accueil](README.md) · [Calibration →](09-calibration.md)

# 📐 Les mathématiques

> Toutes les équations qu'exécute le code, et seulement celles-là. Chaque bloc
> renvoie à la fonction qui l'implémente, côté VPS (`vps/src/fusion/`). Les
> mêmes formules existent en C++ dans `pavois++/src/math/` et
> `pavois++/src/fusion/`.

---

## 1. Le repère

Tout le calcul se fait dans un repère local **ENU**, en mètres :

```text
            z  (Haut)
            ▲
            │    y  (Nord)
            │   ↗
            │  ╱
            │ ╱
            └──────────▶ x  (Est)
```

| Angle | Convention |
|---|---|
| **Cap** $h$ | depuis le Nord (+y), **sens horaire** vu du dessus : 90° = Est |
| **Élévation** $e$ | au-dessus de l'horizon, positive vers le haut |
| **Roulis** $\rho$ | rotation autour de l'axe de visée |

L'origine est la position GPS de la **première observation qui en porte une**
(voir [La fusion 3D](04-fusion-3d.md#-faire-les-rayons)).

## 2. Les axes de la caméra

`cameraBasis()` (`geometry/fusion-geo.ts`) construit trois vecteurs unitaires
à partir de $(h, e, \rho)$ : **devant** $\mathbf{f}$, **droite** $\mathbf{r}$,
**haut** $\mathbf{u}$.

```math
\mathbf{f} = \begin{pmatrix} \sin h \cos e \\ \cos h \cos e \\ \sin e \end{pmatrix},
\qquad
\mathbf{r}_0 = \begin{pmatrix} \cos h \\ -\sin h \\ 0 \end{pmatrix},
\qquad
\mathbf{u}_0 = \frac{\mathbf{r}_0 \times \mathbf{f}}{\lVert \mathbf{r}_0 \times \mathbf{f} \rVert}
```

Le roulis fait tourner $\mathbf{r}$ et $\mathbf{u}$ autour de $\mathbf{f}$ :

```math
\mathbf{r} = \mathbf{r}_0 \cos\rho + \mathbf{u}_0 \sin\rho,
\qquad
\mathbf{u} = \mathbf{u}_0 \cos\rho - \mathbf{r}_0 \sin\rho
```

## 3. L'optique : modèle sténopé et distorsion

Une caméra est décrite par ses **intrinsèques** : focales $f_x, f_y$ et centre
optique $c_x, c_y$ en pixels, plus cinq coefficients de distorsion
$k_1, k_2, k_3$ (radiale) et $p_1, p_2$ (tangentielle), le modèle
**Brown-Conrady** d'OpenCV.

Sans calibration, `effectiveIntrinsics()` les déduit du champ de vision
horizontal $\theta$ et de la largeur $W$ de l'image :

```math
f_x = \frac{W/2}{\tan(\theta/2)}, \qquad f_y = f_x, \qquad c_x = \frac{W}{2}, \qquad c_y = \frac{H}{2}
```

> [!NOTE]
> Exemple : 1280 px de large et 65° de champ donnent $f_x \approx 1005$ px.

**Distorsion** (point normalisé $(x, y)$, $r^2 = x^2 + y^2$) :

```math
\begin{aligned}
x_d &= x\,(1 + k_1 r^2 + k_2 r^4 + k_3 r^6) + 2 p_1 x y + p_2 (r^2 + 2x^2) \\
y_d &= y\,(1 + k_1 r^2 + k_2 r^4 + k_3 r^6) + p_1 (r^2 + 2y^2) + 2 p_2 x y
\end{aligned}
```

`undistortPixel()` inverse ce modèle par **8 itérations de point fixe**.

## 4. D'un pixel à un rayon

`pixelToRay()` transforme le centroïde $(u, v)$ d'une tache en demi-droite
partant du centre $\mathbf{c}$ de la caméra :

```math
x_d = \frac{u - c_x}{f_x}, \quad y_d = \frac{v - c_y}{f_y}
\;\xrightarrow{\text{sans distorsion}}\; (x_n, y_n)
\qquad
\mathbf{d} = \frac{\mathbf{f} + x_n\,\mathbf{r} - y_n\,\mathbf{u}}{\lVert \mathbf{f} + x_n\,\mathbf{r} - y_n\,\mathbf{u} \rVert}
```

Le signe moins vient de l'image : $v$ augmente **vers le bas**. Le rayon est
$\{\, \mathbf{c} + t\,\mathbf{d} \mid t > 0 \,\}$.

L'opération inverse, `projectWorldToPixel()`, dit où un point $\mathbf{p}$
apparaît dans l'image :

```math
z_c = (\mathbf{p}-\mathbf{c})\cdot\mathbf{f}, \quad
x_n = \frac{(\mathbf{p}-\mathbf{c})\cdot\mathbf{r}}{z_c}, \quad
y_n = \frac{-(\mathbf{p}-\mathbf{c})\cdot\mathbf{u}}{z_c}, \quad
(u, v) = (c_x + f_x x_d,\; c_y + f_y y_d)
```

Un point avec $z_c \le 0$ est **derrière** la caméra : pas de projection.

## 5. Croiser les rayons

### 5.1 Premier point : moindres carrés

`leastSquaresIntersection()` cherche le point le plus proche de tous les rayons.
La distance de $\mathbf{p}$ au rayon $i$ s'écrit avec le projecteur orthogonal
$\mathbf{P}_i = \mathbf{I} - \mathbf{d}_i \mathbf{d}_i^\top$ :

```math
\mathbf{p}_0 = \arg\min_{\mathbf{p}} \sum_i w_i \,\bigl\lVert \mathbf{P}_i (\mathbf{p} - \mathbf{c}_i) \bigr\rVert^2
\quad\Longrightarrow\quad
\Bigl(\sum_i w_i \mathbf{P}_i\Bigr)\, \mathbf{p}_0 = \sum_i w_i \mathbf{P}_i\, \mathbf{c}_i
```

Un système 3 × 3 résolu par pivot de Gauss (`solve3()`). Le poids est la
qualité de la tache : $w_i = \max(0{,}05,\; q_i)$.

### 5.2 Affinage : Gauss-Newton en pixels

Le premier point compte des écarts **en mètres** : une caméra lointaine y pèse
autant qu'une proche. Or le capteur mesure des **pixels**. `refineReprojection()`
minimise donc l'erreur de reprojection :

```math
\mathbf{p}^\star = \arg\min_{\mathbf{p}} \sum_i \omega_i\, \bigl\lVert \mathbf{m}_i - \pi_i(\mathbf{p}) \bigr\rVert^2,
\qquad
\omega_i = \frac{\max(0{,}05,\, q_i)}{\sigma_i^2}
```

où $\mathbf{m}_i$ est le centroïde observé et $\pi_i$ la projection de la
caméra $i$. Chaque itération résout
$(\sum \omega_i \mathbf{J}_i^\top \mathbf{J}_i)\,\boldsymbol{\delta} = \sum \omega_i \mathbf{J}_i^\top \mathbf{r}_i$
avec la jacobienne $\mathbf{J}_i$ (2 × 3) calculée par différences centrées.
Au plus **6 itérations** ; un pas qui n'améliore pas est divisé par deux, puis
abandonné : le résultat n'est jamais pire que $\mathbf{p}_0$.

### 5.3 Le bruit attendu par caméra

`pixelSigmaOf()` combine le bruit du centroïde et le bruit de pose converti en
pixels, avec $\bar f = (f_x + f_y)/2$ :

```math
\sigma_i = \max\!\Bigl(0{,}1,\; \sqrt{\sigma_{px}^2 + \bigl(\bar f \cdot \sigma_{pose}\bigr)^2}\Bigr)
\qquad
\sigma_{px} = 1{,}5 \text{ px}, \quad \sigma_{pose} = 0{,}5° \text{ (en radians)}
```

> [!NOTE]
> Avec $\bar f \approx 1005$ px, l'incertitude de pose (0,5°) vaut déjà
> environ 8,8 px : **c'est l'IMU, pas le détecteur, qui domine l'erreur**.

### 5.4 Les contrôles

| Grandeur | Définition | Seuil |
|---|---|---|
| Parallaxe | plus petit angle entre deux rayons du groupe : $\min_{i<j} \arccos(\mathbf{d}_i \cdot \mathbf{d}_j)$ | ≥ 2° |
| Erreur de reprojection | $\lVert \mathbf{m}_i - \pi_i(\mathbf{p}^\star) \rVert$ pour **chaque** caméra | ≤ 120 px |
| Distance au rayon | $\lVert \mathbf{P}_i(\mathbf{p}^\star - \mathbf{c}_i) \rVert$ | optionnel |
| Portée | $\lVert \mathbf{p}^\star - \mathbf{c}_i \rVert$ pour chaque caméra | 0,5 à 60 m |
| Devant | $(\mathbf{p}^\star - \mathbf{c}_i)\cdot\mathbf{f}_i > 0$ | — |

### 5.5 La covariance du point

`positionCovariance()` propage le bruit en pixels jusqu'à la position :

```math
\boldsymbol{\Sigma}_{\mathbf{p}} = s \cdot \Bigl(\sum_i \frac{\mathbf{J}_i^\top \mathbf{J}_i}{\sigma_i^2}\Bigr)^{-1},
\qquad
s = \operatorname{clamp}\!\Bigl(\frac{\chi^2}{2N - 3},\; 1,\; 100\Bigr),
\qquad
\chi^2 = \sum_i \frac{\lVert \mathbf{r}_i \rVert^2}{\sigma_i^2}
```

Le facteur $s$ **gonfle** l'incertitude quand les rayons s'accordent moins bien
que le bruit ne le prévoit ($N$ caméras, donc $2N - 3$ degrés de liberté).

### 5.6 La note de confiance

```math
\begin{aligned}
n &= \min(1,\; 0{,}3 + 0{,}2\,N) \\
a &= \operatorname{clamp}\bigl(1 - \text{résidu}_{px} / 120,\; 0,\; 1\bigr) \\
b &= \operatorname{clamp}\bigl(\text{parallaxe} / 25°,\; 0{,}2,\; 1\bigr) \\
\bar q &= \text{qualité moyenne des taches} \\
\text{confiance} &= \operatorname{clamp}\bigl(1{,}6 \cdot n \cdot (0{,}4\,a + 0{,}3\,b + 0{,}3\,\bar q),\; 0,\; 0{,}99\bigr)
\end{aligned}
```

Les coefficients sont réglés à la main.

### 5.7 Ordre de grandeur de la précision

*Estimation générale (deux caméras parallèles), pas un calcul du code.* Pour une
base $B$ entre caméras et une cible à la distance $Z$, l'erreur en profondeur
croît comme le **carré** de la distance :

```math
\sigma_Z \approx \frac{Z^2}{\bar f\, B}\, \sigma
```

| Situation | $B$ | $Z$ | $\sigma$ | $\sigma_Z$ |
|---|---|---|---|---|
| Banc rail, centroïde seul | 0,43 m | 2,5 m | 1,5 px | ≈ 2 cm |
| Banc rail, avec l'erreur d'IMU | 0,43 m | 2,5 m | ≈ 9 px | ≈ 13 cm |
| Même banc, cible à 25 m | 0,43 m | 25 m | ≈ 9 px | **≈ 13 m** |

Conclusion pratique : pour voir loin, il faut **écarter les caméras** et
**soigner leur orientation**, bien plus que raffiner le détecteur.

## 6. Le suivi : Kalman à vitesse constante

`KalmanCV` (`tracking/fusion-kalman.ts`) estime l'état
$\mathbf{x} = (\mathbf{p}, \mathbf{v}) \in \mathbb{R}^6$.

**Prédiction** sur un intervalle $\Delta t$ :

```math
\mathbf{x}^- = \mathbf{F}\mathbf{x}, \quad
\mathbf{P}^- = \mathbf{F}\mathbf{P}\mathbf{F}^\top + \mathbf{Q},
\qquad
\mathbf{F} = \begin{pmatrix} \mathbf{I}_3 & \Delta t\,\mathbf{I}_3 \\ \mathbf{0} & \mathbf{I}_3 \end{pmatrix},
\quad
\mathbf{Q} = q \begin{pmatrix} \tfrac{\Delta t^4}{4}\mathbf{I}_3 & \tfrac{\Delta t^3}{2}\mathbf{I}_3 \\ \tfrac{\Delta t^3}{2}\mathbf{I}_3 & \Delta t^2\,\mathbf{I}_3 \end{pmatrix}
```

avec $q$ = `FUSION_TRACK_PROCESS_NOISE` (200 par défaut) : l'accélération que la
cible peut avoir sans prévenir.

**Mise à jour** avec un point triangulé $\mathbf{z}$ et sa covariance :

```math
\mathbf{y} = \mathbf{z} - \mathbf{H}\mathbf{x}^-, \quad
\mathbf{S} = \mathbf{H}\mathbf{P}^-\mathbf{H}^\top + \mathbf{R}, \quad
\mathbf{K} = \mathbf{P}^-\mathbf{H}^\top \mathbf{S}^{-1}, \quad
\mathbf{x} = \mathbf{x}^- + \mathbf{K}\mathbf{y}
```

avec $\mathbf{H} = (\mathbf{I}_3 \;\; \mathbf{0})$ et
$\mathbf{R} = \boldsymbol{\Sigma}_{\mathbf{p}} + (0{,}05\text{ m})^2\,\mathbf{I}_3$
(la covariance de la triangulation plus un plancher).

**Porte d'association** : une mesure n'est acceptée que si

```math
d^2 = \mathbf{y}^\top \mathbf{S}^{-1} \mathbf{y} \;\le\; \chi^2_{3;\,0{,}99} = 11{,}34
\qquad\text{et}\qquad
\lVert \mathbf{y} \rVert \le v_{max}\,\Delta t + 6\text{ m}
```

**Initialisation** : position et covariance de la première triangulation,
vitesse nulle avec un écart-type de $\max(10,\; v_{max}/3) = 40$ m/s.

**Confiance d'une piste** à chaque mesure acceptée :

```math
c \leftarrow \operatorname{clamp}\bigl(0{,}6\,c + 0{,}4\,c_{mesure} + 0{,}02 \min(10, n_{mesures}),\; 0,\; 0{,}99\bigr)
```

## 7. GPS ↔ repère local

`gpsToEnu()` et `enuToGps()` utilisent une **projection équirectangulaire
locale** autour de l'origine $(\varphi_0, \lambda_0, a_0)$, avec
$R = 6\,378\,137$ m et la latitude moyenne $\bar\varphi$ :

```math
x = (\lambda - \lambda_0)\cos\bar\varphi \cdot R, \qquad
y = (\varphi - \varphi_0) \cdot R, \qquad
z = a - a_0
```

Largement suffisante à l'échelle d'un site (quelques centaines de mètres). La
même formule existe côté Pi (`gps_to_local_approx`).

## 8. Le centroïde côté Pi

Le détecteur applique aussi un **Kalman 2D à vitesse constante** sur le centroïde
de la tache, en pixels (`centroid_process_noise` = 600 px²/s³,
`centroid_meas_noise` = 2 px). Il lisse la position et donne une vitesse pour
traverser une image ratée. Voir [Le détecteur sur les Pi](03-detecteur-pi.md#-le-détecteur-de-mouvement).

---

[← Protocoles](07-protocoles.md) · [🏠 Accueil](README.md) · [Calibration →](09-calibration.md)
