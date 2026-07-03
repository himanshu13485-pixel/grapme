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

## 4. Your admin login (no signup)

There is **no signup page**. Your super-admin is **created automatically on
first boot** from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. `deploy.sh` generates these
and **prints them at the end** — write them down. The login page shows only
sign-in + the Client portal link.

- Sign in at the web URL with that email/password, then **change the password
  immediately** under **My Account**. Keep `.env` private.
- To choose your own values up front, set them before the first run:

  ```bash
  ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='a-strong-password' \
    PUBLIC_HOST=app.yourdomain.com sudo -E bash deploy.sh
  ```

> Changing `ADMIN_PASSWORD` in `.env` **after** first boot does **not** reset the
> account (it already exists) — change the password in-app instead. If you're
> ever locked out, reset it directly (see "Locked out?" below).
>
> Public signup stays disabled (`ALLOW_ADMIN_SIGNUP=false`). Set it to `true` and
> restart only if you ever need the "Create workspace" flow back.

### Locked out?

Reset the admin password straight in the database:

```bash
docker compose -f docker-compose.prod.yml exec api \
  node -e "const {PrismaClient}=require('@prisma/client');const a=require('argon2');(async()=>{const p=new PrismaClient();const h=await a.hash(process.argv[1],{type:a.argon2id});await p.user.updateMany({where:{email:process.argv[2]},data:{passwordHash:h,status:'ACTIVE',emailVerified:true}});console.log('reset');process.exit(0)})()" \
  'NEW_PASSWORD' 'admin@yourdomain.com'
```

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
