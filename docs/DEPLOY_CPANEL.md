# Deploying GrapOut on a cPanel / WHM VPS

You have **root via WHM**, so this works — but a cPanel box needs a different
approach than a plain server, because cPanel already owns ports 80/443, the
firewall (csf), and MySQL/mail. We run GrapOut **alongside** cPanel, not through
it.

GrapOut needs **PostgreSQL + Redis** (cPanel gives you MySQL only). The cleanest
way is Docker, which bundles Postgres + Redis so you never touch cPanel's own
services.

---

## Step 0 — Check the server can run Docker

SSH in as root, then:

```bash
systemd-detect-virt
```

- `kvm` / `qemu` / `none` → Docker will run. **Use Path A (Docker).**
- `openvz` / `lxc` → Docker usually can't run here. **Use Path B (native).**

Also confirm the firewall in use (cPanel usually installs **csf**):

```bash
which csf && echo "csf firewall present"
```

---

## Path A — Docker (recommended, if virt = kvm/qemu)

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Deploy, but bind ports to localhost (not public)

We keep GrapOut on `127.0.0.1` and let cPanel proxy a subdomain to it — this
avoids fighting the csf firewall and gives you HTTPS for free.

```bash
git clone git@github.com:OWNER/REPO.git ~/grapout
cd ~/grapout
```

Create `.env` (fill the domain lines to match the subdomains from Step 3):

```bash
cp .env.production.example .env
nano .env
```

Set:
```
WEB_PUBLIC_URL=https://app.yourdomain.com
APP_PUBLIC_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1
POSTGRES_PASSWORD=<random>
JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
CREDENTIAL_ENCRYPTION_KEY=<openssl rand -base64 32>
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<a strong password>
ALLOW_ADMIN_SIGNUP=false
```

Bind the containers to localhost only — edit `docker-compose.prod.yml` ports:
```yaml
  api:
    ports: ['127.0.0.1:4000:4000']
  web:
    ports: ['127.0.0.1:3000:3000']
```

Then build + start:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 3. Create the subdomains + reverse proxy in cPanel

1. **cPanel → Domains → Create A Domain** (or Subdomains): make
   `app.yourdomain.com` and `api.yourdomain.com`. DNS `A` records should point to
   this server's IP (WHM/cPanel handles this if the domain is here).
2. **Reverse proxy each subdomain to the local port.** On cPanel the tidy way is
   an Apache "Include" via WHM:
   **WHM → Apache Configuration → Include Editor → Pre VirtualHost / or the
   subdomain's vhost** — add a proxy. Example for `app.yourdomain.com`:
   ```apache
   ProxyPreserveHost On
   ProxyPass / http://127.0.0.1:3000/
   ProxyPassReverse / http://127.0.0.1:3000/
   ```
   and `api.yourdomain.com` → `http://127.0.0.1:4000/`.
   Rebuild + restart Apache: `WHM → Rebuild HTTPD Conf`, or
   `/scripts/rebuildhttpdconf && service httpd restart`.

   > If your server runs **LiteSpeed** instead of Apache, use
   > **LiteSpeed WebAdmin → the vhost → Context → type "Proxy"** pointing at the
   > local port (same idea, different UI). Tell me which and I'll give exact steps.

3. **HTTPS:** cPanel **AutoSSL** issues free certs for the subdomains
   automatically (cPanel → SSL/TLS Status → Run AutoSSL). Now both are on
   `https://…` with no ports in the URL.

### 4. First login

Open `https://app.yourdomain.com`, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
and change the password under **My Account**.

### Updating later
```bash
cd ~/grapout && bash update.sh
```

---

## Path B — Native install (if Docker can't run: openvz/lxc)

Install the services on the host and run the two Node apps with PM2.

```bash
# Node 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && yum install -y nodejs
# (Debian/Ubuntu base: use deb.nodesource.com + apt)

# PostgreSQL 16 + Redis (package names vary by OS)
yum install -y postgresql-server redis   # or your distro's equivalents
# init + start postgres, create db 'aeo' + user 'aeo'
# start + enable redis

npm i -g pm2
```

Then, in the project:
```bash
git clone git@github.com:OWNER/REPO.git ~/grapout && cd ~/grapout
cp .env.production.example .env      # fill it in (DATABASE_URL=postgresql://aeo:...@localhost:5432/aeo)
npm ci
npm run db:generate
npm run build --workspaces --if-present
npm run db:migrate --workspace apps/api   # (prisma migrate deploy)
pm2 start "node apps/api/dist/main.js" --name grapout-api
pm2 start "npm run start --workspace apps/web" --name grapout-web
pm2 save && pm2 startup
```

Then do the **same subdomain + reverse proxy + AutoSSL** steps as Path A Step 3.

> Path B is more moving parts (you maintain Postgres/Redis/Node yourself). If
> `systemd-detect-virt` says kvm/qemu, prefer Path A.

---

## Things to watch on cPanel

- **Don't put GrapOut on ports 80/443** — cPanel owns them. Use the subdomain
  proxy.
- **csf firewall:** with the localhost binding above you don't need to open
  3000/4000 publicly. If you ever expose them directly, open them in
  **WHM → ConfigServer Security & Firewall**.
- **Outbound email:** cPanel servers sometimes block outbound port 25. Use your
  mailbox provider's **submission port (587)** for SMTP.
- **Backups:** GrapOut's data is in the Docker `aeo_pgdata` volume (Path A) or
  your host Postgres (Path B) — back it up with `pg_dump` (see DEPLOY.md).
- **Resources:** the first Docker build is heavy (~1 GB deps). Make sure the VPS
  has enough RAM/disk headroom beyond what cPanel already uses.
