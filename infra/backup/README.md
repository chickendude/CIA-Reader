# Backups (T-13.3)

A `backup` sidecar service runs alongside the prod stack, executing two cron jobs:

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `backup-db.sh` | `5 3 * * *` (nightly, 03:05) | `pg_dump` → gzip → upload via rclone to `${RCLONE_REMOTE}/db/<timestamp>.sql.gz`. Prunes remote dumps older than `BACKUP_RETENTION_DAYS` (default 14). |
| `backup-audio.sh` | `5 4 * * 0` (weekly, Sun 04:05) | `tar.gz` of the `audio-data` volume → upload to `${RCLONE_REMOTE}/audio/<timestamp>.tar.gz`. Prunes older than `AUDIO_RETENTION_DAYS` (default `4 * BACKUP_RETENTION_DAYS`). |

Output goes to `docker compose logs backup`.

## One-time rclone setup

The backup container needs an authenticated rclone remote. Two paths.

### Path 1 — set up rclone on the deploy host

Run rclone interactively against the named volume the backup container reads from:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  run --rm -it backup rclone config --config /config/rclone/rclone.conf
```

Walk the prompts — pick a name (e.g. `dropbox`), choose your provider, **say "n" to "Use auto config?"** (the deploy host has no browser). rclone prints a URL; open it on your laptop, log into Dropbox/B2/whatever, paste the resulting auth code back into the server terminal. The token is saved into the `rclone-config` named volume and survives container recreation.

After the wizard exits, set the remote spec in `infra/.env`:

```
RCLONE_REMOTE=dropbox:ciareader-backups
```

The path after the colon (`ciareader-backups` here) is the folder rclone will create on the remote. Pick anything you like.

### Path 2 — set up rclone on your laptop, copy the config

If you'd rather use a browser for the OAuth flow:

```bash
# On your laptop (install rclone first):
rclone config
# Walk the wizard with auto-config = yes (opens browser).

# Then copy the resulting config to the deploy host:
scp ~/.config/rclone/rclone.conf root@parhiba.com:/tmp/rclone.conf
ssh root@parhiba.com 'docker run --rm \
  -v ciareader-prod_rclone-config:/dst \
  -v /tmp/rclone.conf:/src/rclone.conf:ro \
  alpine sh -c "mkdir -p /dst && cp /src/rclone.conf /dst/rclone.conf && chmod 600 /dst/rclone.conf"'
ssh root@parhiba.com 'rm /tmp/rclone.conf'
```

## Verify backups are working

After setting `RCLONE_REMOTE` and bouncing the stack:

```bash
# Trigger a one-shot dump immediately, instead of waiting until 03:05 UTC.
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup /bin/bash -c '. /etc/backup-env && /usr/local/bin/backup-db.sh'

# List remote dumps to confirm:
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup rclone --config /config/rclone/rclone.conf \
    lsl "${RCLONE_REMOTE}/db/"
```

After waiting through one Sunday, the same trick on `backup-audio.sh` confirms the weekly job works.

## Restore from a backup

The included `restore-db.sh` pulls a dump from the remote and pipes it back into Postgres. **Destructive** — the dumps are taken with `--clean --if-exists`, so restoring drops every table in `${POSTGRES_DB}` first. Take a fresh backup before you run it against a DB you care about.

```bash
# List what's available:
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup rclone --config /config/rclone/rclone.conf \
    lsf "${RCLONE_REMOTE}/db/"

# Restore the latest dump:
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup restore-db.sh latest

# Or a specific timestamp:
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup restore-db.sh 20260507T030500Z
```

For audio:

```bash
# Pull the tarball locally and extract into the volume in one shot.
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env \
  exec backup sh -c '
    rclone --config /config/rclone/rclone.conf \
      copyto "${RCLONE_REMOTE}/audio/<timestamp>.tar.gz" /tmp/restore.tar.gz &&
    tar xzf /tmp/restore.tar.gz -C /var/audio &&
    rm /tmp/restore.tar.gz
  '
```

…except `/var/audio` is mounted read-only inside the backup container by design, so audio restores actually need a one-off container with the volume in read-write mode:

```bash
docker run --rm \
  -v ciareader-prod_audio-data:/dst \
  -v ciareader-prod_rclone-config:/config/rclone:ro \
  alpine sh -c '
    apk add --no-cache rclone tar &&
    rclone --config /config/rclone/rclone.conf \
      copyto "<remote>:<bucket>/audio/<timestamp>.tar.gz" /tmp/audio.tar.gz &&
    tar xzf /tmp/audio.tar.gz -C /dst
  '
```

## Test-restore-once checklist

Per the T-13.3 ticket spec — verify a restore actually works once, before betting real data on it.

1. Trigger a one-shot DB dump (see "Verify backups").
2. `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec postgres psql -U ciareader -d ciareader -c "SELECT count(*) FROM lemmas;"` — note the count.
3. Spin up a throwaway postgres and restore into it (don't restore over prod):
   ```bash
   docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=test -p 25432:5432 postgres:16-alpine
   sleep 5
   docker run --rm \
     --network ciareader-prod_internal \
     -v ciareader-prod_rclone-config:/config/rclone:ro \
     ciareader-prod-backup sh -c '
       rclone --config /config/rclone/rclone.conf \
         copyto "${RCLONE_REMOTE}/db/<timestamp>.sql.gz" /tmp/d.sql.gz &&
       gunzip -c /tmp/d.sql.gz |
       PGPASSWORD=test psql -h host.docker.internal -p 25432 -U postgres -d postgres
     '
   PGPASSWORD=test psql -h localhost -p 25432 -U postgres -d postgres -c "SELECT count(*) FROM lemmas;"
   docker stop pgtest
   ```
4. The two counts should match. If they do, the backup pipeline is sound.
