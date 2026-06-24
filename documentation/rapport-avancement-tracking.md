# Rapport d'avancement — Détection & tracking d'avions (caméra passive)

**Date : 2026-06-25** · Périmètre : `pixeltovoxelprojector/` · Cible POC : **tracking temps réel d'avions** pour démo investisseurs (triangulation 2 caméras prévue ensuite).

---

## 1. Objectif

- **Court terme (POC démo) :** que le code de tracking **suive l'avion en temps réel** sur une vidéo réelle, **sans transformer la traînée en essaim de fausses cibles**, et **sans casser** la détection des particules rapides qui marche déjà.
- **Moyen terme :** ajouter une **2e caméra + triangulation** pour la position 3D / distance.
- **Contrainte permanente :** tourne sur PC pour la démo, puis sur **Raspberry Pi** ; le plus simple qui marche, pas de dépendance inutile.

---

## 2. Décisions déjà actées

- **Abandon de l'approche voxels + PyTorch** (`realtime_multi_voxel_preview.py`) pour la longue portée : inadaptée (grille mémoire, lourdeur Pi). Conservée mais dépréciée.
- **Base = le mouvement** (« le pixel qui bouge entre les images »). C'est la bonne fondation, on la garde. Ce qui était faible, c'était la **différence sur 2 images** et la **décision image par image + rustines**.
- **Optique (Phase 0) faite :** objectif passé de 170° à 90° de champ.

---

## 3. État du code (fichiers)

| Fichier | Rôle | État |
|---|---|---|
| `small_target_detector.py` | Détecteur petite-cible (top-hat multi-échelle + centroïde sous-pixel) + `FastMotionDetector` (diff d'images) | **Modifié** : ajout d'un **motion gate** (soustraction de fond MOG2) ; **suppression** des anciennes rustines (collinéaire / persistance / tip) |
| `target_tracker.py` | Tracker multi-cible (filtre α-β, confirmation M-of-N : déplacement + rectitude) | Inchangé |
| `realtime_small_target_preview.py` | Appli temps réel (détecteur + tracker + affichage) | **Modifié** : câblage motion gate, redimensionnement portrait (`--max-side`, fenêtre `KEEPRATIO`), profils, flags |
| `velocity_tbd.py` | **Nouveau** : Track-Before-Detect par intégration vitesse | **Créé cette session, NON validé** (voir §6) |
| `15776784_1080_1920_60fps.mp4` | Clip de test (avion + traînée + lune) | Portrait 1080×1920, 60 fps |

> Tout est en **working tree non commité**.

---

## 4. Diagnostic de la vidéo de test (mesuré)

- **Format :** portrait **1080×1920**, 60 fps. Corrigé côté affichage (réduction proportionnelle à 540×960, plus de déformation).
- **Caméra FIXE :** déplacement inter-image médian **0,17 px** (pas de tremblement).
- **Image propre :** bruit du ciel σ ≈ **0,83/255** ; changement inter-image médian **0,04**. → Ce n'est **pas** un problème de résolution/qualité.
- **Contenu :** un **avion** (petit point sombre au bout de la traînée), une grosse **traînée (contrail)** diagonale, et la **LUNE** (gros blob rond clair) — un 2e objet brillant qui complique tout.
- **Traînée (détections brutes) :** **30 détections/image** (le plafond), **colinéarité 0,90–1,00**, ruban perpendiculaire **p50≈5 px / p75≈9 px / p90≈17,5 px** (ce n'est pas une ligne fine d'1 px mais un **ruban flou qui ondule**).

---

## 5. Ce qui marche

- **Détecteur + tracker** sur cibles **mobiles isolées** (particules rapides) : OK, ne pas casser.
- **Auto-tests** `small_target_detector` / `target_tracker` : **verts** (y compris un cas motion-gate synthétique).
- **Affichage portrait** corrigé.
- **Rejet du corps statique de la traînée** (partie basse, ancienne) : les méthodes de mouvement le rejettent **bien**.

---

## 6. Ce qu'on a essayé contre la traînée, et pourquoi ça a buté

Métrique = **cibles confirmées par image** (idéal ≈ 1 = l'avion ; départ ≈ **20** = essaim).

| Approche | Idée | Résultat | Pourquoi ça bute |
|---|---|---|---|
| Rustines (collinéaire + persistance + tip) | Détecter la ligne, garder le bout | 20 → ~2-4, mais **fragile** | Empilement de cas particuliers ; le tip-tracking a fini par **tuer l'avion** |
| **Motion gate** (soustraction de fond MOG2) | Garder seulement le 1er plan mobile | ~15, **insuffisant** (bouffées ~18 même au max) | La traînée **ondule/bouillonne** → jamais absorbée comme « décor » |
| **TBD** (intégration vitesse, `velocity_tbd.py`) | Additionner N images le long de vitesses constantes | **Floode** (carte d'énergie encombrée) | La **lune** (statique brillante) et le ruban épais laissent des **résidus** ; une ligne statique s'intègre le long de sa propre direction |
| **Vote de vitesse (Hough x,y,t)** | Garder les points formant une droite à vitesse non nulle | ~10, mais **paquet serré sur l'avion** | Rejette le corps statique ✅ mais la traînée **fraîche** près de l'avion bouge **avec** lui |

**Auto-test `velocity_tbd.py` : ROUGE** (non validé — le scénario synthétique met la ligne parallèle à la vitesse de la cible, cas dégénéré ; à corriger).

---

## 7. L'insight clé (le vrai blocage, physique)

Toutes les méthodes de mouvement **rejettent correctement le corps ancien/immobile** de la traînée. Ce qui **reste**, c'est un **paquet serré de détections pile sur l'avion**.

> Ce paquet, c'est la **traînée FRAÎCHE que l'avion est en train de créer**. Elle naît à la position de l'avion et **avance avec lui**. Avion et traînée fraîche sont au **même endroit, qui se déplace ensemble**.

**Conséquence :** **aucune méthode mono-caméra basée sur le mouvement ne peut séparer l'avion de la traînée qu'il dessine** — ils bougent ensemble. Ce n'est pas un bug, c'est physique.

**Recadrage de l'objectif :** le paquet près de l'avion **n'est pas un défaut à éliminer**, c'est le **sillage de l'avion**. Le bon objectif n'est pas « séparer avion/traînée fraîche » (impossible à 1 caméra) mais **effondrer ce paquet co-mobile en UN seul marqueur** = une piste propre et stable sur l'avion.

---

## 8. Recommandation / prochaines étapes

### Option A — « Détecteur de paquet mobile » (recommandé)
1. **Rejeter les détections immobiles** (vieux corps de traînée) — déjà efficace.
2. **Fusionner les survivantes co-mobiles en 1 marqueur par objet** (clustering spatial).
→ Résultat visé : **1 marqueur stable sur l'avion**, plus d'essaim, particules rapides isolées conservées.
Réutilise l'existant, reste léger/temps réel, et se nettoie encore mieux avec la 2e caméra (le sillage diffus ne triangulera pas en un point ; l'avion oui).

### Option B — Valider d'abord sur un clip plus net
Tester sur une vidéo d'avion **bien visible, sans grosse traînée fraîche ni lune** : le tracker actuel marcherait probablement déjà, et on validerait la chaîne sans ce cas pathologique.

### Plus tard
- **2e caméra + triangulation** (discriminateur géométrique fort : ce qui n'est pas un point 3D cohérent est rejeté).
- **TBD** (`velocity_tbd.py`) reste pertinent pour la **vraie** cible future (drone faible et lointain, **sans** traînée) — à valider/réparer à ce moment-là.
- **Classifieur appris** (drone vs oiseau) seulement si nécessaire (Phase 5).

---

## 9. Points durs résiduels (pour mémoire)

- **Avion ⟷ sa traînée fraîche** : inséparables à 1 caméra (physique). Solution = fusion en 1 marqueur (Option A) puis 2e caméra.
- **Tri oiseaux vs drones** : impossible par le seul mouvement → 2 caméras (taille/altitude 3D) ou IA.
- **Distance 3D réelle** : dépend de l'**écartement des caméras**, pas du logiciel.
