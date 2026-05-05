# Backup sidecar for the production stack (T-13.3).
#
# Runs crond in foreground; cron jobs `pg_dump` the live DB and tar
# the audio-data volume, then upload via rclone to whatever remote
# the operator has configured (Dropbox, B2, Hetzner Storage Box,
# anything rclone supports).
#
# Container is intentionally minimal — alpine + the four binaries we
# need + the scripts. Stays under ~50 MB.
FROM alpine:3.20

RUN apk add --no-cache \
      bash \
      dcron \
      gzip \
      postgresql16-client \
      rclone \
      tar \
      tzdata

COPY entrypoint.sh    /usr/local/bin/entrypoint.sh
COPY backup-db.sh     /usr/local/bin/backup-db.sh
COPY backup-audio.sh  /usr/local/bin/backup-audio.sh
COPY restore-db.sh    /usr/local/bin/restore-db.sh
COPY crontab          /etc/crontabs/root
RUN chmod +x /usr/local/bin/*.sh

# UTC for predictable cron schedules — operators reading the crontab
# don't have to convert timezones to figure out when a job fires.
ENV TZ=UTC

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
