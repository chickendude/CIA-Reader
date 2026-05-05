#!/bin/bash
# Helper: pull a dump from the remote and pipe it back into Postgres.
# Run from the backup container — it has rclone + postgres-client
# already, and is on the same network as the postgres service.
#
# Usage:
#   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
#     exec backup restore-db.sh <timestamp>
#   # or 'latest' to pick the most recent dump
#
# WARNING: the dump was taken with --clean --if-exists, so applying
# it drops every table in $POSTGRES_DB before recreating. Take a
# fresh backup *now* before running restore against a DB you care
# about.
set -euo pipefail

# shellcheck disable=SC1091
. /etc/backup-env

ARG="${1:-}"
RCLONE_CONF=/config/rclone/rclone.conf

if [ -z "$ARG" ]; then
  echo "usage: restore-db.sh <YYYYMMDDTHHMMSSZ | latest>" >&2
  echo "" >&2
  echo "available remote dumps:" >&2
  rclone lsf --config "$RCLONE_CONF" "${RCLONE_REMOTE}/db/" >&2 || true
  exit 1
fi

if [ "$ARG" = "latest" ]; then
  ARG=$(rclone lsf --config "$RCLONE_CONF" "${RCLONE_REMOTE}/db/" | sort | tail -n1)
  if [ -z "$ARG" ]; then
    echo "no dumps found at ${RCLONE_REMOTE}/db/" >&2
    exit 1
  fi
  echo "[restore] using latest: $ARG"
fi

# Add .sql.gz suffix if user passed only the timestamp.
case "$ARG" in
  *.sql.gz) FILE="$ARG" ;;
  *)        FILE="${ARG}.sql.gz" ;;
esac

REMOTE="${RCLONE_REMOTE}/db/${FILE}"
TMP="/tmp/restore-${FILE}"
trap 'rm -f "$TMP"' EXIT

echo "[restore] downloading $REMOTE"
rclone copyto --config "$RCLONE_CONF" "$REMOTE" "$TMP"

echo "[restore] applying to ${POSTGRES_DB} on postgres:5432"
PGPASSWORD="$POSTGRES_PASSWORD" gunzip -c "$TMP" | \
  psql --host=postgres --port=5432 \
       --username="$POSTGRES_USER" \
       --dbname="$POSTGRES_DB" \
       --single-transaction \
       --set=ON_ERROR_STOP=on \
       --quiet

echo "[restore] done. verify rows in postgres."
