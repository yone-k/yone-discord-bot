#!/bin/bash
# Local/CI smoke test. Creates only disposable containers, network and data.
set -Eeuo pipefail
umask 077
[ "$#" = 1 ] || { echo 'Usage: check-core-image.sh LOCAL_IMAGE' >&2; exit 1; }
image=$1
root=$(cd "$(dirname "$0")/.." && pwd)
[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/arm64 ]
scratch=$(mktemp -d)
name=core-smoke-$(date +%s)-$$
network=$name-network
database=$name-db
api=$name-api
bot=$name-bot
discord=$name-discord
network_created=0 database_created=0 api_created=0 bot_created=0 discord_created=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" != 0 ]; then
    echo "core-image: failed (exit $status); disposable container diagnostics follow" >&2
    for container in "$database" "$api" "$bot" "$discord"; do
      docker inspect --format '{{.Name}} {{.State.Status}} {{.State.ExitCode}}' "$container" >&2 2>/dev/null || true
      docker logs --tail 50 "$container" >&2 || true
    done
  fi
  if [ "$bot_created" = 1 ]; then docker rm -f -v "$bot" >/dev/null 2>&1 || status=1; fi
  if [ "$api_created" = 1 ]; then docker rm -f -v "$api" >/dev/null 2>&1 || status=1; fi
  if [ "$database_created" = 1 ]; then docker rm -f -v "$database" >/dev/null 2>&1 || status=1; fi
  if [ "$discord_created" = 1 ]; then docker rm -f -v "$discord" >/dev/null 2>&1 || status=1; fi
  if [ "$network_created" = 1 ]; then docker network rm "$network" >/dev/null 2>&1 || status=1; fi
  rm -rf "$scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'echo "core-image: failed at line $LINENO: $BASH_COMMAND" >&2' ERR
trap 'exit 130' INT
trap 'exit 143' TERM HUP
docker network create --internal "$network" >/dev/null
network_created=1
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=discord.com' \
  -addext 'subjectAltName=DNS:discord.com' -keyout "$scratch/key.pem" -out "$scratch/cert.pem" >/dev/null 2>&1
chmod 644 "$scratch/cert.pem"
docker run -d --name "$discord" --network "$network" --network-alias discord.com --user root \
  --mount "type=bind,source=$root/tests/operations/discord-rest-smoke.cjs,target=/test/server.cjs,readonly" \
  --mount "type=bind,source=$scratch/cert.pem,target=/test/cert.pem,readonly" \
  --mount "type=bind,source=$scratch/key.pem,target=/test/key.pem,readonly" \
  --entrypoint node "$image" /test/server.cjs >/dev/null
discord_created=1
docker run -d --name "$database" --network "$network" --platform linux/arm64 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=synthetic-test-only -e POSTGRES_DB=discord_bot_smoke \
  postgres:18.6@sha256:6fd9e18b6fedda0a34e4d53ad6fdbd4289a217300af573c31ec7084e6d9cf329 >/dev/null
database_created=1
wait_database() {
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres -d discord_bot_smoke >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
sql() { docker exec -i "$database" psql -X -v ON_ERROR_STOP=1 -At -U postgres -d discord_bot_smoke "$@"; }
probe() {
  docker exec "$api" node -e \
    'fetch("http://127.0.0.1:8080"+process.argv[2], {method:process.argv[2]==="/health"?"GET":"POST",signal:AbortSignal.timeout(4000)}).then(r=>{if(r.status!==Number(process.argv[1]))process.exit(1);}).catch(()=>process.exit(1));' "$1" "$2"
}
wait_api() {
  local attempt
  for attempt in $(seq 1 60); do
    if probe 200 /health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
start_api() {
  docker run -d --name "$api" --network "$network" --entrypoint /app/bin/core-api \
    --health-cmd "node -e \"fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"" \
    -e DATABASE_URL="postgresql://bot_smoke:synthetic-test-only@$database:5432/$1" \
    --mount "type=bind,source=$scratch/cert.pem,target=/test/cert.pem,readonly" \
    -e SSL_CERT_FILE=/test/cert.pem -e DISCORD_BOT_TOKEN=synthetic-discord-token \
    -e DISCORD_OUTPUT_ENABLED="${2:-false}" -e CORE_API_TOKEN=synthetic-api-token "$image" >/dev/null
  api_created=1
  wait_api
}
probe_bot() {
  # Bot health can wait for the full 5s upstream timeout. Leave time for the
  # response and ARM64 emulation overhead; application timeouts stay unchanged.
  docker exec "$bot" node -e \
    'fetch("http://127.0.0.1:3000/health", {signal:AbortSignal.timeout(15000)}).then(async r=>{const b=await r.json();if(r.status!==Number(process.argv[1])||b.bot?.ready!==(r.status===200)){console.error("bot-health: unexpected response",r.status,b);process.exit(1);}}).catch(e=>{console.error("bot-health: probe failed",e.name);process.exit(1);});' "$1" bot-health
}
wait_bot() {
  local attempt
  for attempt in $(seq 1 60); do
    if probe_bot 200 >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
start_bot() {
  docker run -d --name "$bot" --network "$network" \
    --mount "type=bind,source=$root/tests/operations/discord-smoke.cjs,target=/app/discord-smoke.cjs,readonly" \
    -e DISCORD_BOT_TOKEN=synthetic-discord-token -e CLIENT_ID=123 -e NODE_ENV=production \
    -e CORE_API_URL="http://$api:8080" -e CORE_API_TOKEN=synthetic-api-token \
    "$image" node --require /app/discord-smoke.cjs dist/index.js >/dev/null
  bot_created=1
  wait_bot
  local expected
  expected=$(docker image inspect --format '{{.Id}}' "$image")
  [ "$(docker inspect --format '{{.Image}}' "$api")" = "$expected" ]
  [ "$(docker inspect --format '{{.Image}}' "$bot")" = "$expected" ]
}
wait_database
sql -c "CREATE ROLE bot_smoke LOGIN PASSWORD 'synthetic-test-only';" >/dev/null
docker run --rm --network "$network" --entrypoint /app/bin/db-migrate \
  -e DATABASE_ADMIN_URL="postgresql://postgres:synthetic-test-only@$database:5432/discord_bot_smoke" \
  -e DATABASE_BOT_ROLE=bot_smoke "$image"
sql -c "INSERT INTO data_imports(singleton,snapshot_sha256,schema_version,completed_at,report) VALUES(true,repeat('a',64),1,CURRENT_TIMESTAMP,'{}');" >/dev/null
start_api discord_bot_smoke true
start_bot
docker exec "$api" node -e '
  const headers = {Authorization:"Bearer synthetic-api-token","Content-Type":"application/json","X-Actor-Id":"999","X-Operation-Kind":"InitListCommand"};
  fetch("http://127.0.0.1:8080/v1/lists/100", {method:"PUT",headers,body:JSON.stringify({channelId:"100",listTitle:"ARM64",defaultCategory:"other"}),signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1));'
output_ready=0
for attempt in $(seq 1 30); do
  if [ "$(sql -c "SELECT count(*) FROM output_dispatches WHERE outcome='succeeded' AND discord_message_id='300';")" = 1 ]; then output_ready=1; break; fi
  sleep 1
done
[ "$output_ready" = 1 ]
[ "$(sql -c "SELECT message_id FROM list_channels WHERE channel_id='100';")" = 300 ]
docker exec "$api" node -e 'fetch("http://127.0.0.1:8080/v1/outputs/status",{headers:{Authorization:"Bearer synthetic-api-token"},signal:AbortSignal.timeout(5000)}).then(async r=>{const b=await r.json();if(!r.ok||!b.enabled||!b.workerRunning||b.contract!=="go-discord-output-v1")process.exit(1)}).catch(()=>process.exit(1));'
docker exec "$api" /app/bin/outputctl list > "$scratch/outputs.json"
docker exec -i "$api" node -e 'const b=JSON.parse(require("node:fs").readFileSync(0,"utf8"));if(!b.jobs.some(j=>j.channelId==="100")||b.counts.length!==7)process.exit(1);' < "$scratch/outputs.json"
probe 401 /v1/notifications/poll
checksum=$(sql -c 'SELECT checksum FROM schema_migrations WHERE version=2;')
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]]
sql -c "UPDATE schema_migrations SET checksum=repeat('f',64) WHERE version=2;" >/dev/null
probe 503 /health
probe_bot 503
sql -c "UPDATE schema_migrations SET checksum='$checksum' WHERE version=2;" >/dev/null
probe 200 /health
wait_bot
docker stop "$api" >/dev/null
probe_bot 503
docker start "$api" >/dev/null
wait_api
wait_bot

# Restore a real custom-format dump into another DB and start the same image.
docker exec "$database" pg_dump -Fc -U postgres -d discord_bot_smoke > "$scratch/restore.dump"
docker exec "$database" createdb -U postgres discord_bot_restored
docker exec -i "$database" pg_restore --exit-on-error --single-transaction -U postgres -d discord_bot_restored < "$scratch/restore.dump"
docker run --rm --network "$network" --entrypoint /app/bin/db-migrate \
  -e DATABASE_ADMIN_URL="postgresql://postgres:synthetic-test-only@$database:5432/discord_bot_restored" \
  -e DATABASE_BOT_ROLE=bot_smoke "$image" --check
docker rm -f "$api" >/dev/null
api_created=0
start_api discord_bot_restored
wait_bot
docker exec "$api" node -e 'fetch("http://127.0.0.1:8080/v1/outputs/status",{headers:{Authorization:"Bearer synthetic-api-token"},signal:AbortSignal.timeout(5000)}).then(async r=>{const b=await r.json();if(!r.ok||b.enabled||b.workerRunning)process.exit(1)}).catch(()=>process.exit(1));'
docker exec -e NODE_EXTRA_CA_CERTS=/test/cert.pem "$discord" node -e 'fetch("https://discord.com/__test/status",{signal:AbortSignal.timeout(5000)}).then(async r=>{if((await r.json()).posts!==1)process.exit(1)}).catch(()=>process.exit(1));'
docker stop "$database" >/dev/null
probe 503 /health
probe_bot 503
echo 'core-image: shared API/Bot/outputctl image, enabled Discord delivery, readiness, authentication, schema mismatch, API/DB outage and disabled dump/restore passed'
