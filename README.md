# Automated Email Outreach (AEO)

Admin-controlled, multi-client email outreach SaaS. Users connect SMTP/POP/IMAP
mailboxes and build campaigns, follow-ups, and schedules — but nothing sends
until an admin (or assigned sub-admin) approves it.

> Full product spec: [Automated-Email-Outreach-Blueprint.md](Automated-Email-Outreach-Blueprint.md)

## Monorepo layout

```
aeo/
├── apps/
│   ├── api/        NestJS + Prisma + PostgreSQL API
│   └── web/        Next.js frontend (scaffolded next)
├── docker-compose.yml   Postgres + Redis for local dev
├── .env.example
└── package.json    npm workspaces root
```

## Tech stack (Phase 0 implemented)

- **API:** NestJS 10 (TypeScript), global JWT auth + RBAC guards, Throttler rate limiting
- **DB:** PostgreSQL via Prisma ORM (25+ models, multi-tenant by `tenantId`)
- **Auth:** Argon2id password hashing, access/refresh JWT with rotation, password reset
- **Security:** AES-256-GCM encryption util for mailbox credentials
- **Queues (planned):** Redis + BullMQ workers for scheduled sending
- **Web (planned):** Next.js 14 + Tailwind + shadcn/ui

## Getting started

### Option A — No Docker (embedded Postgres, no Redis)

Runs the full app (auth, campaigns, approvals, contacts, …) with **zero external
infrastructure**. The background sending engine (which needs Redis) is disabled.

```bash
# 1. Install
npm install

# 2. API env — copy and set QUEUE_ENABLED=false + a 32-byte key
cp .env.example apps/api/.env
#   in apps/api/.env: QUEUE_ENABLED=false
#   CREDENTIAL_ENCRYPTION_KEY:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Start embedded Postgres (downloads a real PG binary on first run) — keep running
npm run db:embedded          # serves localhost:5432 (aeo/aeo_password/aeo)

# 4. Migrate + seed (separate terminal)
npm run db:migrate && npm run db:seed

# 5. Run API + web (each in its own terminal)
npm run dev:api              # http://localhost:4000/api/v1
npm run dev:web              # http://localhost:3000  (admin@aeo.test / Password123!)
```

### Option B — Docker (full stack incl. sending engine)

```bash
cp .env.example .env         # set CREDENTIAL_ENCRYPTION_KEY + JWT secrets; QUEUE_ENABLED=true
npm run infra:up             # Postgres + Redis
npm run db:migrate && npm run db:seed
npm run dev:api              # API + dispatcher/send/reply workers
npm run dev:web
```

Health check: `GET http://localhost:4000/api/v1/health`

## Auth endpoints (live)

| Method | Path | Public | Purpose |
|--------|------|--------|---------|
| POST | `/auth/register` | ✅ | New tenant + super-admin |
| POST | `/auth/login` | ✅ | Issue access+refresh tokens |
| POST | `/auth/refresh` | ✅ | Rotate tokens |
| POST | `/auth/logout` |  | Revoke refresh tokens |
| POST | `/auth/forgot-password` | ✅ | Email reset token |
| POST | `/auth/reset-password` | ✅ | Set new password |
| GET  | `/auth/me` |  | Current user |
| GET  | `/users` |  | List tenant users (admin) |
| POST | `/users` |  | Create user (super-admin) |

## Outreach endpoints (live)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/email-accounts` | List / add mailbox (encrypted, → SMTP approval) |
| POST | `/email-accounts/:id/test` | Connection sanity check |
| GET/POST | `/contacts` | List / manually add contacts |
| POST | `/contacts/import` | Stage bulk import (deduped, → IMPORT approval) |
| GET/POST | `/contact-lists` | Manage contact lists |
| GET/POST/PATCH | `/templates` | Template builder CRUD + variable extraction |
| POST | `/templates/:id/spam-check` | Deliverability lint |
| GET/POST | `/campaigns` | List / create campaign (draft) |
| POST | `/campaigns/:id/submit` | Submit for approval (→ CAMPAIGN approval) |
| POST | `/campaigns/:id/steps` | Add follow-up step |
| POST | `/campaigns/:id/schedule` | Schedule approved campaign (→ SCHEDULE approval) |
| POST | `/campaigns/:id/pause` `/resume` | Lifecycle control |
| GET | `/campaigns/:id/analytics` | Performance aggregation |
| GET | `/approvals` | Pending queue (admin/sub-admin, scoped) |
| POST | `/approvals/:id/approve` `/reject` | Decide — drives the entity live |

## Admin & multi-tenant endpoints (Phase 4)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard/summary` | Role-aware aggregates (super=tenant, sub=assigned, user=own) |
| GET | `/activity-logs` | Append-only audit trail (admin) |
| GET | `/sub-admins` | List sub-admins + assignment counts |
| GET/POST | `/sub-admins/:id/assignments` | View / assign users or campaigns to a sub-admin |
| DELETE | `/sub-admins/assignments/:id` | Remove an assignment |
| GET | `/credits/me` | Caller's own balance |
| GET | `/credits/:userId` | A user's balance (admin) |
| POST | `/credits/:userId/adjust` | Grant/deduct credits (super-admin) |
| GET | `/mailbox/{inbox,sent,scheduled,failed,drafts}` | Message views by direction/status |

**Sub-admin scoping:** a `SUB_ADMIN`'s `/users`, `/approvals`, and `/dashboard/summary`
are filtered to only the users assigned to them via `SubAdminAssignment`.

## Deliverability & compliance endpoints (Phase 5)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/deliverability/email-auth?domain=` | Live SPF / DKIM / DMARC DNS check + score |
| POST | `/deliverability/validate-email` | Syntax + MX-record validation |
| GET/POST | `/suppression` | List / add to the tenant suppression list |
| DELETE | `/suppression/:id` | Remove a suppression entry |
| GET | `/compliance/contacts/:id/export` | GDPR data-portability export |
| POST | `/compliance/contacts/:id/erase` | Right-to-erasure: scrub PII + suppress |

## Sending engine (Phase 2)

Background workers (BullMQ + Redis) — start automatically with the API:

- **Dispatcher** (`dispatch` queue, repeats every 60s) — finds campaigns whose
  schedule is `APPROVED` and due, fans out an initial send + each follow-up step
  per eligible contact (active, not suppressed), capped at the daily limit,
  spaced by `sendSpeedSeconds` + jitter (warm-up friendly).
- **Send worker** (`send` queue, concurrency 5) — renders the template against
  contact fields, injects open pixel + click-tracked links + unsubscribe footer,
  sends via the mailbox's decrypted SMTP (nodemailer), records `SENT`/`FAILED`
  with retry/backoff; skips follow-ups once a reply is detected.
- **Reply poller** (`replies` queue, repeats every 5 min) — IMAP-polls active
  mailboxes and records `REPLY` events (auto-stops sequences).

Public tracking endpoints (unauthenticated):

| `GET /t/open/:messageId.png` | 1×1 pixel → `OPEN` event |
| `GET /t/click/:messageId?u=…` | record `CLICK` → 302 redirect |
| `GET /unsubscribe/:messageId` | suppress + `UNSUBSCRIBE` event |

## Implementation status

- [x] **Phase 0** — Monorepo, full Prisma schema, auth + RBAC foundation, users module
- [x] **Phase 1** — Approval engine, mailboxes (encrypted), contacts + staged import, templates, campaigns + follow-up steps + scheduling
- [x] **Phase 2** — BullMQ sending engine (dispatcher + send worker), nodemailer SMTP, warm-up spacing/jitter + daily caps, open/click/unsubscribe tracking, IMAP reply detection
- [x] **Phase 3** — Next.js web app: auth (login/register), dashboard, campaigns + builder/detail, approval center, contacts, templates, mailboxes
- [x] **Phase 4** — Sub-admins + assignment scoping, credits (grant/deduct), audit-log UI, role-aware dashboard aggregates, inbox/sent/scheduled/failed views
- [x] **Phase 5** — Deliverability (SPF/DKIM/DMARC + MX email validation via DNS), GDPR/CAN-SPAM suppression management + data export & right-to-erasure
