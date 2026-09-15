# Étape 1: Construction de l'application NestJS
FROM node:22-alpine AS builder

WORKDIR /app

# Le postinstall Prisma a besoin du schéma à côté de package.json.
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm i

# Copie du code source et compilation
COPY . .
RUN npm run build

# Étape 2: Image finale de production
FROM node:22-alpine AS runner

WORKDIR /app

# OpenCV runs only on the VPS, once per three-photo classification request.
RUN apk add --no-cache python3 py3-opencv

# Dépendances de production + client Prisma (généré par postinstall).
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm i --omit=dev

# Copie du build compilé depuis l'étape builder (SANS le fichier .env)
COPY --from=builder /app/dist ./dist
COPY classifier ./classifier

# Ports HTTP/WebSocket (3002 par défaut) et UDP (41234 par défaut)
EXPOSE 3002/tcp
EXPOSE 41234/udp

# Positions des caméras (volume Docker monté sur /app/data) : un volume neuf reprend
# le propriétaire de ce dossier, sinon 'node' ne pourrait pas y écrire (read_only)
RUN mkdir -p /app/data && chown node:node /app/data

# SÉCURITÉ NIVEAU 2 : Basculement vers l'utilisateur non-privilégié 'node' (Principle of Least Privilege)
USER node

# Applique les migrations en attente puis démarre le serveur. Uniquement du
# trafic réseau vers Postgres : aucune écriture disque nécessaire malgré le
# système de fichiers en lecture seule (docker-compose.yml).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
