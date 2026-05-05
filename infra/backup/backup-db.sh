#!/bin/bash
# Nightly pg_dump → gzip → rclone upload, then prune old remote dumps.
# Sourced env vars: POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
#                   RCLONE_REMOTE BACKUP_RETENTION_DAYS
set -euo pipefail

# Defensive default so the script also works when invoked outside the
# entrypoint (e.g. ad-hoc one-shot run via `docker compose exec`).
: "${BACKUP_RETENTION_DAYS:=14}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
PFX="[backup-db $TS]"
TMP="/tmp/db-${TS}.sql.gz"
REMOTE="${RCLONE_REMOTE}/db/${TS}.sql.gz"
RCLONE_CONF=/config/rclone/rclone.conf

trap 'rm -f "$TMP"' EXIT

echo "$PFX starting"

# --clean --if-exists makes the dump self-restoring (drops existing
# tables before recreating). --no-owner / --no-privileges so a
# restore into a freshly-migrated DB doesn't fight ownership /
# GRANT statements.
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host=postgres \
  --port=5432 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip --best > "$TMP"

SIZE=$(stat -c %s "$TMP")
echo "$PFX dump ${SIZE} bytes -> $REMOTE"

rclone copyto "$TMP" "$REMOTE" \
  --config "$RCLONE_CONF" \
  --stats-one-line --stats=10s

echo "$PFX pruning > ${BACKUP_RETENTION_DAYS}d from ${RCLONE_REMOTE}/db/"
rclone delete \
  --config "$RCLONE_CONF" \
  --min-age "${BACKUP_RETENTION_DAYS}d" \
  "${RCLONE_REMOTE}/db/" || true

echo "$PFX done"
