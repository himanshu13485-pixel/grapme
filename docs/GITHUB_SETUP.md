# GitHub setup — 2 people + the live server

One private GitHub repo is the source of truth. Both PCs push/pull; the cloud
server only pulls (deploys). Do this once.

```
        GitHub (private repo)
        ▲        ▲          ▲
  push/pull  push/pull   pull only
   PC 1        PC 2       Server
```

Replace `OWNER/REPO` below with your GitHub username/org and repo name
(e.g. `grapout/aeo`).

---

## Step 1 — Create the private repo (on github.com)

1. Sign in → click **New repository**.
2. Name it (e.g. `aeo`), set **Private**.
3. **Do NOT** add a README, .gitignore, or license (keep it empty).
4. Create. Copy the repo URL.

## Step 2 — Push your code from PC 1 (your dev PC)

In the project folder:

```bash
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin master
```

> If `git@github.com…` (SSH) isn't set up yet, do **Step 3** first, or use the
> HTTPS URL `https://github.com/OWNER/REPO.git` with a Personal Access Token.

## Step 3 — Authentication (each person, once per PC)

**Recommended: an SSH key.**

```bash
ssh-keygen -t ed25519 -C "you@example.com"      # press Enter for defaults
# Windows:  type   %USERPROFILE%\.ssh\id_ed25519.pub
# Mac/Linux: cat   ~/.ssh/id_ed25519.pub
```

Copy that public key → GitHub → **Settings → SSH and GPG keys → New SSH key** →
paste → save. Test:

```bash
ssh -T git@github.com     # should greet you by username
```

**Alternative: HTTPS + token.** GitHub → **Settings → Developer settings →
Personal access tokens → Fine-grained token** with access to the repo. Use it as
the password when git prompts (username = your GitHub name).

## Step 4 — Invite the second person

Repo → **Settings → Collaborators → Add people** → enter their GitHub username.
They accept the email invite. They then do **Step 3** (their own SSH key/token)
on **their** PC.

## Step 5 — The second person clones the repo (PC 2)

```bash
git clone git@github.com:OWNER/REPO.git aeo
cd aeo
# then their own local setup (.env, start-dev, etc.)
```

## Step 6 — Give the SERVER read-only pull access (deploy key)

A **deploy key** lets the server pull without a personal account and can't push.

On the **server**:

```bash
ssh-keygen -t ed25519 -C "aeo-server" -f ~/.ssh/aeo_deploy -N ""
cat ~/.ssh/aeo_deploy.pub
```

Copy that key → GitHub → repo → **Settings → Deploy keys → Add deploy key** →
paste → **leave "Allow write access" UNCHECKED** → add.

Tell git on the server to use that key and the SSH URL:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/aeo_deploy
  IdentitiesOnly yes
EOF

cd ~/aeo
git remote set-url origin git@github.com:OWNER/REPO.git
git pull        # verify it works
```

---

## Daily workflow

**On a PC (making changes):**
```bash
git pull            # always pull first
# ...make/edit/test changes...
git add -A && git commit -m "what changed"
git push
```

**On the server (going live):**
```bash
cd ~/aeo
bash update.sh      # git pull + rebuild + migrations + logs
```

**Two people at once:** pull before you start, push when done. Editing different
files never clashes; editing the *same lines* creates a merge conflict you
resolve once and push. For bigger parallel work, use branches + pull requests.

## Guardrails

- **Never edit files directly on the server** — changes get overwritten on the
  next `git pull`. All changes flow through GitHub, then `update.sh`.
- **The server only pulls, never pushes.** (The deploy key is read-only.)
- **Secrets stay out of git.** `.env` is gitignored, so sharing the repo does
  **not** share your admin/DB passwords — each machine keeps its own `.env`.
- **Keep the repo private.**
