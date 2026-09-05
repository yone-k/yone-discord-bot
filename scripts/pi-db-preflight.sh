#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
# Operator-owned, non-secret deployment settings (UUID and mount path only).
if [ -f "$root/.env.storage" ]; then set -a; . "$root/.env.storage"; set +a; fi
: "${STORAGE_UUID:?Set STORAGE_UUID in .env.storage}"
storage=${STORAGE_ROOT:-/srv/discord-bot-storage}
fail() { printf 'db-preflight: %s\n' "$1" >&2; exit 1; }
[ "$(findmnt -n -M "$storage" -o UUID)" = "$STORAGE_UUID" ] || fail wrong-or-missing-mount
[ "$(findmnt -n -M "$storage" -o FSTYPE)" = ext4 ] || fail not-ext4
case ",$(findmnt -n -M "$storage" -o OPTIONS)," in *,rw,*) ;; *) fail readonly-mount ;; esac
probe=$(mktemp "$storage/.write-check.XXXXXX") || fail not-writable
rm -f "$probe"
data=$storage/postgres/18/docker
if [ "${1:-}" = --init ]; then
  [ "$#" = 1 ] || fail invalid-arguments
  if [ -d "$data" ]; then
    contents=$(find "$data" -mindepth 1 -maxdepth 1 -print -quit) || fail unreadable-pgdata
    [ -z "$contents" ] || fail nonempty-pgdata
  fi
else
  [ "$#" = 0 ] || fail invalid-arguments
  [ "$(cat "$storage/postgres/.discord-bot-disk" 2>/dev/null)" = "$STORAGE_UUID" ] || fail missing-disk-identity
  # PGDATA is mode 700 and owned by the container's postgres user. The container
  # entrypoint validates PG_VERSION as root before dropping privileges.
fi
