# Analyse de la problématique – Projet PAVOIS

## 1. Expression de la problématique

De nombreux objets rapides ou difficiles à suivre peuvent apparaître dans un espace surveillé : balle pendant un match, objet volant dans un festival, projectile léger ou élément non identifié. Le problème est de détecter ces objets en mouvement et d’estimer leur position afin d’aider un opérateur à comprendre rapidement la situation.

PAVOIS propose une solution de détection passive par caméras : les mouvements observés dans plusieurs images sont projetés dans un espace 3D afin de localiser et suivre les objets mobiles sans nécessiter de capteur actif.

### 1.1 Enrichissement de la problématique avec chiffres, statistiques et arguments

La surveillance humaine atteint rapidement ses limites lorsqu’il faut suivre des objets de petite taille et à grande vitesse :

- Une balle de tennis peut dépasser 200 km/h.
- Un drone civil peut voler à plus de 50 km/h.
- Les opérateurs vidéo doivent souvent surveiller simultanément plusieurs écrans, ce qui augmente la fatigue visuelle.
- La charge cognitive réduit les performances de détection et augmente le risque d’erreurs.
- Les fausses alertes peuvent ralentir la prise de décision et diminuer la confiance dans le système.

Ces éléments montrent que la surveillance visuelle seule n’est pas suffisante pour détecter efficacement des objets rapides.

### 1.2 Formulation détaillée de la problématique

Comment détecter automatiquement des objets mobiles rapides ou difficiles à suivre à partir de plusieurs caméras passives, reconstruire leur position en trois dimensions et fournir en temps réel une information fiable permettant à un opérateur de comprendre rapidement la situation et de prendre les bonnes décisions ?

---

## 2. Identification et segmentation des parties prenantes

### 2.1 Utilisateurs directs

Les utilisateurs directs sont ceux qui exploitent le système au quotidien.

- Opérateurs de supervision vidéo
- Responsables sécurité
- Agents d’intervention
- Coordinateurs opérationnels

### 2.2 Décideurs et financeurs

Ce sont les personnes ou organisations qui financent le projet et valident son déploiement.

- Directions sécurité et sûreté
- Directions d’exploitation
- Directions innovation
- Organisateurs d’événements
- Collectivités territoriales

### 2.3 Parties prenantes techniques

Ces acteurs participent à l’intégration et à la maintenance du système.

- Intégrateurs de systèmes
- Équipes informatiques
- Fournisseurs de caméras
- Développeurs du projet

### 2.4 Bénéficiaires indirects

- Personnel sur site
- Public présent dans la zone surveillée
- Clients et usagers

---

## 3. Où se situe la principale source de douleur ?

La principale source de douleur se situe dans la détection et l’interprétation en temps réel des objets mobiles.

### 3.1 Difficultés actuelles

- Objets trop rapides pour être suivis visuellement
- Taille réduite des objets
- Conditions d’éclairage variables
- Présence de nombreux mouvements parasites
- Difficulté à localiser précisément l’objet

### 3.2 Conséquences opérationnelles

- Détection tardive
- Mauvaise localisation
- Temps de réaction élevé
- Fausses alertes
- Stress des opérateurs

### 3.3 Douleur principale

Les opérateurs ne disposent pas d’une information fiable et immédiate sur la position et la trajectoire de l’objet, ce qui retarde la prise de décision.

---

## 4. D’où vient l’argent ?

Cette question est pertinente car elle permet d’identifier les acteurs qui financent la solution et les bénéfices attendus.

### 4.1 Sources de financement

- Budgets sécurité et sûreté
- Budgets exploitation
- Budgets innovation
- Programmes de recherche et développement
- Financements publics

### 4.2 Motivations économiques

Les financeurs attendent :

- une réduction du temps de réaction ;
- une amélioration de la sécurité ;
- une diminution des interruptions d’activité ;
- une réduction des fausses alertes ;
- un retour sur investissement mesurable.

---

## 5. Enquêtes auprès des utilisateurs

### 5.1 Situation actuelle

Aucune enquête terrain formelle n’a encore été réalisée.

### 5.2 Méthodologie recommandée

Afin de mieux comprendre les besoins, il est recommandé de réaliser :

- 8 à 15 entretiens semi-directifs ;
- un questionnaire de 10 à 15 questions ;
- un atelier de priorisation.

### 5.3 Exemples de questions

- Quels objets sont les plus difficiles à détecter ?
- Quel délai maximal de détection est acceptable ?
- Quel taux de fausses alertes est tolérable ?
- Quelles informations doivent être affichées en priorité ?

### 5.4 Résultats attendus

- Identification des besoins prioritaires
- Définition des seuils de performance
- Contraintes de déploiement
- Critères d’acceptation métier

### 5.5 Annexe à joindre au rapport final

- Questionnaire utilisateur
- Guide d’entretien
- Synthèse des réponses

---

## 6. Hiérarchisation des priorités

Les besoins sont classés par ordre d’importance.

### Priorité 1 : Détection rapide

Le système doit détecter l’objet en moins d’une seconde.

### Priorité 2 : Localisation 3D précise

La position et la trajectoire doivent être fiables.

### Priorité 3 : Réduction des faux positifs

Le système doit limiter les alertes inutiles.

### Priorité 4 : Visualisation claire

Les résultats doivent être faciles à interpréter.

### Priorité 5 : Simplicité de déploiement

La solution doit être simple à installer et calibrer.

### Priorité 6 : Interopérabilité

Le système doit s’intégrer aux infrastructures existantes.

---

## 7. Critères de performance

| Critère | Objectif |
|------|------|
| Temps de détection | < 1 seconde |
| Taux de détection | > 95 % |
| Taux de faux positifs | < 5 % |
| Précision de localisation | Conforme aux besoins opérationnels |
| Disponibilité | > 99 % |

---

## 8. Conclusion

Le projet PAVOIS répond à un besoin concret : détecter automatiquement des objets rapides ou difficiles à suivre et estimer leur position à partir de plusieurs caméras passives.

L’analyse met en évidence :

- des parties prenantes clairement identifiées ;
- une douleur opérationnelle importante ;
- des financeurs motivés par l’amélioration de la sécurité et de l’efficacité ;
- la nécessité de recueillir les besoins utilisateurs ;
- des priorités fonctionnelles bien définies.

La réussite du projet dépendra de la capacité de la solution à fournir une localisation fiable en temps réel avec une faible latence et un nombre réduit de fausses alertes.
