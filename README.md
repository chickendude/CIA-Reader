# CIA Reader

**Comparative Indo-Aryan** — a LingQ-style web reader focused on Indo-Aryan languages, with lemma-based known-words tracking, morphological feedback, and optional romanization.

MVP languages: **Hindi**, **Marathi**, **Odia**.

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

## Status

Early. See [GitHub Issues](https://github.com/chickendude/CIA-Reader/issues) — each milestone is an epic with child tickets.
