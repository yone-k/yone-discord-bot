#!/bin/bash
# Runs only in the serialized publish job, after build and architecture checks.
set -euo pipefail
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'published=false\n' >> "$GITHUB_OUTPUT"; fi
[ "${GITHUB_REF:?}" = refs/heads/main ] || exit 0
remote=$(git ls-remote --exit-code origin refs/heads/main)
head=${remote%%$'\t'*}
[ -n "$head" ] || { echo 'Cannot resolve main' >&2; exit 1; }
if [ "$head" != "${GITHUB_SHA:?}" ]; then
  echo 'Skipping a revision that is no longer main'
  exit 0
fi
docker push "${IMAGE:?}:$GITHUB_SHA"
docker tag "$IMAGE:$GITHUB_SHA" "$IMAGE:main"
docker push "$IMAGE:main"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  refs=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE:$GITHUB_SHA")
  digest=
  while IFS= read -r ref; do
    case "$ref" in "$IMAGE"@sha256:*)
      candidate=${ref#*@sha256:}
      [ "${#candidate}" = 64 ] || exit 1
      case "$candidate" in *[!0-9a-f]*) exit 1 ;; esac
      [ -z "$digest" ] || [ "$digest" = "sha256:$candidate" ] || exit 1
      digest="sha256:$candidate"
      ;;
    esac
  done <<< "$refs"
  [ -n "$digest" ] || exit 1
  printf 'digest=%s\npublished=true\n' "$digest" >> "$GITHUB_OUTPUT"
fi
