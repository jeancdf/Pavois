# Rapport de Sécurité Niveau 2 — Isolation Conteneurs & Hardening Docker

**Projet** : PAVOIS (Protection Avancée de Voxels pour l'Observation et l'Identification de Signatures)  
**Niveau de Sécurité** : 2 sur 4 (Hardening Runtime Docker & Confinement de Conteneur)  
**Date** : Août 2026  
**Statut** : ✅ Spécifié, configuré et prêt pour déploiement  

---

## 1. Comprendre le Niveau 2 en 1 Minute (Synthèse pour l'Équipe & le Jury)

> **Analogie Pédagogique : "Le Château et la Prison"**
> 
> * **Niveau 1** : Nous avons construit des remparts autour du château (Pare-feu UFW, verrous SSH, protections anti-attaque du système VPS). Le serveur physique/virtuel est protégé de l'extérieur.
> * **Niveau 2** : Si un pirate réussissait malgré tout à passer à travers une faille du code applicatif (ex: une faille dans NestJS ou un paquet `npm`), **il atterrit dans une prison numérique hermétique** :
>   1. Il n'est **pas root** (utilisateur simple `node` sans droits d'administration).
>   2. Le disque dur est en **lecture seule** (`read_only: true`) : impossible pour lui d'installer un virus, un webshell ou de modifier un fichier.
>   3. Il n'a **aucune capacité noyau** (`cap_drop: ALL`) : impossible de modifier les cartes réseau ou les paramètres de l'OS.
>   4. Ses ressources sont **plafonnées** (512 Mo de RAM max) : impossible de faire crasher le VPS par saturation DoS.

---

## 2. Architecture de la Défense en Profondeur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERNET / RÉSEAU PUBLIC                         │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 : HARDENING HÔTE VPS LINUX (VALIDE)                            │
│  • UFW Firewall (Ports 22, 443, 5000 uniquement)                        │
│  • SSH Clés Ed25519 uniquement (Mots de passe & root bloqués)          │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 🛡️ NIVEAU 2 : ISOLATION DOCKER & CONTENEURS (CE RAPPORT)                │
│                                                                         │
│  [1] `USER node` ──────────────► Non-root (UID 1000)                    │
│  [2] `.env` dynamique ────────► Injections mémoire (0 secret dans image)│
│  [3] `read_only: true` ────────► Système de fichiers immuable           │
│  [4] `cap_drop: ALL` ──────────► Suppression totale privilèges Kernel   │
│  [5] Resource Quotas ──────────► RAM 512 Mo / CPU 1.0 (Anti-DoS)        │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 3 & 4 : BACKEND NESTJS, UDP HMAC & BASE DE DONNÉES               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Détail Technique des 5 Piliers du Niveau 2

### Pilier 1 : Exécution sous Utilisateur Non-Root (`USER node`)
* **Le Risque** : Par défaut, Docker lance les conteneurs en tant que `root` (UID 0). Si un attaquant réussit une évasion de conteneur (*Container Escape*), il devient automatiquement administrateur suprême de tout le serveur VPS.
* **La Solution PAVOIS** : Dans [vps/Dockerfile](file:///c:/Users/Lucli/drone/Pavois/vps/Dockerfile), nous basculons explicitement sur l'utilisateur `node` fourni par l'image Alpine Linux.

### Pilier 2 : Protection des Secrets (Aucun `.env` dans l'image Docker)
* **Le Risque** : Inclure le fichier `.env` lors de la construction de l'image Docker enregistre les mots de passe et clés secrètes dans l'historique des layers de l'image.
* **La Solution PAVOIS** : Injection dynamique des variables d'environnement via `env_file: - ./vps/.env` dans `docker-compose.yml`.

### Pilier 3 : Système de Fichiers en Lecture Seule (`read_only: true`)
* **Le Risque** : Lorsqu'un pirate prend la main sur un service Web, son premier réflexe est de télécharger un script malveillant.
* **La Solution PAVOIS** : Le conteneur est lancé avec `read_only: true`. Le seul dossier inscriptible est `/tmp`, qui est monté en RAM volatile via `tmpfs`.

### Pilier 4 : Révocation des Capacités Noyau Linux (`cap_drop: ALL`)
* **La Solution PAVOIS** : Suppression intégrale de toutes les capacités du noyau Linux au niveau du conteneur.

### Pilier 5 : Quotas Strict de Ressources (RAM & CPU)
* **La Solution PAVOIS** : Limite de mémoire fixée à 512 Mo et CPU 1.0 pour prévenir l'épuisement des ressources par DoS.

---

## 4. Guide de Démonstration en Direct (Pour Soutenance / Présentation)

Pour prouver au jury ou à votre équipe que le Niveau 2 est actif et fonctionnel, voici **3 commandes de démonstration à exécuter** sur le VPS :

### Démo 1 : Prouver que le conteneur est Non-Root
```bash
docker exec pavois-vps-server whoami
# Résultat attendu : node  (et non 'root')
```
> **Explication à donner** : *"Le conteneur s'exécute avec l'utilisateur système restreint 'node'. Un attaquant ne dispose d'aucun droit d'administration."*

### Démo 2 : Prouver l'immuabilité du système de fichiers (Read-Only)
```bash
docker exec pavois-vps-server touch /app/hacked.txt
# Résultat attendu : touch: /app/hacked.txt: Read-only file system
```
> **Explication à donner** : *"Même si un pirate injectait du code, il lui est physiquement impossible d'écrire un fichier sur le disque du conteneur."*

### Démo 3 : Vérifier l'absence du fichier `.env` dans le conteneur
```bash
docker exec pavois-vps-server ls -la /app/.env
# Résultat attendu : ls: /app/.env: No such file or directory
```
> **Explication à donner** : *"Le fichier d'environnement contenant les secrets n'est pas cuit dans l'image Docker. Il est injecté directement en mémoire à l'initialisation."*
