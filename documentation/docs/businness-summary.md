# Projet PAVOIS

## Projection Avancée de Voxels pour l’Observation et l’Identification de Signatures

Le projet **PAVOIS** est une solution de **détection optique passive d’objets volants**, conçue pour identifier, localiser et suivre des menaces aériennes de petite taille, à basse altitude et à faible signature.

L’objectif est de proposer une capacité de surveillance aérienne **rapide à déployer**, **faiblement détectable**, **résiliente aux contre-mesures radio**, et économiquement plus accessible que les architectures de surveillance traditionnelles.

---

## 1. Contexte stratégique

Les conflits récents ont montré une transformation rapide de la menace aérienne. Le danger ne vient plus uniquement d’aéronefs militaires classiques, coûteux et facilement détectables, mais aussi d’objets volants légers, produits en masse, difficiles à repérer et capables de saturer les défenses existantes.

PAVOIS vise en priorité la détection de :

- **Drones FPV tactiques** : petits drones pilotés en immersion, souvent rapides, très maniables, utilisés à très basse altitude pour la reconnaissance rapprochée ou l’attaque ciblée.
- **Quadricoptères commerciaux modifiés** : drones civils de type DJI, Autel ou équivalent, adaptés pour l’observation, le guidage, le largage de charges légères ou la correction de tirs.
- **Drones de reconnaissance légère** : plateformes fixes ou multirotors utilisées pour observer une zone, suivre des mouvements de troupes, repérer des véhicules ou cartographier une position.
- **Munitions rôdeuses de petite taille** : systèmes aériens capables de rester en vol avant de frapper une cible, avec une signature visuelle et radar souvent réduite.
- **Micro et mini-UAV** : objets volants de très petite taille, parfois difficilement détectables par radar, opérant à basse altitude et à faible vitesse.
- **Aéronefs légers non coopératifs** : ULM, parapentes motorisés, petits avions, hélicoptères légers ou plateformes artisanales pouvant représenter une menace dans certains contextes de sécurité.
- **Aéronefs conventionnels de plus grande taille** : avions militaires ou civils, hélicoptères de transport, d’attaque ou de reconnaissance, détectables à des distances potentiellement bien supérieures à celles des drones grâce à leur taille, leur signature visuelle, thermique ou cinématique plus importante. Cette capacité permet au système d’assurer également une surveillance aérienne élargie et de contribuer à une connaissance situationnelle plus large de l’espace aérien.
- **Objets aériens non identifiés à faible signature** : oiseaux, ballons, débris portés par le vent, drones inconnus ou objets mal classifiés, que le système doit pouvoir détecter puis discriminer.

---

## 2. Problème opérationnel

Les systèmes de surveillance classiques reposent souvent sur des technologies actives, coûteuses ou difficiles à déployer rapidement : radar, guerre électronique, capteurs spécialisés lourds, infrastructures fixes.

Ces systèmes restent essentiels, mais ils présentent plusieurs limites face à la menace drone moderne :

- coût élevé par zone protégée ;
- difficulté de déploiement rapide sur des petites bases ou des sites temporaires ;
- vulnérabilité aux stratégies de saturation ;
- efficacité variable face aux drones très petits, lents ou volant très bas ;
- dépendance à des capteurs actifs pouvant être détectés ;
- difficulté de distinguer une menace réelle d’un oiseau, d’un ballon ou d’un faux positif.

Le besoin n’est donc pas seulement de “voir” un objet volant, mais de **détecter tôt**, **suivre dans le temps**, **localiser en 3D**, puis **qualifier la menace** avec un niveau de confiance exploitable par un opérateur.

---

## 3. Principe de la solution

PAVOIS repose sur une architecture de surveillance optique distribuée.

Plusieurs caméras observent simultanément une même zone aérienne. Le système analyse les micro-mouvements dans l’image, compare les détections entre les différents points de vue, puis projette les informations dans un espace 3D voxelisé.

Cette approche permet de passer d’une simple détection 2D dans une image à une estimation spatiale exploitable :

- position de l’objet ;
- détection différenciée selon la taille et la signature, permettant une portée potentiellement plus importante pour les aéronefs de grande dimension ;
- distance par rapport aux capteurs ;
- altitude estimée ;
- vitesse ;
- trajectoire ;
- cohérence de mouvement ;
- probabilité qu’il s’agisse d’un drone, d’un oiseau ou d’un faux positif.

---

## 4. Technologies mobilisées

Le système peut s’appuyer sur plusieurs types de capteurs selon le niveau de performance recherché :

- caméras optiques visibles ;
- caméras infrarouges ;
- caméras thermiques ;
- caméras basse lumière / vision nocturne ;
- radar courte ou moyenne portée en complément ;
- calcul embarqué ou semi-déporté ;
- algorithmes de triangulation ;
- reconstruction 3D par voxels ;
- suivi temporel multi-objets ;
- classification assistée par intelligence artificielle.

PAVOIS n’a pas vocation à remplacer systématiquement le radar. Il peut fonctionner comme une couche passive autonome ou comme une brique complémentaire dans une architecture multi-capteurs.

---

## 5. Avantage clé : détection passive

Contrairement à un radar, PAVOIS n’émet pas de signal actif pour détecter une cible.

Cela offre plusieurs avantages :

- faible signature électromagnétique ;
- détection plus difficile du système par un adversaire ;
- résistance aux contre-mesures radio visant les liaisons de commande des drones ;
- capacité à surveiller sans révéler immédiatement la position des capteurs ;
- coût potentiellement réduit par point de surveillance.

---

## 6. Applications potentielles

### 6.1 Surveillance militaire

- surveillance d’une ligne de front ;
- détection de drones FPV ;
- protection de petites bases avancées ;
- surveillance de zones logistiques ;
- alerte précoce pour des unités déployées ;
- protection temporaire d’un convoi ou d’un poste de commandement.

### 6.2 Sécurité civile

- protection d’évènements publics ;
- festivals, concerts, cérémonies, discours politiques ;
- surveillance de foules exposées à une menace drone ;
- détection d’intrusions aériennes non autorisées.

### 6.3 Sites sensibles

- centrales nucléaires ;
- raffineries ;
- sites SEVESO ;
- usines d’armement ;
- infrastructures énergétiques ;
- centres de données stratégiques ;
- ports et aéroports.

### 6.4 Surveillance frontalière

- détection d’aéronefs non coopératifs ;
- surveillance de zones isolées ;
- complément à des capteurs déjà existants.

### 6.5 Aviation civile

- détection d’oiseaux aux abords des aéroports ;
- prévention du risque de collision aviaire ;
- surveillance de drones non autorisés près des pistes.

---

## 7. Positionnement

PAVOIS doit être présenté comme une **couche de détection, de localisation et d’aide à la décision**, et non comme un système autonome d’engagement.

Son rôle est de fournir à un opérateur :

- une alerte précoce ;
- une localisation fiable ;
- une trajectoire ;
- une estimation du type d’objet ;
- un niveau de confiance ;
- une aide à la priorisation des menaces.

---

## 8. Proposition de valeur

PAVOIS se positionne comme un **bouclier optique distribué** contre les menaces aériennes de basse altitude.

Sa promesse :

> Détecter tôt, localiser précisément, surveiller discrètement, déployer rapidement.
>