#!/usr/bin/env bash
# Stream a consistent PostgreSQL snapshot from the production server over SSH.
set -euo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
host="${DEPLOY_HOST:-root@parhiba.com}"
remote_path="${DEPLOY_PATH:-/opt/ciareader}"
output=""

usage() {
  cat <<'HELP'
Usage: scripts/download-parhiba-db.sh [options]

  --host USER@HOST   SSH target (default: root@parhiba.com, or DEPLOY_HOST)
  --path PATH        Remote checkout (default: /opt/ciareader, or DEPLOY_PATH)
  --output FILE      New local archive (default: .local/backups/parhiba-TIMESTAMP.dump)
  --help            Show this help

Uses your normal SSH config/keys. Docker is used only on the remote server.
The server's POSTGRES_USER/POSTGRES_DB are read inside its running container;
no production passwords or .env files are downloaded. No server restart or
database changes are needed. Existing output files are never overwritten.
Requires ssh and pg_restore locally. The archive contains the whole database,
including accounts; uploaded audio/PDF files and NLP models are separate.
HELP
}

while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --host|--path|--output)
      (($# >= 2)) && [[ -n "$2" ]] || { echo "Missing value for $1" >&2; exit 2; }
      case "$1" in
        --host) host="$2" ;;
        --path) remote_path="$2" ;;
        --output) output="$2" ;;
      esac
      shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$host" != -* && "$host" != *[[:space:]]* ]] || { echo 'Invalid SSH host' >&2; exit 2; }
for tool in ssh pg_restore; do
  command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 1; }
done
output="${output:-$ROOT/.local/backups/parhiba-$(date -u +%Y%m%dT%H%M%SZ).dump}"
[[ ! -e "$output" && ! -L "$output" ]] || { echo "Refusing to overwrite $output" >&2; exit 1; }
mkdir -p -- "$(dirname -- "$output")"
partial="$(mktemp "${output}.partial.XXXXXX")"
trap 'rm -f -- "$partial"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Single-quote the remote argument for the login shell, including embedded quotes.
quoted_path="'${remote_path//\'/\'\\\'\'}'"
echo "Downloading database from $host:$remote_path ..." >&2
ssh -T -o ConnectTimeout=15 "$host" "bash -s -- $quoted_path" >"$partial" <<'REMOTE'
set -euo pipefail
cd -- "$1"
exec docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec -T postgres sh -c \
  'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-privileges'
REMOTE

# Catch broken/truncated downloads before publishing the archive. pg_restore
# must be at least as new as the server's pg_dump (currently PostgreSQL 16).
pg_restore --no-owner --no-privileges --file=/dev/null "$partial"
# Hard-linking in the same directory atomically refuses an existing destination.
ln -- "$partial" "$output"
echo "Saved: $output"
echo "Restore locally: ./scripts/dev-local.sh restore '$output'"
