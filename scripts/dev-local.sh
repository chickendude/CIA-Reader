#!/usr/bin/env bash
# Docker-free Linux development, with an isolated user-owned PostgreSQL cluster.
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOCAL="$ROOT/.local"
mkdir -p "$LOCAL"
export PATH="$LOCAL/bin:$PATH"

usage() {
  cat <<'HELP'
Usage: scripts/dev-local.sh COMMAND [ARGUMENT]

  install               Install JS/Python dependencies and mr/eu NLP models
  db-up                 Initialize/start the project's PostgreSQL on 127.0.0.1:55432
  restore FILE.dump     Restore into a NEW local database; refuses an existing DB
  start                 Start DB, Redis/Valkey, Mailpit, NLP, and web; Ctrl-C stops apps
  db-down               Stop only the project's PostgreSQL cluster
  import-hindidb PATH    Replace Hindi dictionary from a HindiDB checkout (backs up first)
  import-hindidb-books PATH USER_ID  Import current Harry Potter books and saved choices
  reprocess-hindi        Rebuild Hindi book analyses without starting the app

Prerequisites: Node 22.13+, pnpm 9, Python 3.11+, PostgreSQL 16+ tools,
Redis or Valkey, and Mailpit. No sudo or Docker is used by this script.
Install reuses services/nlp/.venv, or creates it with python3 from your PATH.
Set PYTHON=/path/to/python to choose an interpreter for a new venv.
Optional shell config: .local/env (created on first use). Keep the DB port
unchanged after initializing the cluster. Services bind only to loopback.
Logs, database, models, and uploads live under the gitignored .local directory.
HELP
}
case "${1:---help}" in --help|-h) usage; exit 0 ;; esac

if [[ ! -f "$LOCAL/env" ]]; then
  cat >"$LOCAL/env" <<'CONFIG'
LOCAL_PG_PORT=55432
LOCAL_DB_NAME=ciareader_local
WEB_PORT=6660
LOCAL_NLP_PORT=8000
LOCAL_REDIS_PORT=56379
LOCAL_SMTP_PORT=1025
LOCAL_MAIL_PORT=8025
CONFIG
fi
set -a
. "$LOCAL/env"
set +a
[[ "$LOCAL_DB_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || { echo 'Invalid LOCAL_DB_NAME' >&2; exit 1; }
for value in "$LOCAL_PG_PORT" "$WEB_PORT" "$LOCAL_NLP_PORT" "$LOCAL_REDIS_PORT" "$LOCAL_SMTP_PORT" "$LOCAL_MAIL_PORT"; do
  [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] && ((value <= 65535)) || { echo 'Invalid local port' >&2; exit 1; }
done
export DATABASE_URL="postgres://ciareader@127.0.0.1:$LOCAL_PG_PORT/$LOCAL_DB_NAME"
export NLP_SERVICE_URL="http://127.0.0.1:$LOCAL_NLP_PORT"
export REDIS_URL="redis://127.0.0.1:$LOCAL_REDIS_PORT"
export APP_BASE_URL="http://localhost:$WEB_PORT"
export SMTP_HOST=127.0.0.1 SMTP_PORT="$LOCAL_SMTP_PORT" SMTP_USER='' SMTP_PASS=''
export SMTP_FROM=no-reply@ciareader.local
export AUDIO_LOCAL_ROOT="$LOCAL/audio" PDF_LOCAL_ROOT="$LOCAL/pdf"
export STANZA_RESOURCES_DIR="$LOCAL/stanza_resources"
export PYTHONPATH="$ROOT/packages/shared-types/python:$ROOT/services/nlp"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-3}" MKL_NUM_THREADS="${MKL_NUM_THREADS:-3}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-3}"
VENV="$ROOT/services/nlp/.venv"

need() {
  for tool in "$@"; do
    command -v "$tool" >/dev/null || { echo "Missing dependency: $tool (see README native setup)" >&2; exit 1; }
  done
}
db_up() {
  need initdb pg_ctl psql
  if [[ ! -f "$LOCAL/postgres/PG_VERSION" ]]; then
    initdb -D "$LOCAL/postgres" -U ciareader --encoding=UTF8 --locale=C.UTF-8 \
      --auth-local=trust --auth-host=trust >/dev/null
    cat >>"$LOCAL/postgres/postgresql.conf" <<CONFIG
listen_addresses = '127.0.0.1'
port = $LOCAL_PG_PORT
unix_socket_directories = ''
CONFIG
  fi
  if ! pg_ctl -D "$LOCAL/postgres" status >/dev/null 2>&1; then
    pg_ctl -D "$LOCAL/postgres" -l "$LOCAL/postgres.log" -w start
  fi
}

case "${1:-}" in
  install)
    need pnpm
    if [[ -d "$VENV" ]]; then
      # Do not rebuild an existing venv using a different system interpreter.
      if ! "$VENV/bin/python" -c 'import sys; assert sys.version_info >= (3, 11); assert sys.prefix != sys.base_prefix' 2>/dev/null; then
        echo "Existing venv is broken or older than Python 3.11: $VENV" >&2
        echo 'Move it aside before creating a replacement.' >&2
        exit 1
      fi
      echo "Reusing $VENV ($("$VENV/bin/python" --version))"
    else
      python_cmd="${PYTHON:-python3}"
      need "$python_cmd"
      if ! "$python_cmd" -c 'import sys; assert sys.version_info >= (3, 11)' 2>/dev/null; then
        echo "$python_cmd must be a working Python 3.11+ interpreter." >&2
        exit 1
      fi
      "$python_cmd" -m venv "$VENV"
      echo "Created $VENV ($("$VENV/bin/python" --version))"
    fi
    pnpm install --frozen-lockfile --store-dir "$ROOT/.pnpm-store"
    "$VENV/bin/python" -m pip install --upgrade pip
    # CPU wheels avoid pulling gigabytes of CUDA libraries on Linux.
    "$VENV/bin/python" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    "$VENV/bin/python" -m pip install -e "$ROOT/services/nlp[dev,models,ocr]"
    "$VENV/bin/python" -c "import stanza; [stanza.download(lang, processors='tokenize,pos,lemma', verbose=False) for lang in ('mr', 'eu')]"
    ;;
  import-hindidb)
    [[ $# == 2 ]] || { echo 'Usage: scripts/dev-local.sh import-hindidb PATH' >&2; exit 2; }
    (cd apps/web && pnpm exec drizzle-kit migrate)
    "$VENV/bin/python" scripts/import_hindidb.py "$2" --apply
    ;;
  reprocess-hindi)
    "$VENV/bin/python" scripts/reprocess_hindi.py
    ;;
  import-hindidb-books)
    [[ $# == 3 ]] || { echo 'Usage: scripts/dev-local.sh import-hindidb-books PATH USER_ID' >&2; exit 2; }
    (cd apps/web && pnpm exec drizzle-kit migrate)
    "$VENV/bin/python" scripts/import_hindidb_books.py "$2" --owner "$3" --apply
    ;;
  db-up) db_up ;;
  db-down)
    need pg_ctl
    pg_ctl -D "$LOCAL/postgres" -m fast -w stop
    ;;
  restore)
    [[ $# == 2 && -f "$2" ]] || { echo 'Usage: scripts/dev-local.sh restore FILE.dump' >&2; exit 2; }
    need pg_restore createdb
    pg_restore --list "$2" >/dev/null
    db_up
    # No --clean, DROP, or writes to a pre-existing database. createdb fails
    # if the name is taken; choose another LOCAL_DB_NAME in .local/env.
    createdb -h 127.0.0.1 -p "$LOCAL_PG_PORT" -U ciareader --template=template0 "$LOCAL_DB_NAME"
    pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
      --dbname="$DATABASE_URL" "$2"
    echo "Restored into $LOCAL_DB_NAME. Start with: ./scripts/dev-local.sh start"
    ;;
  start)
    need pnpm mailpit setsid flock
    if command -v valkey-server >/dev/null; then redis=valkey-server; else redis=redis-server; need "$redis"; fi
    [[ -x "$VENV/bin/uvicorn" ]] || { echo 'Run ./scripts/dev-local.sh install first' >&2; exit 1; }
    exec 9>"$LOCAL/run.lock"
    flock -n 9 || { echo 'Local launcher is already running' >&2; exit 1; }
    db_up
    psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
    if [[ ! -f "$LOCAL/auth-secret" ]]; then
      node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" >"$LOCAL/auth-secret"
    fi
    export AUTH_SECRET="$(cat "$LOCAL/auth-secret")"
    mkdir -p "$LOCAL/logs" "$LOCAL/redis" "$AUDIO_LOCAL_ROOT" "$PDF_LOCAL_ROOT"
    (cd apps/web && pnpm exec drizzle-kit migrate)
    pids=()
    cleanup() {
      trap - EXIT INT TERM
      for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
      wait || true
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    setsid "$redis" --bind 127.0.0.1 --port "$LOCAL_REDIS_PORT" --dir "$LOCAL/redis" >"$LOCAL/logs/redis.log" 2>&1 &
    pids+=("$!")
    setsid mailpit --listen "127.0.0.1:$LOCAL_MAIL_PORT" --smtp "127.0.0.1:$LOCAL_SMTP_PORT" >"$LOCAL/logs/mailpit.log" 2>&1 &
    pids+=("$!")
    setsid "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$LOCAL_NLP_PORT" >"$LOCAL/logs/nlp.log" 2>&1 &
    pids+=("$!")
    setsid pnpm --filter @ciareader/web dev --host 127.0.0.1 >"$LOCAL/logs/web.log" 2>&1 &
    pids+=("$!")
    service_names=(redis mailpit nlp web)
    echo "Starting web: $APP_BASE_URL | Login emails: http://localhost:$LOCAL_MAIL_PORT"
    echo "Logs: $LOCAL/logs | Ctrl-C stops apps; db-down stops PostgreSQL."
    # Stop the remaining services if any one exits, including failed port binds.
    set +e
    wait -n -p exited_pid "${pids[@]}"
    result=$?
    for i in "${!pids[@]}"; do
      if [[ "${pids[$i]}" == "${exited_pid:-}" ]]; then
        service="${service_names[$i]}"
        echo "$service exited (status $result). Last log messages:" >&2
        tail -n 25 "$LOCAL/logs/$service.log" >&2
        break
      fi
    done
    # An unexpected clean exit still means the requested stack is not running.
    if ((result == 0)); then result=1; fi
    exit "$result"
    ;;
  *) usage >&2; exit 2 ;;
esac
