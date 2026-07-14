# Set up GrapOut on a new laptop (dev copy)

Do this on **each** new machine. ~20–30 min (mostly downloads). Everything runs
in **Git Bash** unless noted.

## 1. Install the tools (once per laptop)

- **Git for Windows** — https://git-scm.com/download/win (gives Git Bash).
- **Node.js 20 LTS** — https://nodejs.org → click the **20.x LTS** button
  (⚠️ NOT "Current"/Node 22/24 — the project is built for Node 20).

Verify in a fresh Git Bash:
```bash
git --version
node -v      # must show v20.x
```

## 2. Add this laptop's key to GitHub

```bash
ssh-keygen -t ed25519 -C "grapout-laptop"     # press Enter 3 times
cat ~/.ssh/id_ed25519.pub
```
Copy that line → https://github.com/settings/keys → **New SSH key** → paste → Add.

## 3. Clone the project

Pick a plain local folder (NOT inside OneDrive/Google Drive). Example on D::
```bash
cd /d/SOFTWARE-LOCAL           # or wherever you want it; make it first if needed
git clone git@github.com:himanshu13485-pixel/grapme.git aeo
cd aeo
```
Type **yes** if it asks about the host key. Your prompt should end with
`/aeo (master)`. If it says `Permission denied (publickey)`, redo Step 2.

## 4. Install dependencies + generate the DB client

```bash
npm install
npm run db:generate
```
`db:generate` downloads a database engine the first time — if it fails with
`ECONNRESET`/`aborted`, just **run it again** (it's a network hiccup). Success =
`✔ Generated Prisma Client`. Ignore any "Update available" message.

## 5. Create the local config file `apps/api/.env`

```bash
notepad apps/api/.env
```
Click **Yes** to create it, paste **exactly** this, then **Ctrl+S** and close:
```
DATABASE_URL="postgresql://aeo:aeo_password@localhost:5432/aeo?schema=public"
API_PORT=4000
NODE_ENV=development
CORS_ORIGIN="http://localhost:3000"
QUEUE_ENABLED=false
JWT_ACCESS_SECRET="dev-access-secret-please-change-min-32-characters-long"
JWT_REFRESH_SECRET="dev-refresh-secret-please-change-min-32-characters-long"
JWT_ACCESS_TTL="15m"
JWT_REFRESH_TTL="7d"
CREDENTIAL_ENCRYPTION_KEY="ZbJfEpfuiMQlWN924Jif55NbPt8A2GPKlblE8rvl+BI="
APP_PUBLIC_URL="http://localhost:4000"
```
Check it: `cat apps/api/.env` — the first line must be `DATABASE_URL=...`.

## 6. Start it + create a local admin

1. In File Explorer, open the `aeo` folder → double-click **`start-dev.bat`**
   (leave the black windows open; first run takes 1–2 min).
2. Once it's running, back in Git Bash: `npm run db:seed`
3. Open **http://localhost:3000** and sign in:
   - **Email:** `admin@grapme.local` (or your `SEED_ADMIN_EMAIL`)
   - **Password:** `Password123!`

Done — this laptop now has a full working local copy.

---

## Everyday use on any laptop

- **Before you start working:** `git pull`  (get the latest code)
- **After you make changes:** `git add -A && git commit -m "note"` then `git push`

Remember: **code is shared via GitHub; the database and `.env` are local to each
machine** — so every laptop has its own separate data. That's normal.
