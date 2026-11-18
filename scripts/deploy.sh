#!/usr/bin/env bash
# Production deploy. Run from your laptop.
#
#   ./scripts/deploy.sh                  # deploy origin/main
#   ./scripts/deploy.sh <ref>            # deploy a specific branch / tag / sha
#   ./scripts/deploy.sh --dry-run        # print what we would run, do nothing
#   ./scripts/deploy.sh --no-build       # force-skip the rebuild (fastest)
#   ./scripts/deploy.sh --build          # force a rebuild even if auto-detect skips
#   DEPLOY_HOST=root@... ./scripts/deploy.sh
#
# Auto mode builds only the services whose image inputs changed.
# Compose still applies configuration changes to the whole stack.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-root@parhiba.com}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/ciareader}"
HEALTH_URL="${HEALTH_URL:-https://parhiba.com/healthz}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env"

DRY_RUN=0
BUILD_MODE="auto"   # auto | force | skip
REF=""
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    --build|-b)   BUILD_MODE="force" ;;
    --no-build|-B) BUILD_MODE="skip" ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^#//; s/^ //'
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
    build mode:    $BUILD_MODE
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
    bash -s -- "$REF" "$DEPLOY_PATH" "$COMPOSE_FILE" "$ENV_FILE" "$BUILD_MODE" <<'REMOTE_SCRIPT'
set -euo pipefail
REF="$1"
DEPLOY_PATH="$2"
COMPOSE_FILE="$3"
ENV_FILE="$4"
BUILD_MODE="$5"

cd "$DEPLOY_PATH"

# Serialize checkout and image updates on this server.
exec 9>"$(git rev-parse --git-path deploy.lock)"
flock 9

# Keep the previous revision across a failed build, even though the server
# checkout advances before Docker runs. Bootstrap from the current checkout.
BUILD_REF=refs/deploy/build-baseline
if ! git show-ref --verify --quiet "$BUILD_REF"; then
  git update-ref "$BUILD_REF" HEAD
fi
OLD_HEAD="$(git rev-parse "$BUILD_REF")"

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

NEW_HEAD="$(git rev-parse HEAD)"

compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
built=false

# git diff returns 1 for changes and a higher status for errors.
changed() {
  local result=0
  git diff --quiet "$OLD_HEAD" "$NEW_HEAD" -- "$@" || result=$?
  if (( result > 1 )); then exit "$result"; fi
  (( result == 1 ))
}

case "$BUILD_MODE" in
  force)
    "${compose[@]}" build
    built=true
    ;;
  auto)
    services=()
    if changed apps/web packages/shared-types pnpm-lock.yaml pnpm-workspace.yaml package.json .dockerignore; then
      services+=(web)
    fi
    if changed services/nlp packages/shared-types/python .dockerignore; then
      services+=(nlp)
    fi
    if changed infra/backup; then
      services+=(backup)
    fi
    if (( ${#services[@]} )); then
      echo "[box] Building ${services[*]}"
      "${compose[@]}" build "${services[@]}"
      built=true
    else
      echo "[box] No image inputs changed"
    fi
    ;;
  skip)
    echo "[box] Skipping requested image builds"
    ;;
esac

"${compose[@]}" up -d

# The Caddyfile is bind-mounted (./Caddyfile:/etc/caddy/Caddyfile),
# so a `git reset --hard` updates the file on disk but compose has
# no reason to recreate the caddy container — its image and
# compose-config are unchanged. Caddy keeps running with the in-
# memory config it loaded at boot, and any new site blocks (new
# subdomains, header changes) silently don't take effect.
# Detect Caddyfile-touching diffs and restart caddy explicitly.
if changed infra/Caddyfile; then
  echo "[box] Caddyfile changed, restarting caddy to pick it up"
  "${compose[@]}" restart caddy
fi

# An explicit skip can leave the images behind the checkout. Let the next
# auto deploy pick up those changes.
if [[ "$BUILD_MODE" != skip ]]; then
  git update-ref "$BUILD_REF" "$NEW_HEAD"
fi

if [[ "$built" == true ]]; then
  echo "[box] pruning dangling images"
  docker image prune -f >/dev/null
fi

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
