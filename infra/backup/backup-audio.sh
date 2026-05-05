#!/bin/bash
# Weekly tar.gz of the audio-data volume → rclone upload, then prune.
# Sourced env: RCLONE_REMOTE, AUDIO_RETENTION_DAYS, BACKUP_RETENTION_DAYS
set -euo pipefail

# Defensive defaults so the script also works when invoked outside the
# entrypoint (e.g. ad-hoc one-shot run via `docker compose exec`).
: "${BACKUP_RETENTION_DAYS:=14}"
: "${AUDIO_RETENTION_DAYS:=$((BACKUP_RETENTION_DAYS * 4))}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
PFX="[backup-audio $TS]"
TMP="/tmp/audio-${TS}.tar.gz"
REMOTE="${RCLONE_REMOTE}/audio/${TS}.tar.gz"
RCLONE_CONF=/config/rclone/rclone.conf

trap 'rm -f "$TMP"' EXIT

echo "$PFX starting"

# Empty volume => nothing to back up. Skip rather than upload an
# 0-byte tarball that costs API calls + hides a real "lost data"
# signal in the next run.
if [ -z "$(ls -A /var/audio 2>/dev/null)" ]; then
  echo "$PFX /var/audio is empty; nothing to back up"
  exit 0
fi

# tar from inside the dir (-C) so the archive is rooted at . and
# extracts cleanly into a freshly-mounted volume on restore.
tar czf "$TMP" -C /var/audio .

SIZE=$(stat -c %s "$TMP")
echo "$PFX tarball ${SIZE} bytes -> $REMOTE"

rclone copyto "$TMP" "$REMOTE" \
  --config "$RCLONE_CONF" \
  --stats-one-line --stats=10s

echo "$PFX pruning > ${AUDIO_RETENTION_DAYS}d from ${RCLONE_REMOTE}/audio/"
rclone delete \
  --config "$RCLONE_CONF" \
  --min-age "${AUDIO_RETENTION_DAYS}d" \
  "${RCLONE_REMOTE}/audio/" || true

echo "$PFX done"
