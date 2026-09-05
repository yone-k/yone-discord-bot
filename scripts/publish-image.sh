#!/bin/bash
# Runs only in the serialized publish job, after build and architecture checks.
set -euo pipefail
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
