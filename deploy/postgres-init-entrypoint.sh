#!/bin/bash
set -euo pipefail
: "${STORAGE_UUID:?Storage identity is required}"
: "${PGDATA:?PGDATA is required}"
[ "$(cat /var/lib/postgresql/.initialization-approved 2>/dev/null)" = "$STORAGE_UUID" ] || { echo 'db-init: use pi-db-init.sh' >&2; exit 1; }
if [ -d "$PGDATA" ]; then
  contents=$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)
  [ -z "$contents" ] || { echo 'db-init: PGDATA must be empty' >&2; exit 1; }
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"
