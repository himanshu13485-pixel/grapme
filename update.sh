#!/usr/bin/env bash
# Pull the latest code and roll it out on the live server.
#   bash update.sh
# Data is safe — Postgres/Redis live in named volumes; migrations run on boot.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE_FILE="docker-compose.prod.yml"

echo "==> Pulling latest config…"
git pull --ff-only

echo "==> Pulling the pre-built image (built by GitHub, not here)…"
docker compose -f "$COMPOSE_FILE" pull

echo "==> Restarting (DB migrations apply automatically on api boot)…"
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Cleaning up old images…"
docker image prune -f >/dev/null 2>&1 || true

echo "==> Recent API logs:"
docker compose -f "$COMPOSE_FILE" logs --tail=40 api

echo "✅ Update complete."
