# Rapport de veille et de cadrage - PAVOIS

> **Document de travail collectif**  
> Version : 0.1  
> Format cible final : PDF  
> Périmètre déjà rédigé : **Analyse du marché et dispositif de veille**  
> Sections restantes : à compléter par les membres de l'équipe

---

## Page de titre

**Nom et prénom :** `[À compléter]`  
**Numéro de groupe :** `[À compléter]`  
**Nom du projet :** PAVOIS - Projection Avancée de Voxels pour l'Observation et l'Identification de Signatures  
**Membres de l'équipe :**

| Nom | Prénom | Rôle projet | Partie du rapport |
|---|---|---|---|
| `Jean` | `Cazals de Fabel` | `Supreme Leader` | `Analyse de marché` |
| `Mohamed Amine` | `Dridi` | `The King` | `Analyse de la problématique` |
| `Tanel` | `Oubadia` | `Mascotte` | `Expression de la problématique` |
| `[À compléter]` | `[À compléter]` | `[À compléter]` | `[À compléter]` |

---

## TL;DR

PAVOIS répond à une problématique de surveillance aérienne basse altitude : les
drones légers, FPV ou commerciaux modifiés sont difficiles à détecter tôt, à
localiser précisément et à distinguer d'objets non menaçants avec des solutions
simples et peu coûteuses.

La solution proposée est une architecture de **détection optique passive
multi-caméras** : les pixels en mouvement sont projetés sous forme de rayons dans
une grille voxel 3D partagée, afin de créer une preuve spatiale exploitable par
un opérateur.

L'analyse de marché montre que le secteur **C-UAS** (*Counter-Unmanned Aircraft
Systems*, ou systèmes de lutte anti-drones) est en forte croissance, dominé par
des solutions multicouches radar/RF/optronique, mais qu'il existe un espace pour
une brique optique passive, modulaire, économique et explicable, surtout en
complément de systèmes existants.

---

# 1. Problématique

## 1.1 Énoncé court du problème

`De nombreux objets rapides ou difficiles à suivre peuvent apparaître dans un espace surveillé : balle pendant un match, objet volant dans un festival, projectile léger ou élément non identifié. Le problème est de détecter ces objets en mouvement et d’estimer leur position afin d’aider un opérateur à comprendre rapidement la situation.`

## 1.2 Énoncé court de la solution

`PAVOIS propose une solution de détection passive par caméras : les mouvements observés dans plusieurs images sont projetés dans un espace 3D afin de localiser et suivre les objets mobiles sans nécessiter de capteur actif.` 

`À terme, cette approche pourrait être étendue à des cas plus exigeants, comme la détection de drones ou la surveillance de zones sensibles.`


## 1.3 Origine du besoin

`[À compléter par l'équipe]`

Points à traiter :

- Pourquoi le problème existe maintenant.
- Quels usages de drones créent le risque.
- Pourquoi les solutions manuelles ou existantes sont insuffisantes.
- Où se situe la douleur principale : coût, délai de réaction, faux positifs,
  manque de couverture, manque de mobilité, difficulté de neutralisation.

---

# 2. Analyse du marché et dispositif de veille

> **Section rédigée pour l'équipe chargée de l'analyse de marché.**  
> Cette section présente le positionnement marché de PAVOIS à partir de la
> solution proposée et d'une veille externe datée de mai 2026.

## 2.1 Positionnement de PAVOIS

PAVOIS est une solution de **détection optique passive d'objets volants**. Son
positionnement métier vise la surveillance de drones FPV, quadricoptères
commerciaux modifiés, micro-UAV, aéronefs légers et objets aériens inconnus.

La proposition repose sur une idée simple : utiliser plusieurs caméras pour
observer une même zone, détecter le mouvement dans les images, puis projeter ces
informations dans un espace 3D voxelisé afin d'estimer la position d'un objet
aérien.

Le périmètre du projet est volontairement centré sur la **détection**, la
**localisation** et l'**aide à la décision**. PAVOIS ne se positionne pas comme
un système autonome de neutralisation. Cette distinction est importante, car la
neutralisation de drones implique des contraintes juridiques, opérationnelles et
techniques beaucoup plus fortes que la détection.

Dans l'analyse de marché, PAVOIS doit donc être comparé non pas à une solution
complète de lutte anti-drone incluant brouillage ou interception, mais à une
**brique de détection et de localisation passive**, intégrable dans une
architecture de sûreté plus large.

## 2.2 État du marché : un besoin en forte croissance

Le marché de la détection et de la lutte anti-drone est en phase d'accélération.
Cette croissance vient d'un paradoxe : les drones deviennent plus utiles pour les
usages civils, industriels et logistiques, mais leur accessibilité crée aussi des
risques de sûreté pour les aéroports, événements publics, sites industriels,
infrastructures critiques et zones militaires.

La Commission européenne estime que le marché européen des services de drones
pourrait atteindre **14,5 milliards d'euros** et créer **145 000 emplois** d'ici
2030. Cette croissance des usages drones augmente mécaniquement le besoin de
surveillance, de détection et de gestion des vols non coopératifs [Commission
européenne - Drone Strategy 2.0](https://transport.ec.europa.eu/news-events/news/drone-strategy-creating-large-scale-european-drone-market-2022-11-29_en).

Le marché anti-drone suit la même dynamique. MarketsandMarkets estime que le
marché mondial anti-drone passerait de **4,48 Md$ en 2025** à **14,51 Md$ en
2030**, soit un **taux de croissance annuel moyen de 26,5 %**
[MarketsandMarkets - Anti-Drone Market](https://www.marketsandmarkets.com/Market-Reports/anti-drone-market-177013645.html).

Le besoin est déjà concret. La FAA indique recevoir **plus de 100 signalements
de drones près des aéroports par mois** aux États-Unis [FAA - Drone Sightings
Near Airports](https://www.faa.gov/uas/resources/public_records/uas_sightings_report).
En France, Le Monde rapporte que les dispositifs anti-drone déployés autour des
Jeux Olympiques et Paralympiques de Paris 2024 ont mené à **300 drones
neutralisés** et environ **100 arrestations** durant les périodes olympiques,
selon les chiffres officiels cités [Le Monde, 2026](https://www.lemonde.fr/en/economy/article/2026/03/10/france-scales-up-anti-drone-measures-to-industrial-level-as-threat-rises_6751296_19.html).

La conclusion marché est claire : il ne s'agit plus d'un sujet expérimental. La
détection de drones devient un besoin opérationnel pour des acteurs publics et
privés. En revanche, le marché reste fragmenté entre solutions haut de gamme,
solutions spécialisées par capteur et pratiques manuelles encore très présentes.

## 2.3 Solutions existantes et concurrence réelle

Il existe déjà des solutions qui répondent partiellement au problème. Elles se
répartissent en quatre familles : systèmes industriels complets, capteurs
spécialisés, surveillance humaine et solutions artisanales.

### Systèmes industriels intégrés

Les grands systèmes C-UAS combinent souvent radar, radiofréquence, caméra,
optronique, classification IA et parfois neutralisation. Ils sont adaptés aux
aéroports, sites sensibles, grands événements et clients défense.

| Acteur | Offre | Forces | Faiblesses |
|---|---|---|---|
| Thales | EagleShield | Acteur industriel majeur, solution pensée pour infrastructures critiques, approche multicouche | Coût et complexité élevés, solution dimensionnée pour grands sites |
| CS Group | BOREADES / RAPTOR | Expérience française en lutte anti-drone, système intégré, usage événementiel et sites restreints | Dépendance à une intégration système complète, moins adapté à un petit POC |
| Dedrone / Axon | DedronePortable, DedroneTracker.AI | Déploiement rapide, logiciel mature, fusion capteurs | Positionnement premium, dépendance à un écosystème propriétaire |
| DroneShield | DroneSentry, RfPatrol, SensorFusionAI | Large portefeuille RF, IA et défense | Très orienté guerre électronique, coût et réglementation selon usage |
| Anduril | Lattice / Sentry | C2 avancé, intégration défense, automatisation forte | Solution lourde, peu accessible pour petits sites ou projets exploratoires |

Ces solutions prouvent que le besoin marché existe. Leur limite principale pour
notre cas est qu'elles sont souvent conçues comme des plateformes complètes,
coûteuses, difficiles à reproduire dans un POC étudiant et parfois centrées sur
la neutralisation, qui est beaucoup plus réglementée que la détection.

### Capteurs spécialisés

Certaines offres ne cherchent pas à tout faire. Elles se concentrent sur une
technologie dominante.

| Technologie | Exemple d'acteur | Forces | Faiblesses |
|---|---|---|---|
| Radiofréquence | Cerbair HYDRA | Détection passive, identification possible du drone ou du pilote si signal connu | Inefficace contre drones autonomes, silencieux RF ou liaison non standard |
| Radar | Robin Radar, Echodyne | Détection d'objets non coopératifs, portée et suivi | Coût, émission active, faux positifs possibles, classification visuelle limitée |
| Remote ID / signaux électroniques | Hologarde | Pertinent pour espaces aéroportuaires et drones coopératifs | Moins utile face à un drone hostile ou non conforme |
| Optique / optronique | Caméras visibles, IR, thermiques | Preuve visuelle, passif, utile pour classification | Sensible météo, nuit, occlusions et calibration |

PAVOIS se situe principalement dans la famille **optique passive**, avec une
différence : il ne se limite pas à afficher une image ou détecter un objet 2D. Il
cherche à reconstruire une preuve 3D par fusion de plusieurs caméras.

### Concurrence non technologique : humain, caméra simple, Excel

La concurrence n'est pas seulement industrielle. Dans beaucoup d'organisations,
la solution actuelle peut être :

- un agent qui surveille une zone à l'oeil nu ;
- une caméra de vidéosurveillance classique ;
- un opérateur qui reçoit des appels radio ;
- une main courante ou un tableau Excel pour noter les incidents ;
- une procédure manuelle de remontée d'alerte.

Ces solutions ont un avantage : elles coûtent peu au départ et ne nécessitent pas
forcément un nouveau système. Mais elles ont des limites fortes :

- détection tardive ;
- fatigue humaine ;
- absence de mesure 3D ;
- difficulté à distinguer drone, oiseau ou avion léger ;
- historique peu exploitable ;
- pas d'automatisation de la preuve ;
- coordination lente en cas d'incident.

PAVOIS répond directement à cette faiblesse : l'objectif n'est pas seulement de
voir une image, mais de produire une **alerte localisée**, **traçable** et
**visuellement explicable**.

## 2.4 Analyse technologique du marché

Les revues scientifiques confirment que les technologies C-UAS reposent
principalement sur radar, radiofréquence, détection image, acoustique et fusion
de données [MDPI Sensors, 2022](https://www.mdpi.com/1424-8220/22/1/189). Une
autre revue identifie les mêmes familles : acoustique, vision, RF passive, radar
et fusion, auxquelles s'ajoutent les moyens de mitigation comme le brouillage ou
la capture physique [arXiv, 2020](https://arxiv.org/abs/2008.12461).

| Technologie | Forces | Faiblesses | Lecture marché |
|---|---|---|---|
| Radar | Portée, détection non coopérative, suivi possible | Coût, émission active, complexité, faux positifs oiseaux | Très adapté aux sites critiques, moins aux solutions légères |
| Radiofréquence | Passive, utile pour détecter liaison drone/pilote | Ne détecte pas un drone autonome ou silencieux | Très forte en complément, insuffisante seule |
| Optique visible | Passive, peu coûteuse, preuve visuelle | Nuit, météo, calibration, occlusion | Opportunité principale pour PAVOIS |
| IR / thermique | Meilleure nuit, signature thermique | Coût, résolution, météo | Extension future crédible |
| Acoustique | Passive, matériel simple | Bruit urbain, vent, portée faible | Complément faible portée |
| Fusion multi-capteurs | Robustesse et baisse des faux positifs | Coût et intégration | Direction dominante du marché |

La tendance de fond est la fusion multi-capteurs. Un système crédible ne repose
pas forcément sur un seul capteur : il combine plusieurs preuves. Cela ne
diminue pas l'intérêt de PAVOIS ; au contraire, cela lui donne un positionnement
clair comme **brique optique passive** dans une architecture plus large.

## 2.5 Marché français

Le marché français est structuré autour d'acteurs déjà présents sur les segments
défense, aéroportuaire, grands événements et sites sensibles.

| Acteur | Offre | Technologies principales | Forces | Faiblesses / espace pour PAVOIS |
|---|---|---|---|---|
| Thales | EagleShield | Radar, capteurs multicouches, aide à la décision | Crédibilité défense/aéroport, solution complète | Solution haut de gamme, peu adaptée à un POC léger |
| CS Group | BOREADES / RAPTOR | Système intégré C-UAS | Expérience française, événements, sites restreints | Position intégrateur, coût et complexité |
| Cerbair | HYDRA | Analyse radiofréquence | Détection passive RF, base de signatures | Ne couvre pas les drones silencieux RF |
| Hologarde | HOLODRONE / Bassalt | Remote ID, détection longue portée | Ancrage aéroportuaire, connaissance du contexte ADP | Forte dépendance aux signaux électroniques |
| MC2 Technologies | Neutralisation / brouillage | Moyens actifs RF | Utile pour forces autorisées | Hors périmètre PAVOIS car neutralisation réglementée |

Sources principales : Thales EagleShield [Thales](https://www.thalesgroup.com/fr/catalogue-de-solutions/aviation-civile/eagleshield-lutte-anti-drones-pour-les-aeroports), CS Group BOREADES/RAPTOR [CS Group](https://www.cs-soprasteria.com/fr/offres-solutions/systemes-de-surveillance-commandement/lutte-anti-drones/), Cerbair HYDRA [Cerbair](https://www.cerbair.com/solutions/hydra), Hologarde [Hologarde](https://hologarde.com/).

Sur ce marché français, PAVOIS ne doit pas être présenté comme un concurrent
direct des grands intégrateurs. Son positionnement le plus crédible est celui
d'un module optique de détection/localisation, démontrable à faible coût, et
potentiellement complémentaire à des systèmes RF ou radar.

## 2.6 Marché international

À l'international, les solutions les plus visibles sont souvent plus intégrées et
orientées défense/sécurité.

| Acteur | Offre | Forces | Faiblesses / espace pour PAVOIS |
|---|---|---|---|
| Dedrone / Axon | DedronePortable, DedroneTracker.AI | Solution mature, portable, fusion capteurs | Produit premium, écosystème propriétaire |
| DroneShield | DroneSentry, RfPatrol, SensorFusionAI | Portefeuille complet RF/EW/IA | Forte orientation RF et guerre électronique |
| Robin Radar | IRIS | Radar spécialisé drone | Coût et émission active |
| Echodyne | Radar compact | Détection robuste de drones non coopératifs | Moins explicable visuellement seul |
| Anduril | Lattice / Sentry | Plateforme C2 défense très intégrée | Solution lourde, hors portée d'un POC étudiant |

Sources principales : DedronePortable [Dedrone](https://www.dedrone.com/solutions/dedrone-portable), DroneShield [DroneShield](https://www.droneshield.com/), Robin Radar [Robin Radar](https://www.robinradar.com/drone-detection-systems).

La concurrence internationale confirme que le marché recherche des solutions
intégrées. Mais elle montre aussi un espace pour des briques spécialisées :
détection passive, classification visuelle, localisation, preuve opérateur et
interopérabilité.

## 2.7 Contraintes réglementaires et impact marché

Le marché ne dépend pas uniquement de la performance technique. Il dépend aussi
du cadre légal. En France, l'exploitation de drones est encadrée par les règles
européennes et nationales. Le ministère rappelle qu'un exploitant doit
s'enregistrer lorsqu'il exploite un drone de plus de 250 g ou équipé de capteurs
pouvant récolter des données personnelles, et que les vols en espace public en
agglomération sont restreints [Ministère chargé des transports](https://www.ecologie.gouv.fr/politiques-publiques/exploitation-drones-categorie-ouverte).

Pour les solutions anti-drones, la distinction entre **détecter** et
**neutraliser** est essentielle. La neutralisation par brouillage radio, GPS ou
interception physique est fortement encadrée et réservée à des acteurs autorisés.
À l'inverse, la détection, la classification et l'aide à la décision sont plus
faciles à intégrer dans un contexte civil ou industriel.

La normalisation progresse également. Le groupe EUROCAE WG-115 travaille sur les
standards C-UAS pour l'aviation, notamment les exigences de surveillance,
d'interopérabilité et de performance pour la détection de drones non coopératifs
[EUROCAE WG-115](https://www.eurocae.net/working-group/wg-115/).

Cette contrainte réglementaire renforce le positionnement de PAVOIS : une
solution passive de détection et localisation peut être plus facilement
présentée, testée et intégrée qu'une solution de neutralisation.

## 2.8 Besoins clients et douleurs du marché

### Segments prioritaires

| Segment | Besoin | Sensibilité prix | Contraintes |
|---|---|---:|---|
| Sites sensibles industriels | Détection précoce, traçabilité, alerte | Moyenne | Réglementation, continuité d'activité |
| Événements publics | Déploiement temporaire, couverture rapide | Moyenne | Mobilité, faux positifs, coordination forces de l'ordre |
| Bases avancées / défense | Détection discrète, basse signature, robustesse | Faible à moyenne | Conditions terrain, intégration C2 |
| Aéroports | Longue portée, très faible faux positif, procédures | Faible | Certification, responsabilité, coordination ATC |
| Collectivités / sécurité civile | Coût maîtrisé, preuve visuelle, simplicité | Élevée | Budget, compétences opérateur |

### Douleurs principales

1. **Détection tardive** : un petit drone est souvent visible seulement quelques
   secondes avant de devenir critique.
2. **Faux positifs** : oiseaux, avions légers, ballons, reflets, véhicules ou
   mouvements de fond peuvent déclencher de mauvaises alertes.
3. **Coût des solutions haut de gamme** : les systèmes radar/RF/C2 complets sont
   souvent dimensionnés pour des sites critiques, pas pour des petits sites ou
   POC.
4. **Contraintes juridiques de neutralisation** : détecter est plus facilement
   déployable que brouiller ou intercepter.
5. **Manque de preuve visuelle explicable** : l'opérateur doit comprendre ce qui
   a déclenché l'alerte.

## 2.9 Positionnement de PAVOIS face au marché

PAVOIS doit être positionné comme :

> une brique de détection optique passive, distribuée et explicable, visant à
> localiser des objets aériens en 3D par fusion géométrique de rayons issus de
> plusieurs caméras.

### Différenciation

| Critère | PAVOIS | Solutions dominantes |
|---|---|---|
| Type de capteur principal | Caméras optiques | Radar + RF + optique |
| Émission active | Non | Radar actif ou RF selon système |
| Coût potentiel | Faible à moyen | Moyen à très élevé |
| Déploiement | Modulaire, caméras distribuées | Souvent site fixe ou kit spécialisé |
| Maturité actuelle | POC technique | Produits industriels |
| Force principale | Géométrie explicable pixel-vers-voxel | Portée, intégration, mitigation |
| Faiblesse principale | Calibration, météo, nuit, classification | Coût, complexité, contraintes légales |

## 2.10 SWOT marché de PAVOIS

| Forces | Faiblesses |
|---|---|
| Détection passive sans émission RF/radar | Pas encore de tracking réel ni extraction de clusters |
| Approche explicable par géométrie 3D | Forte dépendance à la calibration caméra |
| Coût matériel potentiellement bas | Sensibilité météo/lumière/occlusions |
| Compatible avec une architecture multi-capteurs future | POC non connecté à un backend live |

| Opportunités | Menaces |
|---|---|
| Croissance rapide du marché anti-drone | Acteurs industriels déjà établis |
| Besoin civil croissant en détection sans neutralisation | Réglementation et certification exigeantes |
| Sites temporaires ou petits budgets mal servis par les offres premium | Solutions radar/RF plus robustes en longue portée |
| Intégration possible avec RF, thermique ou C2 existant | Performances terrain à prouver |

## 2.11 Hiérarchisation des apports de PAVOIS

| Priorité | Apport | Justification |
|---:|---|---|
| 1 | Détection passive optique | Réduit la signature du système et évite les contraintes de brouillage |
| 2 | Localisation 3D par fusion multi-caméras | Répond au besoin de distance/altitude, pas seulement de détection 2D |
| 3 | Coût et modularité | Permet un POC ou une solution complémentaire plus accessible |
| 4 | Explicabilité | Les rayons, voxels et images sources peuvent être montrés à l'opérateur |
| 5 | Extension multi-capteurs | Peut devenir une brique dans une architecture C-UAS plus large |

## 2.12 Dispositif de veille utilisé

La veille n'a pas servi à remplacer l'analyse ; elle a servi à la justifier par
des faits, des sources et des comparaisons.

### Objectifs de veille

1. **Comprendre le marché C-UAS** (*Counter-Unmanned Aircraft Systems*, c'est-à-dire
   les systèmes de lutte anti-drones) : taille, croissance, moteurs économiques,
   usages civils et défense.
2. **Identifier les solutions qui existent déjà** : acteurs français,
   internationaux et alternatives manuelles.
3. **Comparer les technologies de détection** : radar, radiofréquence, optique,
   acoustique, thermique, fusion multi-capteurs.
4. **Positionner PAVOIS** : déterminer où une solution optique passive
   pixel-vers-voxel peut apporter une valeur différenciante.

### Sources consultées

| Catégorie | Sources | Utilité |
|---|---|---|
| Institutions européennes | Commission européenne, EASA, EUROCAE | Réglementation, stratégie drone, standardisation C-UAS |
| Sources gouvernementales françaises | Ministère chargé des transports, Ministère de l'Intérieur | Cadre d'usage des drones et sécurité événementielle |
| Études marché | MarketsandMarkets, études sectorielles | Taille et croissance du marché anti-drone |
| Industriels français | Thales, CS Group, Cerbair, Hologarde | Cartographie concurrentielle française |
| Industriels internationaux | Dedrone, DroneShield, Robin Radar | Cartographie concurrentielle internationale |
| Recherche scientifique | MDPI Sensors, arXiv C-UAS surveys | État de l'art technique des capteurs |
| Presse économique spécialisée | Le Monde, articles sectoriels | Signaux faibles, événements, dynamique française |

### Méthode de recherche et de traitement

La veille a été structurée en cinq étapes :

1. **Recherche ciblée** avec les mots-clés `counter-UAS`, `anti-drone`, `lutte
   anti-drone`, `drone detection`, `RF detection`, `optical drone detection`.
2. **Qualification des sources** en privilégiant sources officielles,
   industriels identifiés et publications scientifiques.
3. **Extraction des informations utiles** : chiffres marché, technologies,
   clients cibles, forces, limites.
4. **Comparaison** sous forme de matrices : technologies, acteurs français,
   acteurs internationaux, alternatives manuelles.
5. **Synthèse stratégique** : identification des opportunités et risques pour
   PAVOIS.

### Auto-critique du protocole

Le protocole est fiable pour un cadrage, mais il a des limites :

- Les chiffres de marché varient selon les cabinets ; ils doivent être lus comme
  des **ordres de grandeur**.
- Les performances réelles des systèmes anti-drone sont souvent confidentielles,
  surtout pour les clients défense, aéroports ou opérateurs d'importance vitale.
- Les fiches commerciales détaillent rarement les taux de faux positifs, limites
  météo, coûts complets et contraintes de déploiement.
- La veille devra être maintenue dans le temps, car le secteur évolue vite :
  nouvelles menaces, nouvelles règles, nouveaux capteurs et nouveaux acteurs.

## 2.13 Conclusion de l'analyse marché

Le marché anti-drone est en croissance forte, mais il est dominé par des
solutions intégrées, coûteuses et souvent orientées défense ou infrastructure
critique. Les technologies RF et radar sont très présentes, mais elles ont des
limites : drones silencieux RF, contraintes de brouillage, coût, faux positifs,
complexité d'intégration.

PAVOIS n'a pas vocation à concurrencer directement Thales, Dedrone ou
DroneShield sur une solution complète. Son espace de pertinence est plutôt :

- un **POC de détection passive** ;
- une **brique optique de localisation 3D** ;
- une solution de démonstration pour sites temporaires, petits périmètres ou
  intégration future ;
- une approche complémentaire à des capteurs RF ou radar.

La prochaine étape de validation marché doit être de confronter cette proposition
à des utilisateurs cibles : sécurité événementielle, sites industriels sensibles,
équipes de sûreté, ou acteurs de défense légère.

---

# 3. Analyse approfondie de la problématique

`[À compléter par l'équipe]`

À inclure :

- Segmentation détaillée des parties prenantes.
- Source principale de douleur.
- Qui paie ? Qui utilise ? Qui décide ?
- Résultats d'enquête utilisateur si disponibles.
- Hiérarchisation des priorités.

## 3.1 Parties prenantes

| Partie prenante | Besoin | Douleur | KPI attendu |
|---|---|---|---|
| Opérateur sécurité | `[À compléter]` | `[À compléter]` | `[À compléter]` |
| Responsable site | `[À compléter]` | `[À compléter]` | `[À compléter]` |
| Forces de l'ordre | `[À compléter]` | `[À compléter]` | `[À compléter]` |
| Équipe technique | `[À compléter]` | `[À compléter]` | `[À compléter]` |

---

# 4. Proposition de solution

`[À compléter par l'équipe]`

## 4.1 Utilisateurs cibles

| Type d'utilisateur | Objectif | Fonctionnalités nécessaires |
|---|---|---|
| Opérateur de surveillance | `[À compléter]` | `[À compléter]` |
| Responsable de déploiement | `[À compléter]` | `[À compléter]` |
| Analyste post-incident | `[À compléter]` | `[À compléter]` |
| Administrateur technique | `[À compléter]` | `[À compléter]` |

## 4.2 Use case principal

`[À compléter par l'équipe]`

Structure recommandée :

1. Situation initiale.
2. Problème rencontré.
3. Déploiement de PAVOIS.
4. Détection.
5. Visualisation.
6. Décision opérateur.
7. Résultat.

## 4.3 Fonctionnalités

| Besoin utilisateur | Fonctionnalité PAVOIS | Statut POC |
|---|---|---|
| Voir la couverture caméra | Carte de couverture | Implémenté en simulation |
| Détecter du mouvement | Frame diff + masque | Implémenté prototype |
| Localiser en 3D | Rayons + voxels | Partiellement implémenté |
| Suivre une cible | Track manager | À faire |
| Rejouer un événement | Replay UI | Implémenté en simulation |
| Classifier drone/oiseau | IA/classifieur | À faire |

## 4.4 Architecture haute niveau

```text
Caméras
  -> Moteur de détection optique
  -> Grille voxel 3D
  -> Extraction de mesures
  -> Gestionnaire de pistes
  -> API / WebSocket
  -> Interface opérateur React/Cesium
```

## 4.5 Choix technologiques

| Brique | Technologie | Justification |
|---|---|---|
| Prototype détection | C++ / Python | Performance + expérimentation rapide |
| Traitement image | OpenCV | Standard du traitement vidéo |
| Accumulation temps réel | PyTorch / CUDA | Vectorisation GPU simple |
| Frontend | React / TypeScript / Vite | POC rapide, typage, écosystème moderne |
| Carte 3D | Cesium | Visualisation géospatiale 3D |
| État frontend | Zustand | Store léger adapté au POC |

---

# 5. Plan d'action : vision, objectifs, KPI

`[À compléter par l'équipe]`

## 5.1 Vision

`[À compléter]`

## 5.2 Objectifs SMART

| Objectif | Spécifique | Mesurable | Atteignable | Réaliste | Temporel |
|---|---|---|---|---|---|
| `[À compléter]` | `[À compléter]` | `[À compléter]` | `[À compléter]` | `[À compléter]` | `[À compléter]` |

## 5.3 KPI par partie prenante

| Partie prenante | KPI | Cible |
|---|---|---|
| Opérateur | Temps de détection | `[À compléter]` |
| Responsable site | Couverture zone | `[À compléter]` |
| Équipe technique | FPS / latence | `[À compléter]` |
| Projet | Respect planning | `[À compléter]` |

## 5.4 Planning provisoire

| Phase | Durée | Livrable |
|---|---:|---|
| Cadrage | `[À compléter]` | `[À compléter]` |
| POC détection | `[À compléter]` | `[À compléter]` |
| Interface | `[À compléter]` | `[À compléter]` |
| Tests | `[À compléter]` | `[À compléter]` |
| Rapport final | `[À compléter]` | `[À compléter]` |

## 5.5 Ressources et coûts

`[À compléter par l'équipe]`

| Poste | Hypothèse | Coût estimé |
|---|---|---:|
| Développement | `[À compléter]` | `[À compléter]` |
| Matériel caméras | `[À compléter]` | `[À compléter]` |
| Infrastructure | `[À compléter]` | `[À compléter]` |
| Maintenance | `[À compléter]` | `[À compléter]` |
| Support / SLA | `[À compléter]` | `[À compléter]` |

---

# 6. Gestion de projet

`[À compléter par l'équipe]`

## 6.1 Méthodologie choisie

Méthode proposée : **Kanban avec rituels Scrum légers**.

Justification à compléter :

- Projet POC avec incertitude technique.
- Besoin de prioriser rapidement.
- Équipe probablement réduite.
- Avancement visible par tickets.

## 6.2 Outils

| Usage | Outil | Règle d'utilisation |
|---|---|---|
| Code | GitHub | Branches, PR, revue |
| Suivi tâches | GitHub Projects / Jira / Trello | `[À choisir]` |
| Documentation | Markdown | Un fichier par sujet |
| Communication | Discord / Teams / Slack | `[À choisir]` |
| Maquettes | Figma | `[À compléter]` |

## 6.3 Rituels

| Rituel | Fréquence | Objectif |
|---|---|---|
| Daily court | `[À compléter]` | Synchronisation |
| Revue avancement | `[À compléter]` | Démonstration |
| Rétrospective | `[À compléter]` | Amélioration |
| Point risques | `[À compléter]` | Escalade |

## 6.4 Workflow Git proposé

```text
Créer un ticket
  -> créer une branche feature/nom-court
  -> coder
  -> tester localement
  -> ouvrir une pull request
  -> revue par un pair
  -> merge
  -> mise à jour documentation
```

---

# 7. Solution POC

`[À compléter par l'équipe]`

## 7.1 Fonctionnalités démontrées

- `[À compléter]`
- `[À compléter]`
- `[À compléter]`

## 7.2 Captures d'écran à insérer

| Capture | Description |
|---|---|
| `[À insérer]` | Interface surveillance |
| `[À insérer]` | Vue déploiement |
| `[À insérer]` | Prévisualisation voxel |
| `[À insérer]` | Replay |

## 7.3 Infrastructure de déploiement cible

```text
Navigateur opérateur
  -> Frontend React
  -> API backend future
  -> Moteur de détection
  -> Caméras / capteurs
```

## 7.4 SLA et risques opérationnels

`[À compléter par l'équipe]`

| Risque | Impact | Mitigation |
|---|---|---|
| Faux positifs | `[À compléter]` | `[À compléter]` |
| Perte caméra | `[À compléter]` | `[À compléter]` |
| Mauvaise calibration | `[À compléter]` | `[À compléter]` |
| Faible luminosité | `[À compléter]` | `[À compléter]` |

---

# 8. Annexes

## 8.1 Sources utilisées pour l'analyse de marché

- Commission européenne, Drone Strategy 2.0 : https://transport.ec.europa.eu/news-events/news/drone-strategy-creating-large-scale-european-drone-market-2022-11-29_en
- MarketsandMarkets, Anti-Drone Market 2025-2030 : https://www.marketsandmarkets.com/Market-Reports/anti-drone-market-177013645.html
- FAA, Drone Sightings Near Airports : https://www.faa.gov/uas/resources/public_records/uas_sightings_report
- EUROCAE WG-115 Counter UAS : https://www.eurocae.net/working-group/wg-115/
- Ministère chargé des transports, exploitation de drones en catégorie ouverte : https://www.ecologie.gouv.fr/politiques-publiques/exploitation-drones-categorie-ouverte
- Thales EagleShield : https://www.thalesgroup.com/fr/catalogue-de-solutions/aviation-civile/eagleshield-lutte-anti-drones-pour-les-aeroports
- CS Group, lutte anti-drones : https://www.cs-soprasteria.com/fr/offres-solutions/systemes-de-surveillance-commandement/lutte-anti-drones/
- Cerbair HYDRA : https://www.cerbair.com/solutions/hydra
- Hologarde : https://hologarde.com/
- DedronePortable : https://www.dedrone.com/solutions/dedrone-portable
- DroneShield : https://www.droneshield.com/
- MDPI Sensors, Review and Simulation of Counter-UAS Sensors : https://www.mdpi.com/1424-8220/22/1/189
- arXiv, Counter-Unmanned Aircraft System(s): State of the Art, Challenges and Future Trends : https://arxiv.org/abs/2008.12461
- Le Monde, France scales up anti-drone measures : https://www.lemonde.fr/en/economy/article/2026/03/10/france-scales-up-anti-drone-measures-to-industrial-level-as-threat-rises_6751296_19.html
