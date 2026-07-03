# Deploying GRAPOUT to a cloud server

The whole stack (PostgreSQL + Redis + API + Web) runs in Docker. On a fresh
Ubuntu/Debian server it's **one command**.

## 1. Get a server

Any cloud VPS works — DigitalOcean, Hetzner, AWS EC2, Linode, etc.
Recommended minimum: **2 vCPU / 4 GB RAM / 30 GB disk**, Ubuntu 22.04.

Point an `A` record at the server's IP if you have a domain (optional but
recommended for HTTPS).

## 2. Deploy (one command)

SSH into the server, then:

```bash
git clone <your-repo-url> aeo
cd aeo
sudo bash deploy.sh
```

`deploy.sh` will:
1. Install Docker if it isn't already there.
2. Generate a `.env` with strong random secrets + your server's public IP.
3. Build the images, run database migrations, and start everything.

By default it auto-detects your server's **public IP** and serves:

- **Web:** `http://<your-ip>:3000`
- **API:** `http://<your-ip>:4000/api/v1`

To use a **domain** and/or **custom ports** instead of the auto-detected IP,
set these before running (only affects the first run, which writes `.env`):

```bash
PUBLIC_HOST=app.yourdomain.com SCHEME=https sudo -E bash deploy.sh
```

## 3. Open the firewall

In your cloud provider's firewall / security group, allow inbound **3000** and
**4000** (or **80/443** if you add a reverse proxy — see below).

## 4. Create your admin

Open the web URL, click **“Create workspace”**, and register your super-admin
login. That's your admin account — there are no default/demo credentials in
production.

> Optional: after creating your admin you can disable public self-registration
> of new admin workspaces. Ask and it can be gated.

## 5. Add mailboxes

In the app, add your real **SMTP/IMAP mailboxes** (Mailboxes page) so it can
send and receive email. Set up **SPF, DKIM, DMARC** on your sending domains —
the built-in **Deliverability** page checks these for you.

---

## Recommended: a domain + HTTPS

Running on raw IP + ports works, but for production put it behind a reverse
proxy with automatic TLS. The easiest is **Caddy** (auto Let's Encrypt):

Create `/etc/caddy/Caddyfile`:

```
app.yourdomain.com {
    reverse_proxy localhost:3000
}
api.yourdomain.com {
    reverse_proxy localhost:4000
}
```

Then set your `.env` accordingly and rebuild (the web bundle bakes the API URL):

```
WEB_PUBLIC_URL=https://app.yourdomain.com
APP_PUBLIC_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Now only ports 80/443 need to be public (keep 3000/4000 bound to localhost).

---

## Day-2 operations

```bash
docker compose -f docker-compose.prod.yml logs -f       # tail logs
docker compose -f docker-compose.prod.yml restart web   # restart a service
docker compose -f docker-compose.prod.yml down          # stop everything
```

**Update to a new version:**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrations run on boot
```

**Back up the database:**

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U aeo aeo | gzip > backup-$(date +%F).sql.gz
```

Postgres data and Redis data persist in the named volumes `aeo_pgdata` /
`aeo_redisdata`, so `up`/`down`/rebuilds don't lose data.

---

## Notes & gotchas

- **Secrets:** the API refuses to start in production with weak/placeholder JWT
  or encryption secrets. `deploy.sh` generates strong ones; keep `.env` private.
- **`NEXT_PUBLIC_API_URL` is baked at build time.** If you change the API URL,
  you must rebuild the web image (`up -d --build`), not just restart it.
- **Email needs DNS/outbound access** (SMTP/IMAP + the Deliverability DNS
  checks). Cloud servers allow this by default; some block outbound port 25.
- **Image size:** the runtime image bundles the full toolchain for simplicity.
  Fine for a VPS. It can be slimmed later with a standalone Next build if needed.

## Alternative: managed platforms

Prefer no server management? The same Docker image deploys to **Render**,
**Railway**, or **Fly.io** — create a Postgres add-on + a Redis add-on, set the
same env vars, and point the service at this `Dockerfile`. Ask and a
platform-specific blueprint can be added.
