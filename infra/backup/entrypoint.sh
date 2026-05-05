#!/bin/bash
# Validates required env, persists it for cron children (cron's own
# shell starts with a near-empty env), then exec crond in foreground.
#
# If args are passed (e.g. `docker compose run --rm -it backup
# rclone config`), exec them directly without the validation/cron
# path. This is the standard "ENTRYPOINT pass-through" pattern —
# lets operators run one-off commands like the rclone OAuth setup
# without the entrypoint blocking on the very config it's about to
# create.
set -euo pipefail

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

require() {
  # Prints the *name* if missing — never the value.
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "[backup] env var $name is required" >&2
    exit 1
  fi
}

require POSTGRES_USER
require POSTGRES_PASSWORD
require POSTGRES_DB
require RCLONE_REMOTE
: "${BACKUP_RETENTION_DAYS:=14}"
: "${AUDIO_RETENTION_DAYS:=$((BACKUP_RETENTION_DAYS * 4))}"

if [ ! -f /config/rclone/rclone.conf ]; then
  echo "[backup] rclone config missing at /config/rclone/rclone.conf." >&2
  echo "[backup] One-time setup: docker compose -f infra/docker-compose.prod.yml \\" >&2
  echo "          --env-file infra/.env run --rm -it backup \\" >&2
  echo "          rclone config --config /config/rclone/rclone.conf" >&2
  echo "[backup] See infra/backup/README.md for the full procedure." >&2
  exit 1
fi

# cron starts each job with a near-empty env. Persist what the
# scripts need so they don't have to read it from /proc or args.
# 0600 because the password is in here.
umask 077
{
  printf 'POSTGRES_USER=%s\n'         "$POSTGRES_USER"
  printf 'POSTGRES_PASSWORD=%s\n'     "$POSTGRES_PASSWORD"
  printf 'POSTGRES_DB=%s\n'           "$POSTGRES_DB"
  printf 'RCLONE_REMOTE=%s\n'         "$RCLONE_REMOTE"
  printf 'BACKUP_RETENTION_DAYS=%s\n' "$BACKUP_RETENTION_DAYS"
  printf 'AUDIO_RETENTION_DAYS=%s\n'  "$AUDIO_RETENTION_DAYS"
} > /etc/backup-env
umask 022

echo "[backup] startup ok. cron schedule:"
sed 's/^/  /' /etc/crontabs/root
echo "[backup] retention: db=${BACKUP_RETENTION_DAYS}d audio=${AUDIO_RETENTION_DAYS}d"
echo "[backup] remote: ${RCLONE_REMOTE}"
echo ""

# crond -f keeps it in the foreground so docker logging captures it.
# -l 8 = info-level cron-daemon logging; -L /dev/stdout = its own log
# (job stdout/stderr is redirected per-line via /proc/1/fd/* so it
# always lands in docker logs regardless of cron's mailto behavior).
exec crond -f -l 8 -L /dev/stdout
