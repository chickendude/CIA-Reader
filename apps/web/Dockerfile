# Development image. Production builds use Dockerfile.prod.
FROM node:26.13.1-slim

RUN npm install --global pnpm@9.12.0

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-psycopg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app
COPY services/nlp/hindidb services/nlp/hindidb
COPY services/nlp/parhiba_hindi services/nlp/parhiba_hindi

# Workspace metadata for a cached `pnpm install`.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN pnpm install --frozen-lockfile

# Source is bind-mounted by docker-compose at runtime so Vite HMR sees host edits.

EXPOSE 5173

CMD ["pnpm", "--filter", "@ciareader/web", "dev"]
