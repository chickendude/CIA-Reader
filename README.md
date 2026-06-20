# CIA Reader

**Comparative Indo-Aryan** — a LingQ-style web reader focused on Indo-Aryan languages, with lemma-based known-words tracking, morphological feedback, and optional romanization.

MVP languages: **Hindi**, **Marathi**, **Odia**. Also supported: **Yiddish** —
the first language outside the Indo-Aryan family (Hebrew script,
right-to-left, YIVO romanization), which exercises the registry's
script-agnostic design end to end.

## Repo layout

```
apps/web/             SvelteKit + TypeScript (web UI + BFF + /api/v1/*)
services/nlp/         FastAPI + Stanza + IndicNLP (stateless NLP service)
packages/shared-types Cross-language shared code (language registry, etc.)
infra/                docker-compose.yml, Caddyfile, Dockerfiles
scripts/              One-off tooling (issue bootstrap, etc.)
```

## Local development

Requirements:

- **Docker Desktop** (or Docker Engine + Compose v2)
- **Node.js** 20.x and **pnpm** 9.x (only needed if you want to run the web app outside Docker)
- **Python** 3.11+ (only needed if you want to run NLP tests outside Docker)

Start everything:

```
make dev
# or
pnpm dev
```

That boots postgres + redis + the NLP service + the SvelteKit dev server (with hot reload).

- Web: http://localhost:5173
- NLP: http://localhost:8000 (health at `/health`)
- Postgres: `localhost:5432` (user `ciareader`, password `ciareader`, db `ciareader`)
- Redis: `localhost:6379`
- API docs: http://localhost:5173/api/docs
- Client API reference: http://localhost:5173/docs/api/
- API versioning policy: [docs/api-versioning.md](docs/api-versioning.md)

### Custom host ports

If any of the default ports collide with another local service (e.g. another Postgres on `5432`), copy [`infra/.env.example`](infra/.env.example) to `infra/.env` and override only what you need — `docker compose` reads `infra/.env` automatically. Example:

```
# infra/.env
POSTGRES_HOST_PORT=55432
```

When you change the Postgres host port, also point the web app at it via `apps/web/.env`:

```
# apps/web/.env
DATABASE_URL=postgres://ciareader:ciareader@localhost:55432/ciareader
```

Both `.env` files are gitignored.

Smoke test (proves the full pipe works):

```
make smoke
# hits http://localhost:5173/api/v1/smoke which calls the NLP service and returns a canned result
```

## Scripts

- `pnpm lint` — lint all workspaces
- `pnpm typecheck` — typecheck all workspaces
- `pnpm format` — prettier across the repo
- `make dev` / `make dev-down` — start / stop the dev stack
- `make install-nlp` — create `.venv` for the NLP service (for running `pytest` directly)

## Production deployment

The production stack is a separate compose file: [`infra/docker-compose.prod.yml`](infra/docker-compose.prod.yml). It boots `web`, `nlp`, `postgres`, `redis`, and `caddy` on a single Hetzner CX/CCX box. Caddy is the only service that binds host ports (80 / 443); everything else stays on the internal docker network.

**Before first deploy:** point your DNS A (and ideally AAAA) record for `APP_DOMAIN` at the deploy host's public IP. Caddy fetches the Let's Encrypt cert via an HTTP-01 challenge against that record, so wrong DNS = no cert and a Let's Encrypt rate-limit you don't want to hit twice.

On the deploy host:

```
cp infra/.env.prod.example infra/.env
# edit infra/.env — fill POSTGRES_PASSWORD, AUTH_SECRET, SMTP_*, APP_BASE_URL,
# APP_DOMAIN, ACME_EMAIL
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build
```

The web service's startup command runs `apps/web/scripts/migrate-prod.mjs` (drizzle-orm's migrator — no drizzle-kit dependency at runtime) before starting the SvelteKit server, so a fresh deploy applies any pending migrations automatically.

### TLS / first-deploy safety

For the very first deploy, set `ACME_CA` to Let's Encrypt staging in `infra/.env`:

```
ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

Staging certs aren't browser-trusted (you'll see a security warning) but the rate limit is 100× higher, so a misconfiguration can't lock you out for a week. Once you've confirmed Caddy successfully issues a staging cert, comment that line out and `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d` again — Caddy will swap to production. The `caddy-data` volume persists the new cert across restarts.

### Backups

The `backup` service runs as a sidecar in the prod compose stack. Cron jobs `pg_dump` the DB nightly and tar the audio volume weekly, uploading both via `rclone` to whatever remote you've configured (Dropbox, B2, Hetzner Storage Box, etc.). Setup walkthrough + restore procedure: [`infra/backup/README.md`](infra/backup/README.md).

### Deploying a change

Once `infra/.env` exists on the box and the stack is running, deploys are a single command from your laptop:

```
./scripts/deploy.sh                   # deploy origin/main
./scripts/deploy.sh <branch-or-sha>   # deploy a specific ref (preview branches, hotfixes)
./scripts/deploy.sh --dry-run         # print the plan without touching the box
```

The script SSHes to the box, fast-forwards the repo at `/opt/ciareader`, runs `docker compose up -d --build` (auto-skips `--build` when no image-relevant files changed), prunes dangling images, and then polls `https://parhiba.com/healthz` from the laptop side until it returns 200. On health-check timeout it prints the last 50 lines of web logs and exits non-zero, so a failed deploy is loud and diagnosable.

Override host / path with env vars: `DEPLOY_HOST=root@example.com ./scripts/deploy.sh`.

### Monitoring

Each service exposes `/healthz`:

- **`https://parhiba.com/healthz`** — web. 200 + `{status:"ok"}` when the process is up and can reach Postgres; 503 if the DB is unreachable.
- **NLP `/healthz`** (internal `http://nlp:8000/healthz`) — alias of the existing `/health`. 200 + the supported language list.

The prod stack also runs an [Uptime Kuma](https://github.com/louislam/uptime-kuma) sidecar at `https://status.<APP_DOMAIN>` (e.g. `https://status.parhiba.com`). DNS prerequisite: an A (and ideally AAAA) record for `status.<APP_DOMAIN>` pointing at the deploy host before first boot — Caddy issues a separate Let's Encrypt cert for it via the same auto-TLS pipeline.

First-time setup is two clicks: visit `https://status.<APP_DOMAIN>` to create the admin account, then add monitors for `https://<APP_DOMAIN>/healthz` and any other endpoints worth tracking. Notification channels (email, Discord, Slack, Telegram, etc.) are configured in Kuma's UI; nothing in this repo to wire.

If you'd rather use an external SaaS (UptimeRobot, BetterStack), comment out the `kuma` service + the `status.{$APP_DOMAIN}` block in the Caddyfile and point the SaaS at `https://parhiba.com/healthz`.

Logs: docker's json-file driver is rotated at 10 MB × 5 files per service in [`infra/docker-compose.prod.yml`](infra/docker-compose.prod.yml), so `/var/lib/docker` doesn't grow without bound. View live logs via `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env logs -f <service>`.

## Status

Early. See [GitHub Issues](https://github.com/chickendude/CIA-Reader/issues) — each milestone is an epic with child tickets.
