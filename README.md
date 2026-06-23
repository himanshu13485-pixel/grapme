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

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env
#   - set CREDENTIAL_ENCRYPTION_KEY:  openssl rand -base64 32
#   - set JWT secrets

# 3. Start Postgres + Redis
npm run infra:up

# 4. Create the database schema
npm run db:migrate

# 5. Seed demo accounts (admin@aeo.test / Password123!)
npm run db:seed

# 6. Run the API
npm run dev:api      # http://localhost:4000/api/v1
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

## Implementation status

- [x] **Phase 0** — Monorepo, full Prisma schema, auth + RBAC foundation, users module
- [ ] **Phase 1** — Mailboxes (encrypted), contacts + CSV import, templates, campaigns CRUD
- [ ] **Phase 2** — Approval workflow + BullMQ sending engine + tracking
- [ ] **Phase 3** — Follow-ups, IMAP reply detection, inbox views
- [ ] **Phase 4** — Sub-admins, credits, audit logs, admin dashboard
- [ ] **Phase 5** — Deliverability checks, compliance tooling, web UI polish
