#!/bin/bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
mkdir -p .deploy-state
exec 9>.deploy-state/lock
flock -n 9 || { echo 'backup: updater or another maintenance task is running' >&2; exit 1; }
set -a
. "$root/.env.storage"
. "$root/.env.backup"
set +a
bash scripts/pi-db-preflight.sh
# Keep this shell (and its deployment lock) alive until the dump and manifest
# are committed. The Python operations lock separately excludes other backups.
python3 -B deploy/postgres-backup.py
