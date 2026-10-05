# Documentation Technique – PAVOIS

# Partie I : Architecture Hardware et Besoins Métier

## Projection Avancée de Voxels pour l’Observation et l’Identification de Signatures

---

# 1. Objectif opérationnel

Le système PAVOIS doit pouvoir être :

- transporté ;
- installé rapidement ;
- calibré par un opérateur novice ;
- rendu pleinement opérationnel en moins de quelques minutes ;
- capable de fonctionner ensuite de manière autonome avec supervision minimale.

### Exigence centrale :

> Un utilisateur non spécialiste doit pouvoir déployer un module, lancer une procédure automatisée de calibration (~3 minutes), puis obtenir une capacité de détection aérienne exploitable sans intervention technique lourde.
> 

---

# 2. Besoins métier fondamentaux

Les besoins métier déterminent directement les choix matériels.

## Le système doit permettre :

### Détection :

- drones FPV ;
- quadricoptères commerciaux ;
- micro-UAV ;
- avions ;
- hélicoptères ;
- oiseaux ;
- objets aériens inconnus.

### Mesures produites :

- détection d’apparition ;
- azimut ;
- élévation ;
- distance estimée ;
- altitude estimée ;
- vitesse ;
- trajectoire ;
- persistance temporelle ;
- classification probabiliste.

### Contraintes opérationnelles :

- fonctionnement jour/nuit ;
- résistance partielle aux conditions météo ;
- faible coût relatif ;
- déploiement modulaire ;
- maintenance terrain limitée ;
- évolutivité vers architecture multi-capteurs.
- 

---

# 3. Configuration hardware minimale

## Minimum fonctionnel théorique :

### 2 caméras

Permet :

- triangulation ;
- estimation de distance ;
- calcul d’altitude ;
- vitesse approximative.

### Limites :

- faible redondance ;
- sensibilité à la perte d’un angle ;
- précision réduite ;
- plus forte probabilité de faux positifs.

---

# 4. Configuration recommandée terrain

## Standard opérationnel :

### Architecture nodale modulaire

Chaque nœud PAVOIS doit être conçu comme une unité standardisée pouvant être déployée seule ou en réseau.

---

### Option A : Nœud monocapteur

### Composition :

- 1 caméra principale (optique, IR ou thermique selon mission)

### Avantages :

- coût minimal ;
- déploiement massif ;
- simplicité logistique ;
- maintenance réduite ;
- couverture étendue via multiplication des nœuds.

### Limites :

- pas de triangulation locale ;
- dépendance réseau pour reconstruction 3D ;
- classification plus limitée seule.

---

### Option B : Nœud bicapteur ou tricapteur

### Composition possible :

- 1 caméra optique visible + 1 caméra basse lumière ;
ou
- 1 caméra optique visible + 1 caméra thermique ;
ou
- 1 caméra visible + 1 caméra IR + 1 caméra thermique.

### Objectif principal :

Le nœud multi-capteurs n’est pas conçu en priorité pour faire de la triangulation locale. Son rôle est de produire une **fusion d’image** et une **superposition de signatures** afin d’améliorer la détection dans des conditions dégradées.

### Cas d’usage :

- surveillance de nuit ;
- faible luminosité ;
- brouillard léger ;
- pluie ;
- fumée ;
- arrière-plan complexe ;
- cible difficile à distinguer en visible seul.

### Avantages :

- meilleure continuité jour/nuit ;
- détection plus robuste en environnement dégradé ;
- comparaison entre signature visuelle, IR et thermique ;
- réduction des faux positifs ;
- meilleure capacité de classification ;
- meilleure résilience si un capteur devient temporairement moins efficace.

### Limites :

- coût supérieur ;
- calibration inter-capteurs nécessaire ;
- complexité logicielle accrue ;
- poids et consommation plus élevés.

---

## Architecture système :

### PAVOIS est structuré comme un réseau de nœuds standardisés :

- déployables individuellement ;
- interconnectables ;
- évolutifs.

Ainsi :

- petites installations = nœuds simples ;
- zones critiques = maillage dense ;
- zones militaires = nœuds avancés multi-capteurs.

La **triangulation 3D** et l’estimation précise de distance/altitude reposent principalement sur la corrélation entre plusieurs nœuds positionnés à des emplacements distincts, et non sur la présence de plusieurs caméras dans un même nœud.

---

## Justification de l’architecture multi-capteurs :

### Avantages :

- triangulation robuste ;
- redondance ;
- meilleure gestion des angles morts ;
- amélioration de la classification ;
- meilleure précision vitesse ;
- détection multi-conditions ;
- réduction drastique des faux positifs.

---

# 5. Spécifications caméra (besoin métier)

## Résolution minimale exploitable :

### 1080p réel minimum

## Recommandé :

### 4MP à 8MP

---

## Framerate :

### Minimum : 30 FPS

### Recommandé : 60 FPS

Pourquoi :

- amélioration du suivi d’objets rapides ;
- meilleure estimation de vitesse ;
- réduction des pertes de trajectoire.

---

## Sensibilité :

Le système doit intégrer :

- bonne performance basse luminosité ;
- IR ou thermique selon budget ;
- optiques calibrables ;
- faible distorsion.

---

# 6. Baseline (distance entre caméras)

La distance entre caméras influence directement la précision de triangulation.

## Baseline de référence :

### Courte portée (0–150 m) :

- 2 à 5 mètres

### Moyenne portée (150–500 m) :

- 5 à 20 mètres

### Longue portée (>500 m) :

- 20 mètres +

---

## Besoin métier :

Pour système mobile rapide :

### Baseline modulaire recommandée : 5–10 mètres

Permet :

- bonne portabilité ;
- précision acceptable ;
- installation rapide.

---

# 7. Tolérances de calibration

## Exigence opérationnelle :

Calibration automatisée accessible à novice.

### Processus cible :

- installation physique ;
- démarrage logiciel ;
- auto-détection des caméras ;
- synchronisation ;
- calibration spatiale ;
- validation.

### Temps cible :

### < 3 minutes

---

## Tolérances mathématiques visées :

### Orientation caméra :

- erreur maximale < 0,5°

### Synchronisation temporelle :

- idéal < 10 ms

### Position relative :

- erreur < 5 cm pour modules standards

---

## Justification technique :

Ces tolérances garantissent :

- triangulation stable ;
- calcul distance fiable ;
- cohérence trajectoire.

---

# 8. Capacité de calcul embarqué

## Besoins minimaux :

- GPU ou NPU ;
- traitement vidéo temps réel ;
- corrélation multi-caméras ;
- voxelisation 3D ;
- tracking.

### Solutions possibles :

- NVIDIA Jetson ;
- mini-PC GPU ;
- edge compute militaire.

---

# 9. Outputs système

Le système doit produire en temps réel :

## Pour chaque cible :

- ID cible ;
- position 3D ;
- distance ;
- altitude ;
- vitesse ;
- cap ;
- historique ;
- niveau de confiance ;
- classification probable ;
- alerte.

---

## Format opérateur :

- carte tactique ;
- radar-like display ;
- logs ;
- API exportable ;
- intégration C2 possible.

---

# 10. Modes de déploiement énergétique

## Contextes de déploiement énergétique :

### A. Mode on-grid (infrastructure fixe)

Déploiement sur :

- zones urbaines ;
- sites industriels ;
- centrales ;
- aéroports ;
- bases permanentes ;
- événements sécurisés.

### Caractéristiques :

- alimentation secteur ;
- fonctionnement continu ;
- réseau local ou cloud ;
- maintenance facilitée ;
- possibilité de capteurs supplémentaires.

---

### B. Mode off-grid (terrain tactique)

Déploiement sur :

- ligne de front ;
- bases avancées ;
- convois ;
- zones isolées ;
- frontières ;
- opérations expéditionnaires.

### Caractéristiques :

- alimentation batterie ;
- générateur ;
- panneaux solaires ;
- edge computing local ;
- réseau dégradé ou absent ;
- autonomie énergétique ;
- déploiement rapide.

---

## Besoin métier clé :

### PAVOIS doit être énergétiquement agnostique :

- secteur ;
- batterie ;
- solaire ;
- hybride.

---

## Objectif :

Permettre une continuité opérationnelle quel que soit le théâtre d’opération.

---

# 11. Robustesse terrain

## Exigences hardware :

- résistance pluie légère ;
- poussière ;
- vibrations ;
- montage rapide ;
- alimentation portable ou fixe ;
- fonctionnement continu.

# 12. Philosophie produit

PAVOIS doit être pensé comme :

## “Un système de surveillance aérienne plug-and-play tactique.”

### Cela implique :

- simplicité ;
- calibration automatisée ;
- faible dépendance à expertise ;
- maintenance limitée ;
- modularité.

---

# 13. Résumé exécutif hardware

### Besoin métier :

Créer un module capable d’être :

- posé,
- calibré en 3 minutes,
- autonome,
- scalable,
- précis,
- exploitable par personnel non expert.

---

## Configuration standard :

### Module standard :

- 4 caméras ;
- 1080p à 4K ;
- 30–60 FPS ;
- baseline 5–10 m ;
- calibration automatique ;
- edge computing embarqué.

---

# 14. Ordres de grandeur économiques et couverture

Cette section donne un cadrage non contractuel destiné à évaluer la faisabilité industrielle d’un module PAVOIS avancé. Les montants varient fortement selon le choix exact des capteurs, la certification, le niveau de durcissement, le volume produit, les contraintes d’export, l’intégration logicielle et le support terrain.

---

## 14.1 Module avancé — 4 caméras / 3 familles de capteurs

Un module avancé PAVOIS peut intégrer quatre flux image issus de trois familles de capteurs :

- caméras visibles haute résolution 8 MP ;
- caméra basse lumière ou proche infrarouge ;
- caméra thermique longue portée ;
- calcul embarqué local ;
- boîtier durci ;
- alimentation secteur ou batterie ;
- connectivité locale ;
- stockage temporaire ;
- système de fixation et calibration rapide.

L’objectif de cette configuration n’est pas uniquement d’augmenter la résolution. Il s’agit surtout d’obtenir une continuité de détection dans plusieurs conditions : jour, nuit, faible luminosité, chaleur, arrière-plan complexe, météo partiellement dégradée.

---

## 14.2 Estimation de coût unitaire hardware

L’estimation économique repose sur une décomposition réaliste des composants principaux nécessaires à un module avancé.

---

### A. Capteurs visibles haute résolution (x2 à x4)

Caméras industrielles 8 MP, optiques calibrables, faible distorsion, usage extérieur :

- 300 € à 1 500 € / unité selon capteur, focale, boîtier et robustesse ;

### Budget estimé :

## 1 200 € à 6 000 €

---

### B. Capteurs IR / basse lumière

Caméras proches infrarouges ou capteurs low-light industriels :

- 500 € à 3 000 € / unité ;

### Budget estimé :

## 500 € à 3 000 €

---

### C. Caméra thermique

Le coût varie massivement selon portée, résolution et qualité.

Exemples marché :

- FLIR Boson 320 : ~1 500 à 2 500 € ;
- FLIR Boson 640 : ~3 500 à 5 500 € ;
- systèmes stabilisés longue portée : 10 000 €+.

### Budget réaliste :

## 2 000 € à 10 000 €

---

### D. Calcul embarqué

Solutions edge AI :

- NVIDIA Jetson AGX Orin industriel ;
- mini-PC GPU ;
- solutions NPU.

### Budget :

## 1 500 € à 5 000 €

---

### E. Infrastructure physique

Inclut :

- boîtier outdoor ;
- fixation ;
- câblage ;
- batterie / solaire éventuel ;
- alimentation ;
- synchronisation ;
- réseau.

### Budget :

## 2 000 € à 15 000 €

---

### F. Logiciel, calibration, intégration initiale

Inclut :

- installation ;
- calibration ;
- paramétrage ;
- sécurisation ;
- support.

### Budget variable :

## 5 000 € à 20 000 € selon maturité produit.

---

## Synthèse économique prototype avancé

### Addition réaliste :

## 12 000 € à 30 000 €

Correspond à :

- composants industriels ;
- bonne thermique ;
- edge AI ;
- boîtier robuste ;
- autonomie partielle ;
- software initial.

---

## Synthèse version industrialisée durcie

### Addition réaliste :

## 25 000 € à 80 000 €

Inclut :

- durcissement ;
- meilleure portée ;
- redondance ;
- support ;
- production sécurisée ;
- réseau ;
- maintenance.

---

## Pourquoi cette fourchette reste crédible :

Comparativement :

- caméra thermique industrielle seule : 2 000 € à 15 000 € ;
- radar tactique : souvent 100 000 € à plusieurs millions ;
- systèmes anti-drone complets : souvent plusieurs centaines de milliers d’euros.

PAVOIS se positionne donc comme :

### une architecture passive intermédiaire, plus dense et économiquement scalable.

---

## 14.3 Couverture théorique d’un module

La couverture dépend principalement de :

- la hauteur d’installation ;
- le champ de vision ;
- la focale ;
- la taille de l’objet ;
- la météo ;
- la luminosité ;
- la qualité optique ;
- la densité de nœuds ;
- le niveau de confiance demandé.

---

## 14.4 Portée par type d’objet

### Petits drones FPV / micro-UAV

Ordre de grandeur :

## 300 m à 1,5 km

Variable selon taille, contraste, vitesse, arrière-plan et qualité des optiques.

---

### Quadricoptères commerciaux moyens

Ordre de grandeur :

## 1 km à 3 km

La signature visuelle et thermique est plus importante qu’un micro-drone, ce qui permet une détection plus stable.

---

### Hélicoptères et avions légers

Ordre de grandeur :

## 5 km à 20 km+

Ces aéronefs sont plus grands, plus visibles et plus persistants dans l’image. Le système peut donc contribuer à une surveillance aérienne élargie, même si la précision de localisation dépend du maillage multi-nœuds.

---

## 14.5 Couverture surfacique indicative

Pour une surveillance réaliste, la couverture ne doit pas être calculée comme un simple cercle parfait. Elle doit intégrer :

- zones mortes ;
- obstacles ;
- relief ;
- besoin de recouvrement ;
- perte de performance météo ;
- redondance entre nœuds ;
- niveau de confiance demandé.

### Couverture indicative par module avancé :

## Zone utile anti-drone : 0,5 à 5 km²

### Couverture indicative en réseau :

- petit site sensible : 4 à 12 modules ;
- site industriel large : 10 à 50 modules ;
- aéroport ou zone très étendue : architecture multi-couches avec capteurs complémentaires ;
- ligne ou frontière : déploiement par segments, avec recouvrement entre nœuds.

---

## 14.6 Coût par km² surveillé

En première approximation, pour une mission anti-drone basse altitude :

## 10 000 € à 150 000 € par km² surveillé

Cette fourchette dépend fortement du niveau de densité souhaité :

- détection opportuniste ;
- surveillance persistante ;
- redondance ;
- fonctionnement nuit ;
- exigences météo ;
- intégration avec radar ou C2 ;
- maintenance.

---

## 14.7 Extrapolation grande échelle

Pour une couverture nationale, frontalière ou militaire étendue, le coût ne doit pas être calculé uniquement en multipliant la surface par le coût au km².

Une architecture réaliste repose sur une couverture priorisée :

- zones critiques ;
- bases ;
- infrastructures ;
- axes logistiques ;
- villes ;
- sites énergétiques ;
- points de passage ;
- zones de rassemblement.

Le système PAVOIS est donc plus cohérent comme réseau de surveillance ciblé et dense sur des zones à forte valeur que comme couverture continue et uniforme d’un territoire entier.

---

## 14.8 Positionnement économique

PAVOIS n’a pas vocation à être moins cher qu’une simple caméra de surveillance. Sa logique économique est différente :

- coût très inférieur à certains systèmes radar lourds ;
- déploiement plus rapide ;
- capteurs passifs ;
- modularité ;
- densité plus élevée ;
- maintenance potentiellement plus simple ;
- capacité à compléter des systèmes déjà existants.

Le positionnement économique pertinent est donc :

## une couche de détection passive, dense et scalable, complémentaire aux radars et systèmes de commandement existants.

---

# Conclusion

Le hardware PAVOIS doit prioriser :

### simplicité de déploiement + précision suffisante + coût maîtrisé + robustesse.

---

## En une phrase :

### PAVOIS doit transformer une architecture complexe de vision multi-capteurs en une solution terrain simple, rapide et industrialisable.