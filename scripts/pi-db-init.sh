#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
set -a; . "$root/.env.storage"; set +a
bash scripts/pi-db-preflight.sh --init
exec 8>"${STORAGE_ROOT:-/srv/discord-bot-storage}/.operations-lock"
flock -n 8 || { echo 'db-init: operations busy' >&2; exit 1; }
[ -z "$(docker compose ps --status running -q db db-init)" ] || { echo 'db-init: database must be stopped' >&2; exit 1; }
storage=${STORAGE_ROOT:-/srv/discord-bot-storage}
# postgres (container UID) must traverse the mount root; PGDATA itself is 700.
chmod 755 "$storage/postgres"
printf '%s\n' "$STORAGE_UUID" > "$storage/postgres/.discord-bot-disk"
printf '%s\n' "$STORAGE_UUID" > "$storage/postgres/.initialization-approved"
trap 'docker compose --profile init stop db-init >/dev/null; docker compose --profile init rm -f db-init >/dev/null; rm -f "$storage/postgres/.initialization-approved"' EXIT
docker compose --profile init up -d --no-deps db-init
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if docker compose exec -T db-init sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo 'db-init: readiness timeout' >&2; exit 1; }
docker compose --profile init stop db-init
docker compose --profile init rm -f db-init
rm -f "$storage/postgres/.initialization-approved"
trap - EXIT
bash scripts/pi-db-preflight.sh
docker compose up -d --no-deps db
printf '%s\n' 'db-init: create the Bot login role, then run: docker compose --profile ops run --rm --no-deps ops'
