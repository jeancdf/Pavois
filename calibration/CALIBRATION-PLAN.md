# Calibration ChArUco des trois caméras

La calibration se fait dans le mode exact de production : capteur
`1920x1080`, image traitée `1280x720`. Elle mesure séparément chaque optique,
puis la pose des trois caméras dans le même repère du rail.

## 1. Préparer la mire

Ouvrir `calibration/charuco-board-a4.html`, imprimer en A4 paysage à **100 %**
et vérifier au réglet que l'image mesure **245 x 175 mm**. La coller sur un
support parfaitement plat et rigide.

La mire est une ChArUco 7 x 5, dictionnaire `DICT_5X5_100`, cases de 35 mm et
marqueurs de 26 mm. Ne pas changer ces dimensions sans modifier le script.

## 2. Calibrer l'optique de chaque Pi

Sur `jean`, `tanel`, puis `walid` :

```bash
sudo /usr/bin/python3 /opt/pavois/bin/camera-calib.py intrinsics
```

Déplacer lentement la mire dans le centre, les bords et les coins, avec
plusieurs inclinaisons. L'outil choisit automatiquement 24 vues distinctes,
affiche la progression en direct et refuse un résultat au-dessus de 1 px RMS.
Il écrit `fx`, `fy`, `cx`, `cy`, `k1`, `k2`, `p1`, `p2`, `k3` et le HFOV dans
`/etc/pavois/pavois.conf`, après sauvegarde du fichier précédent.

## 3. Calibrer la pose commune du rail

Placer ensuite la mire **verticale, immobile et visible par les trois caméras**.
Mesurer son centre dans le repère du test : X vers la droite, Y devant le rail,
Z vers le haut. Sans déplacer la mire, lancer sur chaque Pi :

```bash
sudo /usr/bin/python3 /opt/pavois/bin/camera-calib.py rig --board-center 0 2.5 0.4
```

Remplacer les trois nombres par la position réellement mesurée, en mètres.
L'outil moyenne 30 poses, rejette les mesures instables, puis écrit la position
et l'orientation de la caméra. Le service redémarre automatiquement. Au premier
paquet de détection, le VPS persiste cette pose et remplace la géométrie idéale
du rail par la géométrie mesurée.

## 4. Fichiers et critères de contrôle

- Rapports : `/var/lib/pavois/camera-intrinsics-<id>.json` et
  `/var/lib/pavois/camera-rail-pose-<id>.json`.
- Intrinsèques : RMS de reprojection inférieur à 1 px.
- Pose : dispersion inférieure à 3 cm RMS.
- Toute modification de l'objectif, de la mise au point, de la résolution ou
  du montage impose de refaire la calibration concernée.
