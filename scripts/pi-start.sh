#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
set -a; . "$root/.env.storage"; set +a
bash scripts/pi-db-preflight.sh
: "${BOT_IMAGE:?Set a verified DB Bot image digest}"
[[ "$BOT_IMAGE" =~ ^ghcr\.io/yone-k/yone-discord-bot@sha256:[0-9a-f]{64}$ ]] || { echo 'start: digest-pinned image required' >&2; exit 1; }
mkdir -p .deploy-state
exec 9>.deploy-state/lock
flock -n 9 || { echo 'start: updater is running' >&2; exit 1; }
[ -f .deploy-state/ci-disabled ] || { echo 'start: block CI before manual startup' >&2; exit 1; }
[ -z "$(docker compose ps --status running -q bot api)" ] || { echo 'start: stop Bot and API first' >&2; exit 1; }
if [ -f .deploy-state/state ]; then
  grep -qx 'blocked=1' .deploy-state/state || { echo 'start: block updater first' >&2; exit 1; }
fi
docker compose --profile ops run --rm --no-deps ops --check
# The irreversible boundary is migration COMMIT, before this script. This
# record is additional evidence; its absence never authorizes a v1 rollback.
date -u +%FT%TZ > .deploy-state/schema-v2-confirmed
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 300 api
docker compose up -d --no-deps --no-build --pull never --wait --wait-timeout 300 bot
