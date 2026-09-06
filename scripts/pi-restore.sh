#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
[ "$#" = 2 ] || { echo 'Usage: pi-restore.sh MANIFEST NEW_DATABASE' >&2; exit 1; }
set -a; . "$root/.env.storage"; . "$root/.env.backup"; set +a
bash scripts/pi-db-preflight.sh
mkdir -p .deploy-state
exec 9>.deploy-state/lock
flock -n 9 || { echo 'restore: updater is running' >&2; exit 1; }
[ -f .deploy-state/ci-disabled ] || { echo 'restore: block CI first' >&2; exit 1; }
grep -qx 'blocked=1' .deploy-state/state || { echo 'restore: block updater first' >&2; exit 1; }
[ -z "$(docker compose ps --status running -q bot api)" ] || { echo 'restore: stop Bot and API first' >&2; exit 1; }
for unit in discord-bot-update.timer discord-bot-backup.timer discord-bot-update.service discord-bot-backup.service; do
  if systemctl is-active --quiet "$unit"; then echo 'restore: stop timers and updater first' >&2; exit 1; fi
done
exec python3 -B deploy/postgres-backup.py --restore "$1" "$2"
