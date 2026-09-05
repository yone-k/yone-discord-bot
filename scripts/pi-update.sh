#!/bin/bash
# Bash 3.2 syntax; production requires Linux flock and Docker Compose v2.
set -euo pipefail
umask 077

repository=ghcr.io/yone-k/yone-discord-bot
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
if [ -f "$root/.env.storage" ]; then set -a; . "$root/.env.storage"; set +a; fi
state_dir=$root/.deploy-state
mkdir -p "$state_dir"
exec 9>"$state_dir/lock"
lock_status=0
flock -n 9 || lock_status=$?
if [ "$lock_status" = 1 ]; then
  printf '%s\n' 'update: already-running'
  case "${1:-}" in --verify|--block|--recover|--initialize) exit 1 ;; esac
  exit 0
fi
[ "$lock_status" = 0 ] || { printf '%s\n' 'update: lock-failed' >&2; exit 1; }

log() { printf 'update: %s\n' "$1"; }
fail() { log "$1"; exit 1; }
valid_image() {
  case "$1" in "$repository"@sha256:*) ;; *) return 1 ;; esac
  local digest=${1#*@sha256:}
  [ "${#digest}" -eq 64 ] || return 1
  case "$digest" in *[!0-9a-f]*) return 1 ;; esac
}

current= previous= rejected= blocked=0 initialized=0 pending=0
if [ -f "$state_dir/state" ]; then
  seen=' '
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case "$seen" in *" $key "*) fail invalid-state ;; esac
    seen="$seen$key "
    case "$key" in
      current) current=$value ;;
      previous) previous=$value ;;
      rejected) rejected=$value ;;
      blocked) blocked=$value ;;
      initialized) initialized=$value ;;
      pending) pending=$value ;;
      *) fail invalid-state ;;
    esac
  done < "$state_dir/state"
  for key in current previous rejected blocked initialized pending; do
    case "$seen" in *" $key "*) ;; *) fail incomplete-state ;; esac
  done
  valid_image "$current" || fail invalid-current
  [ -z "$previous" ] || valid_image "$previous" || fail invalid-previous
  [ -z "$rejected" ] || valid_image "$rejected" || fail invalid-rejected
  [ "$initialized" = 1 ] || fail invalid-initialization
  case "$blocked:$pending" in 0:0|0:1|1:0|1:1) ;; *) fail invalid-state-flags ;; esac
fi

write_state() {
  local temp
  temp=$(mktemp "$state_dir/state.XXXXXX") || return 1
  if ! printf 'current=%s\nprevious=%s\nrejected=%s\nblocked=%s\ninitialized=%s\npending=%s\n' \
    "$current" "$previous" "$rejected" "$blocked" "$initialized" "$pending" > "$temp"; then
    rm -f "$temp"
    return 1
  fi
  mv -f "$temp" "$state_dir/state"
}
block() { blocked=1; write_state; fail "$1"; }
compose() {
  local image=$1
  shift
  BOT_IMAGE="$image" docker compose --project-directory "$root" -f "$root/docker-compose.yml" -p discord-bot "$@"
}
image_available() {
  [ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$1" 2>/dev/null)" = linux/arm64 ]
}
snapshot() {
  local id
  id=$(compose "$1" ps -q bot 2>/dev/null) || return 1
  case "$id" in ''|*$'\n'*) return 1 ;; esac
  docker inspect --format '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null
}
matches_running() {
  local info
  info=$(snapshot "$1") || return 1
  case "$info" in "$1|running|"*) return 0 ;; *) return 1 ;; esac
}
healthy() { [ "$(snapshot "$1")" = "$1|running|healthy" ]; }
wait_healthy() {
  local deadline info
  deadline=$(($(date +%s) + 300))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    info=$(snapshot "$1") || info=
    case "$info" in
      "$1|running|healthy") return 0 ;;
      "$1|running|unhealthy"|*'|exited|'*|*'|dead|'*) return 1 ;;
    esac
    sleep 5
  done
  return 1
}
start_image() {
  bash "$root/scripts/pi-db-preflight.sh" || return 1
  compose "$1" up -d --no-deps --force-recreate --no-build --pull never bot >/dev/null 2>&1
}
schema_compatible() {
  bash "$root/scripts/pi-db-preflight.sh" >/dev/null 2>&1 &&
    compose "$1" --profile ops run --rm --no-deps ops --check >/dev/null 2>&1
}

action=${1:---update}
case "$action" in
  --initialize|--recover|--retry|--verify)
    [ "$#" -eq 2 ] || fail 'usage: --initialize|--recover|--retry|--verify IMAGE@sha256:DIGEST'
    valid_image "$2" || fail invalid-image
    ;;
  --update|--status|--block) [ "$#" -le 1 ] || fail invalid-arguments ;;
  *) fail unknown-action ;;
esac

if [ "$action" = --status ]; then
  if [ "$initialized" = 1 ]; then cat "$state_dir/state"; else log uninitialized; fi
  exit 0
fi

if [ "$action" = --verify ]; then
  [ "$initialized" = 1 ] && [ "$blocked" = 0 ] && [ "$pending" = 0 ] || fail not-ready
  [ "$current" = "$2" ] && healthy "$2" || fail deployed-version-not-healthy
  log verified
  exit 0
fi

if [ "$action" = --initialize ]; then
  [ "$initialized" = 0 ] || fail already-initialized
  image_available "$2" && healthy "$2" || fail initial-digest-not-healthy
  schema_compatible "$2" || fail initial-schema-incompatible
  current=$2 initialized=1
  write_state
  log initialized
  exit 0
fi

if [ "$initialized" = 0 ]; then
  [ "$action" = --update ] || fail uninitialized
  log uninitialized
  exit 0
fi

if [ "$action" = --block ]; then
  blocked=1
  write_state
  log blocked
  exit 0
fi

# Explicit operator recovery is the only path allowed to replace a blocked bot.
if [ "$action" = --recover ]; then
  image_available "$2" || fail recovery-image-unavailable
  compose "$2" config --quiet >/dev/null 2>&1 || fail recovery-config-invalid
  schema_compatible "$2" || fail recovery-schema-incompatible
  blocked=1 pending=1
  write_state
  compose "$current" stop bot >/dev/null 2>&1 || fail recovery-stop-failed
  if ! start_image "$2" || ! wait_healthy "$2"; then fail recovery-failed; fi
  if [ "$current" != "$2" ]; then previous=$current; fi
  current=$2 pending=0 blocked=0
  if [ "$rejected" = "$2" ]; then rejected=; fi
  write_state
  log recovered
  exit 0
fi

[ "$pending" = 0 ] || block interrupted-update
[ "$blocked" = 0 ] || fail blocked
matches_running "$current" || block running-state-mismatch

if [ "$action" = --retry ]; then
  [ "$rejected" = "$2" ] || fail not-rejected
  rejected=
  write_state
fi

docker pull --platform linux/arm64 "$repository:main" >/dev/null 2>&1 || fail pull-failed
digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$repository:main" 2>/dev/null) || fail digest-unavailable
candidate=
while IFS= read -r image; do
  if valid_image "$image"; then
    [ -z "$candidate" ] || [ "$candidate" = "$image" ] || fail ambiguous-digest
    candidate=$image
  fi
done <<< "$digests"
[ -n "$candidate" ] || fail digest-unavailable
if [ "$candidate" = "$current" ]; then log unchanged; exit 0; fi
if [ "$candidate" = "$rejected" ]; then log rejected-version; exit 0; fi
image_available "$candidate" || fail invalid-platform
image_available "$current" || fail rollback-image-unavailable
compose "$candidate" config --quiet >/dev/null 2>&1 || fail config-invalid
schema_compatible "$candidate" || fail candidate-schema-incompatible
schema_compatible "$current" || fail rollback-schema-incompatible

pending=1
write_state
if start_image "$candidate" && wait_healthy "$candidate"; then
  previous=$current current=$candidate pending=0
  write_state
  log updated
  exit 0
fi

rejected=$candidate
write_state
compose "$candidate" stop bot >/dev/null 2>&1 || block failed-version-stop-failed
if start_image "$current" && wait_healthy "$current"; then
  pending=0
  write_state
  fail update-failed-rolled-back
fi
block rollback-failed
