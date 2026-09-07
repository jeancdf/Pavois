# Plan — Calibration caméra InnoMaker CAM-OV5647 (Pavois)

> Objectif : mesurer la vraie focale, le centre optique et la distorsion de l'objectif
> avant le premier test optique (Phase 1 du PLAN.md racine).
> Matériel : InnoMaker CAM-OV5647 sur Pi 5 (CSI0), damier imprimé, PC Windows (OpenCV 4.10).

---

## 0. Fiche du module (source : github.com/INNO-MAKER/CAM-OV5647)

⚠️ Ce module n'a **pas** l'objectif stock du Camera Module v1 (3,6 mm / 53,5°).

| Paramètre | Valeur InnoMaker | (Rappel v1 stock) |
|---|---|---|
| Capteur | OV5647, 2592×1944, pixels 1,4 µm, RAW10 GBRG | idem |
| Focale | **2,8 mm** (objectif 4G+IR) | 3,6 mm |
| Ouverture | f/2.2 | f/2.9 |
| FOV plein capteur | **H ≈ 72°, D ≈ 90°** | 53,5° H |
| Distorsion TV | **< −17 % (barillet, forte)** | faible/modérée |
| Distance de mise au point mini | 0,1 m | ~1 m |
| CRA / illumination relative | 10° / 52 % (vignettage attendu dans les coins) | — |

### Conséquences pour Pavois

1. **`fov_degrees` ≈ 72** (plein capteur) — mais avec −17 % de distorsion, le modèle
   pinhole simple de `ray_voxel.cpp` sera **faux de plusieurs degrés en bord de champ**.
   La calibration n'est plus un « nice to have », c'est un prérequis : il faudra soit
   corriger la distorsion des frames avant le pipeline (`cv2.undistort`), soit utiliser
   K + coefficients pour calculer les directions de rayons.
2. En mode crop 1080p (utilisé par le stream 720p actuel), le FOV effectif retombe
   à ~55–57° H. **Toujours capturer/calibrer dans le mode qu'on utilisera : `1296:972` plein champ.**
3. Grand-angle = cible plus petite à l'écran : IFOV ≈ 0,97 mrad/px en 1296 de large.
   Un drone de 30 cm ≈ 31 px @ 10 m, ~6 px @ 50 m, ~3 px @ 100 m.
   → portée pratique frame-diff : **~60–100 m** (moins que les ~150 m estimés avec l'objectif stock).
   En échange : zone de couverture proche plus large, mieux pour le test Phase 1 à 5–15 m.
4. Vignettage (RI 52 %) : le seuil de frame-diff devra être un peu plus permissif dans
   les coins, ou normaliser l'image (la calibration n'y change rien).

---

## 1. Impression du damier — ✅ prêt, action utilisateur

- Fichier : `calibration/checkerboard-a4.html` (10×7 cases de 25 mm → 9×6 coins internes)
- Chrome → Ctrl+P → **échelle 100 %**, A4 **paysage** ; vérifier 25 mm au réglet
- Coller sur support **rigide et plat** (impératif)

## 2. Capture sur le Pi (≈ 2 min, piloté par l'agent)

1. Couper le stream (`pkill -f "[c]amstream"` + rpicam/ffmpeg) — il occupe la caméra
2. Lancer :
   ```
   rpicam-still -n -t 90000 --timelapse 3000 --mode 1296:972 \
     --width 1296 --height 972 -o /home/jean/calib/img_%03d.jpg
   ```
   → 30 photos, une toutes les 3 s
3. Pendant ce temps, l'utilisateur déplace le damier **lentement, avec une pause à chaque pose** :
   - distance 0,4–1,2 m (MOD 0,1 m : on peut s'approcher, le damier doit rester entier dans le champ)
   - couvrir **centre + les 4 bords + les 4 coins** de l'image
     (avec −17 % de distorsion, les vues périphériques sont les plus importantes)
   - incliner ~20–30° gauche/droite/haut/bas, pas seulement de face
   - bonne lumière (shutter court = pas de flou de bougé)
4. Rapatrier : `scp pi5:calib/img_*.jpg calibration/images/`
5. Relancer le stream

## 3. Calibration sur le PC — ✅ script prêt

- `py -3 calibration/calibrate.py calibration/images 25`
- Critères d'acceptation :
  - ≥ 15 vues détectées (minimum absolu 8 — sinon nouvelle salve ciblée)
  - RMS reprojection **< 0,5 px** (acceptable < 1,0)
  - HFOV calculé cohérent avec la spec (~66–74°)
  - k1 nettement négatif attendu (barillet) ; si résidus élevés malgré tout,
    passer au modèle rational (`CALIB_RATIONAL_MODEL`) — objectif très grand-angle
- Sortie : `calibration/camera_calibration.json` (K, dist, FOV, erreurs par image)

## 4. Validation rapide

- `cv2.undistort` sur une image de damier en bord de champ → les lignes doivent devenir droites
- Comparer HFOV mesuré vs 72° annoncé ; noter l'écart centre optique vs centre géométrique

## 5. Intégration Pavois (après calibration)

- [ ] `metadata.json` : `fov_degrees` = HFOV **mesuré** (mode 1296×972)
- [ ] Décision pipeline : undistort des frames en amont (simple, un peu de CPU)
      **ou** rayons calculés via K/dist (précis, modifie `ray_voxel.cpp`)
- [ ] Reporter fov_h/fov_v mesurés dans `CameraConfig` (Django) et le cône FOV Leaflet
- [ ] Garder `camera_calibration.json` versionné dans le repo (une calib par exemplaire de caméra —
      si une 2ᵉ CAM-OV5647 arrive pour la Phase 1, la calibrer aussi, les objectifs varient entre exemplaires)

---

## État

- [x] Damier généré (`checkerboard-a4.html`)
- [x] Script de calibration prêt (`calibrate.py`)
- [x] Specs InnoMaker intégrées (2,8 mm / 72° H / distorsion forte)
- [ ] Damier imprimé et monté sur support rigide ← **prochaine action (utilisateur)**
- [ ] Capture 30 images en 1296×972
- [ ] Calibration + validation
- [ ] Report des valeurs dans Pavois
