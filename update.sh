#!/usr/bin/env bash
# Pull the latest code and roll it out on the live server.
#   bash update.sh
# Data is safe — Postgres/Redis live in named volumes; migrations run on boot.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE_FILE="docker-compose.prod.yml"

# Pre-flight. Memory is not a constraint on this box (93 GB), but the root disk
# is shared with the cPanel sites: every deploy leaves the previous image behind,
# and a full disk takes MySQL and Apache down with it.
DISK_PCT=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
echo "==> Root disk ${DISK_PCT:-?}% used before deploy"
if [ -n "${DISK_PCT:-}" ] && [ "$DISK_PCT" -ge 90 ]; then
  echo "    ! Root disk is ${DISK_PCT}% full — pulling an image could fill it and"
  echo "      take the other sites on this server with it."
  echo "      Free space first — this project's images only:"
  echo "        docker image ls ghcr.io/himanshu13485-pixel/grapme"
  echo "      then 'docker image rm <id>' on the old ones. Avoid a blanket"
  echo "      'docker image prune -a': that would hit other sites on this server."
  [ "${FORCE:-0}" = "1" ] || exit 1
fi

echo "==> Pulling latest config…"
git pull --ff-only

echo "==> Pulling the pre-built image (built by GitHub, not here)…"
docker compose -f "$COMPOSE_FILE" pull

echo "==> Restarting (DB migrations apply automatically on api boot)…"
docker compose -f "$COMPOSE_FILE" up -d

# Each deploy leaves the previous image plus its :<sha> tag behind, so the disk
# creeps up over time. Keep a fortnight so rollback.sh still has targets.
#
# Scoped to THIS project's images on purpose: other sites share this server, and
# a blanket "docker image prune -a" (or even a dangling prune) would delete
# images belonging to whatever else runs here. Docker refuses to remove an image
# a container still uses, so the live stack is never at risk either.
IMAGE_REPO="${APP_IMAGE_REPO:-ghcr.io/himanshu13485-pixel/grapme}"
KEEP_DAYS="${KEEP_IMAGE_DAYS:-14}"
echo "==> Removing ${IMAGE_REPO} images older than ${KEEP_DAYS} days (nothing else)…"
CUTOFF=$(date -d "${KEEP_DAYS} days ago" +%s 2>/dev/null || echo 0)
if [ "$CUTOFF" -gt 0 ]; then
  for id in $(docker image ls "$IMAGE_REPO" --format '{{.ID}}' 2>/dev/null | sort -u); do
    created=$(docker image inspect -f '{{.Created}}' "$id" 2>/dev/null) || continue
    ts=$(date -d "$created" +%s 2>/dev/null) || continue
    if [ "$ts" -lt "$CUTOFF" ]; then
      docker image rm "$id" >/dev/null 2>&1 || true   # in-use images stay
    fi
  done
fi
echo "==> Root disk now $(df -P / | awk 'NR==2 {print $5}') used"

echo "==> Recent API logs:"
docker compose -f "$COMPOSE_FILE" logs --tail=40 api

echo "✅ Update complete."
