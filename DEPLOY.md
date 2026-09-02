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

## 6. Enabling LinkedIn connect (Unipile)

The LinkedIn channel uses [Unipile](https://www.unipile.com/) to connect client
accounts via a hosted auth page (we never see LinkedIn passwords). It's off until
you set four env keys. Redis/queues are already on in the prod compose file, so
this is **just env** — no code changes, no rebuild.

Add these to your server's `.env` (next to the other secrets):

```bash
# host:port EXACTLY as shown in the Unipile dashboard — NO https://, NO trailing slash
UNIPILE_DSN=api1.unipile.com:13111
UNIPILE_API_KEY=<your Unipile API key>

# Shared secret that guards the account webhook. Generate a fresh one:
#   openssl rand -hex 24
UNIPILE_WEBHOOK_SECRET=<paste the generated hex here>

# This API's PUBLIC https base URL, no trailing slash. Unipile calls back to
#   <APP_PUBLIC_URL>/api/v1/linkedin/webhooks/unipile/accounts
# when an account finishes connecting, which flips the seat PENDING → Connected.
# It MUST be reachable from the public internet (not localhost / a private IP).
APP_PUBLIC_URL=https://api.yourdomain.com
```

Then restart the API — **no rebuild needed, only env changed**:

```bash
docker compose -f docker-compose.prod.yml up -d
```

`up -d` recreates only the containers whose env changed and reuses the existing
image. Watch the boot log — if `APP_PUBLIC_URL` is missing you'll see a clear
`[LinkedIn]` warning that the webhook can't be built:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

**How to verify it works:** open a client → **LinkedIn → Accounts → Connect
Account**, finish the Unipile login, and the seat should flip from *Pending auth*
to *Connected* on its own within a few seconds (the UI auto-polls). If it stays
*Pending*, Unipile couldn't reach your webhook — re-check that `APP_PUBLIC_URL` is
public, https, has no trailing slash, and that the `secret` matches
`UNIPILE_WEBHOOK_SECRET`.

> **Never commit real Unipile values.** Keep them only in the server's `.env`
> (which stays out of git). `.env.production.example` documents the keys with
> placeholders.

### White-labeling the connect wizard (optional)

When a client connects a LinkedIn account they're sent to Unipile's **hosted auth
wizard**. Unipile's only white-label lever is a **custom domain** (their docs:
[Hosted Auth](https://developer.unipile.com/docs/hosted-auth)) — the page's logo
and name stay Unipile's; what changes is the domain the client sees.

To enable it:

1. **Needs an active Unipile subscription.**
2. In your DNS, add a CNAME: `auth.yourdomain.com` → `account.unipile.com`.
3. Contact **Unipile support** to validate the domain and issue the SSL cert.
4. Once they confirm, set it in `.env` and restart the API (env-only, no rebuild):

   ```bash
   UNIPILE_HOSTED_AUTH_DOMAIN=auth.yourdomain.com
   ```

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

The API then rewrites the wizard URL onto your domain automatically. Leave
`UNIPILE_HOSTED_AUTH_DOMAIN` blank to keep Unipile's default domain.

> **If the wizard still shows unipile.com**, the running container probably
> predates this feature. `up -d` reuses the image already on the server — it does
> **not** fetch a newer one. Wait for the GitHub Actions build to go green, then:
>
> ```bash
> docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
> ```
>
> Generate a **fresh** connect link afterwards; links minted by the old code keep
> pointing at Unipile's domain. To confirm the new code is live:
>
> ```bash
> docker compose -f docker-compose.prod.yml exec api grep -c brandHostedAuthUrl apps/api/dist/src/linkedin/provider/unipile.provider.js
> ```
>
> The same applies to any new feature: `git pull` on the server updates the
> compose file and `.env`, but the app code comes from the pre-built image.

## 7. Enabling WhatsApp alerts (self-hosted portal)

Alerts can also go out over WhatsApp, through our **own portal** (one WhatsApp
number per project) — no Meta Business API and no per-message fee.

Users must **verify their number first** (My Account → WhatsApp): the API sends a
6-digit code to that number and only messages numbers that have been confirmed.
The whole feature is optional — skipping it just means no WhatsApp alerts; in-app
and email notifications are unaffected.

### Set it up in the app (recommended)

Credentials live **per workspace**, so each one can send from its own WhatsApp
number. Nothing to touch on the server:

1. In the portal, **Add a project**, scan the QR with the number that workspace
   should send from, then open **Integration details** on the project card and
   copy the **API key**.
2. In GrapMe, sign in as an admin → **WhatsApp notifications**.
3. Paste the portal URL (just the address — `https://wa.yourdomain.com`, no path)
   and the API key, tick **Enable WhatsApp notifications**, and **Save**.
4. Click **Test connection**. Green confirms the key works *and* the number is
   paired; if it reports the number isn't connected, scan the QR again in the
   portal.

The key is encrypted at rest with `CREDENTIAL_ENCRYPTION_KEY` (the same key that
protects mailbox passwords) and is never sent back to the browser — the page only
ever shows its last four characters.

### Server-wide fallback (optional)

If you'd rather configure it once for every workspace, set these in `.env`
instead. Any workspace that hasn't saved its own credentials uses them:

```bash
# Portal's public base URL, no trailing slash. Must be reachable from the API
# container — a public https URL, or the portal's address on the docker network.
WA_PORTAL_URL=https://wa.yourdomain.com
WA_PORTAL_API_KEY=<the WhatsApp project's API key>

# Telegram, if used. Same portal, a different project — so the URL is usually
# identical and only the key differs.
TG_PORTAL_URL=https://wa.yourdomain.com
TG_PORTAL_API_KEY=<the Telegram project's API key>

# Brand name in the OTP message ("123456 is your Grapme verification code").
APP_NAME=Grapme
```

Restart the API (env-only, reuses the existing image):

```bash
docker compose -f docker-compose.prod.yml up -d
```

A workspace that saves its own credentials overrides this, and one that ticks
**Enable** off stops sending entirely rather than falling back.

Deep links inside WhatsApp alerts reuse `WEB_PUBLIC_URL`, which is already set —
there's no extra URL to configure.

**How to verify it works:** sign in → **My Account** → the WhatsApp card should
show *Not verified* with a **Send code** button (if it says WhatsApp isn't
configured, neither the workspace settings nor the env fallback are set). Send
the code, enter it, and the card flips to *Verified* — which also switches
WhatsApp alerts on for that user. They can opt out again in notification
settings.

Leave a channel's `*_PORTAL_*` pair blank and save nothing in the app to keep it
off. The two are independent: WhatsApp only, Telegram only, both, or neither.

### "Could not reach the portal at that URL"

If **Test connection** fails but the portal works from the server itself, the
container and the host are resolving the hostname differently. Compare them:

```bash
getent hosts wa.yourdomain.com
docker compose -f docker-compose.prod.yml exec api getent hosts wa.yourdomain.com
```

Different answers mean the host has an `/etc/hosts` entry (often a private IP for
a portal on this same box) that the container never inherits — so the container
dials the public IP and the connection times out on the hairpin. Pin the name for
the container by setting this in `.env` and restarting:

```bash
WA_PORTAL_HOST_ENTRY=wa.yourdomain.com:10.131.0.5
```

TLS still validates: only the IP changes, not the hostname. Confirm with

```bash
docker compose -f docker-compose.prod.yml exec api node -e "fetch('https://wa.yourdomain.com/api/v1/status').then(r=>console.log('HTTP',r.status)).catch(e=>console.log('CAUSE:',e.cause&&(e.cause.code||e.cause.message)))"
```

`HTTP 401` is the good result — reachable, and correctly refusing a request that
carries no API key.

> **Never commit the portal API key.** Keep it in the app's settings page or the
> server's `.env`; `.env.production.example` documents the keys with placeholders.

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
