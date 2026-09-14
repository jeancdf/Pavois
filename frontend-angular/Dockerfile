FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm i --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/frontend-angular/browser /usr/share/nginx/html
COPY docker-entrypoint.d/40-env-js.sh /docker-entrypoint.d/40-env-js.sh

ENV PAVOIS_API_URL= \
    PAVOIS_WS_BASE_URL= \
    PAVOIS_DEV_TOKEN=

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
