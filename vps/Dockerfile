FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache python3 py3-opencv

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY classifier ./classifier

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3002/tcp
EXPOSE 41234/udp

CMD ["node", "dist/main.js"]
