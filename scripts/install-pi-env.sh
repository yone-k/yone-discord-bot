#!/bin/bash
# Run as yone on the Pi, with the updater stopped. Configuration arrives on stdin.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ -f "$root/.env.storage" ]; then set -a; . "$root/.env.storage"; set +a; fi
: "${BOT_IMAGE:?Set the selected GHCR digest}"
temp=$(mktemp "$root/.env.XXXXXX")
trap 'rm -f "$temp"' EXIT
cat > "$temp"
# The producer emits these four complete lines, with NODE_ENV last. Reject EOF
# partway through a transfer before asking Compose to parse the temporary file.
[ "$(wc -l < "$temp" | tr -d ' ')" = 4 ] || exit 1
{
  for name in DISCORD_BOT_TOKEN CLIENT_ID DATABASE_URL NODE_ENV; do
    IFS= read -r line || exit 1
    case "$line" in "$name=\""*'"') ;; *) exit 1 ;; esac
    [ "$line" != "$name=\"\"" ] || exit 1
  done
  [ "$line" = 'NODE_ENV="production"' ] || exit 1
} < "$temp"
BOT_ENV_FILE="$temp" docker compose --env-file "$temp" --project-directory "$root" \
  -f "$root/docker-compose.yml" -p discord-bot config --quiet >/dev/null 2>&1
chmod 600 "$temp"
mv -f "$temp" "$root/.env"
printf '%s\n' 'Configuration installed; recreate the bot explicitly to apply it'
