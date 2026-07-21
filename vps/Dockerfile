# Étape 1: Construction de l'application NestJS
FROM node:20-alpine AS builder

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
RUN npm ci

# Copie du code source et compilation
COPY . .
RUN npm run build

# Étape 2: Image finale de production
FROM node:20-alpine AS runner

WORKDIR /app

# Copie des dépendances de production uniquement
COPY package*.json ./
RUN npm ci --only=production

# Copie du build compilé depuis l'étape builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env ./.env

# Ports HTTP/WebSocket (3002 par défaut) et UDP (41234 par défaut)
EXPOSE 3002/tcp
EXPOSE 41234/udp

# Démarrage du serveur VPS
CMD ["node", "dist/main.js"]
