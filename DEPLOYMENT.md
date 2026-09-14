# VPS deployment

This project can run on a VPS with Docker Compose using these services:

- `vps` on UDP `41234` and HTTP/WebSocket `3002`
- `frontend-angular` on HTTP `8080`
- `postgres` (internal only, no published port) -- stores confirmed tracks and alerts

Three GitHub Actions workflows deploy this, each to its own target:

| Workflow | Trigger branches | Target | Compose file |
| --- | --- | --- | --- |
| `deploy-vps.yml` | `main`, `master` | `secrets.VPS_HOST` | `docker-compose.yml` |
| `deploy-vps.yml` | `securite` (if dispatched against that ref) | `secrets.VPS_HOST`, `-securite` dir | `docker-compose.securite.yml` |
| `deploy-ovh-achraf.yml` | `main`, `securite` | the OVH staging box | `docker-compose.staging.yml` |

## First-time VPS setup

1. Install Docker and Docker Compose on the VPS.
2. Add the GitHub repository secrets listed below.
3. Push to a branch that workflow watches (or run it via "Run workflow").

That's it -- **nothing needs to be created or edited by hand on the VPS**. The deploy
scripts (`scripts/deploy_vps.sh`, `scripts/deploy_staging.sh`) regenerate `.env` and
`vps/.env`(`.staging`) from the secrets on every deploy, so moving to a new VPS or
rotating a credential is just a secret update + a redeploy, not an SSH session.

If a deploy ever runs with those secrets *not* set (e.g. someone invokes the script by
hand outside CI), it falls back to the old behaviour: `.env`/`vps/.env` are created once
from the `*.example` templates with placeholder values and then left alone, so you can
still edit them manually for a one-off local/manual deployment.

## GitHub Action secrets

### Connection secrets (how Actions reaches the box)

- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`, `VPS_APP_DIR` -- for `deploy-vps.yml`.
  `VPS_APP_DIR` is the absolute path of the repo on the VPS, e.g. `/home/deploy/Pavois`.
- `OVH_VPS_HOST`, `OVH_VPS_USER`, `OVH_VPS_SSH_KEY`, `OVH_VPS_PORT`, `OVH_VPS_APP_DIR` --
  for `deploy-ovh-achraf.yml` (all have defaults baked into the workflow if unset).

### Application secrets (written into the runtime `.env` files on every deploy)

Each deploy target gets its **own** token/password -- never reuse one across
environments.

- `WS_AUTH_TOKEN` -- prod (`main` via `deploy-vps.yml`). Backend auth token; also what
  operators paste into the frontend login screen.
- `POSTGRES_PASSWORD` -- prod Postgres password.
- `SECURITE_WS_AUTH_TOKEN` / `SECURITE_POSTGRES_PASSWORD` -- the `securite` variant
  (only relevant if that path is ever dispatched via `deploy-vps.yml`).
- `STAGING_WS_AUTH_TOKEN` / `STAGING_POSTGRES_PASSWORD` -- the OVH staging box, via
  `deploy-ovh-achraf.yml`.

Generate strong random values, e.g. `openssl rand -hex 32` for tokens and
`openssl rand -hex 24` for the Postgres password.

`ALLOWED_ORIGINS` (backend CORS/WS allowlist) is **not** a secret you set directly --
each workflow derives it from the relevant `*_HOST` secret and that target's known
public port (`:8080` prod, `:8081` securite/staging), so it automatically follows a
host change instead of needing to be hand-edited.

`PAVOIS_API_URL` / `PAVOIS_WS_BASE_URL` are deliberately left blank: the frontend then
uses the page's own origin through the Nginx `/api` and `/ws` proxies, which works for
any host without configuration. `PAVOIS_DEV_TOKEN` (optional login-screen prefill) can
be set the same way as the other app secrets if you want it; leaving it unset is fine
and arguably more correct for anything public-facing.

## What auto-deploy does

On every push to a watched branch, GitHub Actions will:

1. SSH into the target VPS.
2. `git fetch` + force-checkout the pushed branch (untracked files like `.env` are left
   alone by this step).
3. Regenerate `.env` and `vps/.env`(`.staging`) from the GitHub secrets above.
4. `docker compose up -d --build` to rebuild and restart the stack.
