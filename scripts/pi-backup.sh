#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
set -a
. "$root/.env.storage"
. "$root/.env.backup"
set +a
bash scripts/pi-db-preflight.sh
exec python3 -B deploy/postgres-backup.py
