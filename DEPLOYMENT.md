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

The Achraf OVH workflow (`deploy-ovh-achraf.yml`) reads, in order:

- `OVH_VPS_SSH_KEY` then `VPS_SSH_KEY`
- `OVH_VPS_HOST` then `VPS_HOST` (default `51.91.98.159`)
- `OVH_VPS_USER` then `VPS_USER` (default `ubuntu`)
- `OVH_VPS_PORT` then `VPS_PORT` (default `22`)
- `OVH_VPS_APP_DIR` then `VPS_APP_DIR` (default `/home/ubuntu/Pavois`)

Paste the **private** key (`BEGIN OPENSSH PRIVATE KEY` or `BEGIN RSA PRIVATE KEY`), not the `.pub`.

## What auto-deploy does

On every push to `main` or `master`, GitHub Actions will:

1. SSH into the VPS
2. `git pull` the latest commit
3. rebuild the containers
4. restart the stack with `docker compose up -d --build`
