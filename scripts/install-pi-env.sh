#!/bin/bash
# Run as yone on the Pi, with the updater stopped. Configuration arrives on stdin.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ -f "$root/.env.storage" ]; then set -a; . "$root/.env.storage"; set +a; fi
: "${BOT_IMAGE:?Set the selected GHCR digest}"
role=${1:-bot}
case "$role" in
  bot) names='DISCORD_BOT_TOKEN CLIENT_ID CORE_API_URL CORE_API_TOKEN NODE_ENV'; count=5; target=.env ;;
  api) names='DATABASE_URL CORE_API_TOKEN DISCORD_BOT_TOKEN DISCORD_OUTPUT_ENABLED'; count=4; target=.env.api ;;
  *) exit 1 ;;
esac
temp=$(mktemp "$root/.env.XXXXXX")
trap 'rm -f "$temp"' EXIT
cat > "$temp"
# Reject a truncated transfer before parsing or replacing the role file.
[ "$(wc -l < "$temp" | tr -d ' ')" = "$count" ] || exit 1
{
  for name in $names; do
    IFS= read -r line || exit 1
    case "$line" in "$name=\""*'"') ;; *) exit 1 ;; esac
    [ "$line" != "$name=\"\"" ] || exit 1
  done
  [ "$role" != bot ] || [ "$line" = 'NODE_ENV="production"' ] || exit 1
  if [ "$role" = api ]; then
    case "$line" in 'DISCORD_OUTPUT_ENABLED="true"'|'DISCORD_OUTPUT_ENABLED="false"') ;; *) exit 1 ;; esac
  fi
} < "$temp"
if [ "$role" = bot ]; then export BOT_ENV_FILE="$temp"; else export API_ENV_FILE="$temp"; fi
docker compose --env-file "$temp" --project-directory "$root" \
  -f "$root/docker-compose.yml" -p discord-bot config --quiet >/dev/null 2>&1
chmod 600 "$temp"
mv -f "$temp" "$root/$target"
printf '%s\n' 'Configuration installed; recreate both services explicitly to apply it'
