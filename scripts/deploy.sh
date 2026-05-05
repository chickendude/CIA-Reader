#!/usr/bin/env bash
# Production deploy. Run from your laptop.
#
#   ./scripts/deploy.sh                  # deploy origin/main
#   ./scripts/deploy.sh <ref>            # deploy a specific branch / tag / sha
#   ./scripts/deploy.sh --dry-run        # print what we would run, do nothing
#   DEPLOY_HOST=root@... ./scripts/deploy.sh
#
# What it does:
#   1. SSH to the prod box.
#   2. git fetch + reset to the requested ref (detached HEAD).
#   3. docker compose up -d --build (web's startup applies pending
#      migrations; #408's backup service stays up across deploys).
#   4. Prune unused images so /var/lib/docker doesn't grow without
#      bound on a small CX/CCX disk.
#   5. From the laptop side, poll the public health endpoint until
#      it returns 200 or HEALTH_TIMEOUT elapses.
#   6. On timeout, fetch the last 50 lines of web logs and exit 1.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-root@parhiba.com}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/ciareader}"
HEALTH_URL="${HEALTH_URL:-https://parhiba.com/api/v1/smoke}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env"

DRY_RUN=0
REF=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,15p' "$0" | sed 's/^#//; s/^ //'
      exit 0
      ;;
    -*)
      echo "unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      if [ -n "$REF" ]; then
        echo "deploy.sh takes at most one positional ref" >&2
        exit 2
      fi
      REF="$arg"
      ;;
  esac
done
REF="${REF:-main}"

# Resolve the ref locally (best-effort, just for the human-readable
# log line — we still re-resolve on the box from origin).
LOCAL_SHA="$(git rev-parse --short "origin/$REF" 2>/dev/null || git rev-parse --short "$REF" 2>/dev/null || echo "?")"

cat <<EOF
==> Deploy summary
    target host:   $DEPLOY_HOST
    target path:   $DEPLOY_PATH
    ref:           $REF  ($LOCAL_SHA)
    health URL:    $HEALTH_URL
    health budget: ${HEALTH_TIMEOUT}s
EOF

if [ "$DRY_RUN" = "1" ]; then
  echo "==> --dry-run set; nothing executed"
  exit 0
fi

# Execute the deploy on the box. heredoc with quoted limiter so
# nothing on the laptop side gets prematurely expanded.
ssh -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 \
    "$DEPLOY_HOST" \
    bash -s -- "$REF" "$DEPLOY_PATH" "$COMPOSE_FILE" "$ENV_FILE" <<'REMOTE_SCRIPT'
set -euo pipefail
REF="$1"
DEPLOY_PATH="$2"
COMPOSE_FILE="$3"
ENV_FILE="$4"

cd "$DEPLOY_PATH"

echo "[box] $(hostname): fetching origin"
git fetch origin --tags --quiet

echo "[box] checking out $REF"
# Try origin/<ref> first (branch), then the literal ref (tag / sha).
if git rev-parse --verify --quiet "origin/$REF" >/dev/null; then
  git reset --hard "origin/$REF"
else
  git reset --hard "$REF"
fi
git --no-pager log --oneline -1

echo "[box] docker compose up -d --build"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

echo "[box] pruning dangling images"
docker image prune -f >/dev/null

echo "[box] deploy step complete"
REMOTE_SCRIPT

# Health check from the laptop side. We hit the public URL through
# Caddy → web, so a green check covers TLS, the proxy chain, the web
# server, AND the migrate step (which has to finish before web binds
# its port).
echo "==> Waiting for health: $HEALTH_URL (timeout ${HEALTH_TIMEOUT}s)"
ELAPSED=0
INTERVAL=2
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> ✓ Healthy after ${ELAPSED}s"
    exit 0
  fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  printf "."
done
echo ""
echo "==> ✗ Health check timed out after ${HEALTH_TIMEOUT}s"
echo "==> Last 50 lines of web logs:"
ssh "$DEPLOY_HOST" \
  "cd $DEPLOY_PATH && docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs --tail=50 web"
exit 1
