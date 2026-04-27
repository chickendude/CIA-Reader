# Development-only image. Production image lands in M13.
FROM node:20.18-slim

ENV PNPM_HOME=/usr/local/pnpm \
    PATH=/usr/local/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /srv/app

# Workspace metadata for a cached `pnpm install`.
COPY pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN pnpm install --frozen-lockfile=false

# Source is bind-mounted by docker-compose at runtime so Vite HMR sees host edits.

EXPOSE 5173

CMD ["pnpm", "--filter", "@ciareader/web", "dev"]
