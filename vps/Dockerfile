# Étape 1: Construction de l'application NestJS
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm i

# Copie du code source et compilation
COPY . .
RUN npm run build

# Étape 2: Image finale de production
FROM node:22-alpine AS runner

WORKDIR /app

# OpenCV runs only on the VPS, once per three-photo classification request.
RUN apk add --no-cache python3 py3-opencv

COPY package*.json ./
RUN npm i --omit=dev

# Copie du build compilé depuis l'étape builder
COPY --from=builder /app/dist ./dist
COPY classifier ./classifier

# Ports HTTP/WebSocket (3002 par défaut) et UDP (41234 par défaut)
EXPOSE 3002/tcp
EXPOSE 41234/udp

# Dossier de données JSONL (alerts.jsonl, tracks.jsonl, camera-states.jsonl)
RUN mkdir -p /app/data && chown node:node /app/data

# SÉCURITÉ NIVEAU 2 : Basculement vers l'utilisateur non-privilégié 'node' (Principle of Least Privilege)
USER node

# Démarrage direct de l'application Node.js
CMD ["node", "dist/main.js"]
