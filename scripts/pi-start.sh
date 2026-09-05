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
[ -z "$(docker compose ps --status running -q bot)" ] || { echo 'start: stop the current Bot first' >&2; exit 1; }
docker compose --profile ops run --rm --no-deps ops --check
# This record precedes even a failed start command: Sheets rollback ends here.
date -u +%FT%TZ > .deploy-state/db-started
docker compose up -d --no-build --pull never bot
