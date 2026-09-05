#!/bin/bash
set -euo pipefail
: "${STORAGE_UUID:?Storage identity is required}"
: "${PGDATA:?PGDATA is required}"
storage=${POSTGRES_STORAGE_ROOT:-/var/lib/postgresql}
[ "$(cat "$storage/.discord-bot-disk" 2>/dev/null)" = "$STORAGE_UUID" ] || { echo 'db: disk identity mismatch' >&2; exit 1; }
[ "$(cat "$PGDATA/PG_VERSION" 2>/dev/null)" = 18 ] || { echo 'db: existing PostgreSQL 18 cluster required' >&2; exit 1; }
exec docker-entrypoint.sh "$@"
