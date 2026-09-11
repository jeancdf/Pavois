# Où se rencontrent les trois caméras ? (SCRUM-56)

**Décision (11 septembre 2026) : sur le VPS.**

Les trois Raspberry Pi détectent chacune des taches dans leur image et
envoient ça au serveur. Le serveur est déjà le seul endroit qui voit les
trois flux. On y pose le bac commun. On ne met pas ce bac sur une Pi, et
on ne lance pas un second programme C++ à côté.

## La question, en une phrase

Quand les trois caméras voient le même objet, **où** calcule-t-on le point
3D ? (Ce calcul viendra ensuite, ticket SCRUM-58. Ici on tranche seulement
l’endroit.)

## Les trois options

| | Option | En gros |
|---|---|---|
| 1 | **VPS (retenue)** | Les Pi envoient leurs détections. Le serveur NestJS les range et, plus tard, calcule le 3D. |
| 2 | Pi maîtresse | Une Pi récupère les deux autres et fusionne en C++. |
| 3 | Processus C++ à part | On garde le binaire `pavois++` à côté du VPS, alimenté en UDP. |

## Comparaison

**Latence.** Les Pi envoient déjà l’UDP vers le VPS. Option 1 : un saut
réseau, puis un calcul sur la machine qui parle déjà au frontend. Option 2 :
trafic en plus entre Pi, et si la maîtresse est lente (Pi 4), tout attend.
Option 3 : encore un saut (Pi → process C++ → NestJS → carte). Option 1
est le chemin le plus court vers l’écran.

**Pannes.** Option 2 : si la Pi maîtresse tombe, plus de 3D du tout, même
si les deux autres voient encore. Option 1 : une Pi en moins = il reste
deux caméras ; le VPS continue. Option 3 : un service de plus à garder
en vie. On préfère un seul point connu (le VPS) plutôt qu’une Pi au
fond du jardin.

**Effort et code déjà testé.** Le C++ de `pavois++` (croisement de rayons,
Kalman) est bon. Option 2 et 3 le réutilisent tel quel. Option 1 demande
de le recopier en TypeScript dans `FusionService`. C’est du travail
(SCRUM-58, SCRUM-59), mais le bac existe déjà côté VPS (SCRUM-57), et
c’est là que la carte écoute. Recopier un algo connu coûte moins cher
que d’inventer un second déploiement.

## Pourquoi le VPS, concrètement

1. C’était l’intention de départ : trois Pi, un serveur, une carte.
2. L’audit Pi le disait déjà : une caméra par Pi, donc la fusion
   multi-caméras ne peut plus vivre dans un seul processus Pi.
3. SCRUM-57 a déjà posé `FusionService` dans `vps/` : historique par
   caméra, `GET /fusion` pour voir qui parle. Le bac est là.

## Ce que ça change pour la suite

- **SCRUM-58** : porter la triangulation C++ **dans** `FusionService`
  (TypeScript), pas un wrapper du binaire.
- **SCRUM-59** : pareil pour le Kalman.
- **SCRUM-60** : le tracker VPS envoie `track_update` au frontend, comme
  aujourd’hui quand on injecte une fausse piste `obj1,...`.

On n’ouvre pas de chantier « Pi maîtresse » ni « sidecar C++ », sauf
si le portage TypeScript se révèle trop lent ou trop faux — auquel cas
on reviendrait sur l’option 3, pas sur l’option 2.
