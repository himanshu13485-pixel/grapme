#!/usr/bin/env bash
# One-command deploy for a fresh Linux cloud server (Ubuntu/Debian).
#
#   git clone <your-repo> aeo && cd aeo
#   sudo bash deploy.sh
#
# It installs Docker if missing, generates a secure .env (secrets + your server
# address), builds the images, runs DB migrations, and starts the whole stack.
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE="docker-compose.prod.yml"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ── 1. Docker ──────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not found. Install Docker Desktop or the compose plugin." >&2
  exit 1
fi

# ── 2. .env (generate once; never overwrite an existing one) ────────────────
if [ ! -f .env ]; then
  say "Generating .env with fresh secrets…"
  # Public host: use PUBLIC_HOST env if set, else auto-detect the public IP.
  HOST="${PUBLIC_HOST:-$(curl -fsS https://api.ipify.org 2>/dev/null || echo localhost)}"
  # Scheme: http by default; set SCHEME=https if you front it with TLS.
  SCHEME="${SCHEME:-http}"
  API_PORT_PUB="${API_PORT_PUB:-4000}"
  WEB_PORT_PUB="${WEB_PORT_PUB:-3000}"

  gen() { openssl rand -base64 "$1" | tr -d '\n'; }

  # Preset admin: use ADMIN_EMAIL if provided, else a sensible default; generate
  # a strong password unless one was supplied.
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${HOST}}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)}"

  cat > .env <<EOF
WEB_PUBLIC_URL=${SCHEME}://${HOST}:${WEB_PORT_PUB}
APP_PUBLIC_URL=${SCHEME}://${HOST}:${API_PORT_PUB}
NEXT_PUBLIC_API_URL=${SCHEME}://${HOST}:${API_PORT_PUB}/api/v1
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(gen 48)
JWT_REFRESH_SECRET=$(gen 48)
CREDENTIAL_ENCRYPTION_KEY=$(gen 32)
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALLOW_ADMIN_SIGNUP=false
EOF
  echo "Wrote .env (host: ${HOST}). Edit it if you use a domain/HTTPS, then re-run."
  ADMIN_CREATED=1
else
  say ".env already exists — using it as-is."
fi

# ── 3. Pull the pre-built image + start ─────────────────────────────────────
# The image is built by GitHub CI (never on this server). For a PRIVATE image,
# log in first:  echo <GHCR_TOKEN> | docker login ghcr.io -u <github-user> --password-stdin
say "Pulling the pre-built image and starting the stack…"
docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d

say "Done. Containers:"
docker compose -f "$COMPOSE_FILE" ps

WEB_URL=$(grep '^WEB_PUBLIC_URL=' .env | cut -d= -f2-)
ADMIN_EMAIL=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
cat <<EOF

✅  Deployed.

   Web:  ${WEB_URL}
   API:  $(grep '^APP_PUBLIC_URL=' .env | cut -d= -f2-)/api/v1

Your admin login (created automatically — no signup page):
   Email:    ${ADMIN_EMAIL}
   Password: ${ADMIN_PASSWORD}
   ⚠  Log in and change this immediately under My Account. Keep .env private.

Next steps:
  1. Open the web URL and sign in with the admin login above.
  2. Open ports 3000 and 4000 in your cloud firewall/security group.
  3. Configure real SMTP/IMAP mailboxes in the app to send/receive email.
  4. (Recommended) Put it behind a domain + HTTPS — see DEPLOY.md.

Manage it with:
  docker compose -f ${COMPOSE_FILE} logs -f     # tail logs
  docker compose -f ${COMPOSE_FILE} restart     # restart
  docker compose -f ${COMPOSE_FILE} down        # stop
EOF
