#!/usr/bin/env bash
# Roll the live app back (or forward) to a specific image version — safe, pull
# only, no build.
#   bash rollback.sh                 # list recent versions
#   bash rollback.sh <commit-sha>    # switch to that exact version
#   bash rollback.sh latest          # return to the newest build
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE="ghcr.io/himanshu13485-pixel/grapme"

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "Recent versions (newest first) — pass a commit id to roll back to it:"
  git log --format='  %H  %s' -10
  echo
  echo "Usage:  bash rollback.sh <commit-sha>   |   bash rollback.sh latest"
  exit 0
fi

# Pin (or clear) the image tag in .env; compose reads ${APP_IMAGE}.
sed -i '/^APP_IMAGE=/d' .env
if [ "$TAG" = "latest" ]; then
  echo "==> Returning to the newest build (:latest)…"
else
  echo "APP_IMAGE=${IMAGE}:${TAG}" >> .env
  echo "==> Pinning to ${IMAGE}:${TAG}…"
fi

docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d
docker compose -f "$COMPOSE_FILE" ps
echo "✅ Done."
