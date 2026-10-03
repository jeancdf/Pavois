# VPS deployment

This project can run on a VPS with Docker Compose using these services:

- `vps` on UDP `41234` and HTTP/WebSocket `3002`
- `frontend-angular` on HTTP `8080`

## First-time VPS setup

1. Install Docker and Docker Compose on the VPS.
2. Clone this repository on the VPS.
3. Create the runtime env files:

```bash
cp .env.example .env
cp vps/.env.example vps/.env
```

4. Update `.env` with your public VPS address:

```env
PAVOIS_API_URL=
PAVOIS_WS_BASE_URL=ws://YOUR_VPS_IP:3002
PAVOIS_DEV_TOKEN=
```

Leaving `PAVOIS_API_URL` empty makes the frontend use the same VPS host through Nginx for HTTP:

- `http://YOUR_VPS_IP:8080/api` -> `vps`

For WebSocket, the frontend connects directly to the Nest server:

- `ws://YOUR_VPS_IP:3002`

5. Update `vps/.env` for production, especially:

```env
PORT=3002
UDP_PORT=41234
WS_AUTH_TOKEN=replace-me
ALLOWED_ORIGINS=http://YOUR_VPS_IP:8080,https://your-domain.tld
```

Your gateway should send UDP packets to:

- `YOUR_VPS_IP:41234`

Camera positions edited from the frontend (sidebar form or drag and drop on the map) are
saved by `vps` through `PUT /api/cameras/:id/position` (same `WS_AUTH_TOKEN`, sent as
`Authorization: Bearer`). They are stored in the `pavois-data` Docker volume
(`/app/data/cameras.json`); `docker compose down -v` deletes them.

6. Start the stack:

```bash
chmod +x scripts/deploy_vps.sh frontend-angular/docker-entrypoint.d/40-env-js.sh
./scripts/deploy_vps.sh
```

## GitHub Action secrets

Add these repository secrets (Settings → Secrets and variables → Actions):

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT`
- `VPS_APP_DIR`

`VPS_APP_DIR` should be the absolute path of the repo on the VPS, for example `/home/deploy/Pavois`.

Push to `main` deploys the live stack on the Achraf OVH VPS
(`ubuntu@51.91.98.159`) via `deploy-ovh-achraf.yml` + `scripts/deploy_vps.sh`.

SSH user is `ubuntu`. The private key is `OVH_VPS_SSH_KEY` if set, otherwise
`VPS_SSH_KEY`. Put the matching public key in
`/home/ubuntu/.ssh/authorized_keys`. Optional: `OVH_VPS_HOST`, `OVH_VPS_PORT`,
`OVH_VPS_APP_DIR` (default `/home/ubuntu/Pavois`).

The app is then on:

- Frontend: `http://51.91.98.159:8080`
- WebSocket: `ws://51.91.98.159:3002`
- UDP: `51.91.98.159:41234`

Do not put the production account `jean` in `OVH_VPS_USER`.

## What auto-deploy does

On every push to `main`, GitHub Actions will:

1. SSH into the OVH VPS as `ubuntu`
2. `git pull` the latest commit
3. rebuild the containers
4. restart the stack with `docker compose up -d --build`
