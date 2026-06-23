# Automated Email Outreach — Product Specification & Development Blueprint

**Version:** 1.0
**Document type:** Development-ready master spec
**Prepared:** 2026-06-23
**Positioning:** An admin-controlled, multi-client cold-email & outreach platform — combining the campaign engine of Instantly/Lemlist, the multi-account inbox of Thunderbird, and the list/template management of Mailchimp, but governed by a strict **approval workflow** so nothing sends without admin sign-off.

---

## Table of Contents
1. [Product Overview](#1-product-overview)
2. [User Roles](#2-user-roles)
3. [Full Feature List](#3-full-feature-list)
4. [Module-wise Explanation](#4-module-wise-explanation)
5. [Database Schema](#5-database-schema)
6. [User Flow](#6-user-flow)
7. [Admin Approval Workflow](#7-admin-approval-workflow)
8. [Recommended Tech Stack](#8-recommended-tech-stack)
9. [API Structure](#9-api-structure)
10. [UI/UX Layout Suggestions](#10-uiux-layout-suggestions)
11. [SaaS Dashboard Design Idea](#11-saas-dashboard-design-idea)
12. [Security Checklist](#12-security-checklist)
13. [Development Roadmap](#13-development-roadmap)
14. [MVP Feature Set](#14-mvp-feature-set)
15. [Advanced Feature Set](#15-advanced-feature-set)

---

## 1. Product Overview

### 1.1 Summary
**Automated Email Outreach (AEO)** is a plug-and-play, multi-tenant SaaS platform for running cold-email and follow-up campaigns at scale across many email accounts. Users connect their own SMTP/POP/IMAP mailboxes using email + password/app-password, build campaigns and contact lists, schedule sequences, and track replies — all from one dashboard.

The defining differentiator is **governance**: every meaningful action (campaign launch, schedule, follow-up sequence, contact import, SMTP change) enters a **Pending → Approved/Rejected** workflow. An admin (or delegated sub-admin) must approve before anything goes live. This makes the product ideal for **agencies and managed-service providers** running outreach on behalf of multiple clients, where compliance, quality control, and deliverability protection matter.

### 1.2 Core Problem Solved
- Agencies juggling many client mailboxes have no central, controlled place to manage outreach.
- Uncontrolled sending damages domain reputation and risks CAN-SPAM/GDPR violations.
- Clients/junior staff need to *create* campaigns but should not be able to *send* without oversight.

### 1.3 Target Users
- Lead-gen and outreach agencies managing campaigns for multiple clients.
- Sales teams with a manager-approval culture.
- Managed email/marketing service providers.

### 1.4 Key Outcomes
- One dashboard to manage users, clients, mailboxes, campaigns, schedules, follow-ups, and replies.
- Mandatory approval gate on all sensitive actions.
- Deliverability-safe sending (warm-up friendly speed, daily caps, time-zone scheduling).
- Full auditability (every action logged, every approval traceable).

---

## 2. User Roles

| Role | Scope | Core Power |
|------|-------|-----------|
| **Super Admin** | Entire platform | All settings, billing, sub-admin creation, global config, can approve anything |
| **Sub-Admin** | Assigned users/campaigns only | Approve/reject within granted permissions, view assigned reports; no super-admin settings |
| **User** | Own data + own clients | Create campaigns, contacts, schedules, follow-ups — but cannot activate anything without approval |

### 2.1 Role Principles
- **Data separation:** A user sees only their own contacts, campaigns, mailboxes, and reports (row-level tenant isolation).
- **Sub-admins are scoped:** They only see users/campaigns explicitly assigned to them.
- **Permission granularity:** Each role capability is a toggleable permission (RBAC + per-entity assignment), e.g. "can view user inbox," "can approve schedules," "can manage credits."
- **Approval requirement:** Users can build and draft freely; they cannot *execute* without an approved state.

### 2.2 Permission Matrix (representative)

| Capability | User | Sub-Admin (if granted) | Super Admin |
|---|---|---|---|
| Create campaign / draft | ✅ | ✅ | ✅ |
| Submit for approval | ✅ | ✅ | ✅ |
| Approve/reject campaign | ❌ | ✅ (assigned) | ✅ |
| Approve schedule / follow-up | ❌ | ✅ (assigned) | ✅ |
| View other users' inbox | ❌ | ✅ (if permission) | ✅ |
| Manage SMTP/IMAP settings | own | assigned | ✅ |
| Create sub-admins | ❌ | ❌ | ✅ |
| Manage credits/points | ❌ | ✅ (if permission) | ✅ |
| Global settings / billing | ❌ | ❌ | ✅ |
| View audit logs | own | assigned | ✅ (all) |

---

## 3. Full Feature List

### 3.1 User Panel
- Login, logout, forgot/reset password, 2FA (optional)
- My Profile (name, avatar, timezone, notification prefs, password change)
- Add/manage SMTP / POP / IMAP credentials (encrypted), connection test
- Create & manage multiple campaigns; multi-client grouping
- Draft campaigns (save without submitting)
- Submit campaign for admin approval
- Contact & contact-list management (CRUD, tags, segments)
- Bulk import (CSV/Excel), duplicate detection, email validation
- Schedule campaigns (date/time, time-zone aware, daily caps, send-speed)
- Follow-up sequences (multi-step, conditional on open/reply/no-reply)
- Mailbox views: Inbox, Sent, Draft, Scheduled, Failed
- Campaign status tracking (Draft, Pending, Approved, Running, Paused, Completed, Rejected)
- Campaign performance dashboard (sent, delivered, opens, clicks, replies, bounces)
- Balance points/credits (if enabled by admin)
- Activity log (own actions)
- Pause/resume campaigns; unsubscribe handling

### 3.2 Admin Panel
- Manage users (CRUD, suspend, impersonate-with-audit)
- Manage all campaigns across all users
- Approve/reject: campaigns, schedules, follow-up sequences, contact uploads, SMTP changes
- View any user's inbox/sent/draft/scheduled (permission-gated)
- Manage user-uploaded contacts
- Create sub-admins; allocate responsibilities & permissions
- Assign users/campaigns to sub-admins
- Manage SMTP/POP/IMAP global settings & provider presets
- Manage user balances/credits (grant, deduct, set pricing)
- Full activity approval center (one queue for all pending items)
- Full audit logs (immutable, exportable)
- Global dashboard: total users, active campaigns, scheduled emails, follow-ups, sent, failed, replies, bounce rate, open/click rate

### 3.3 Sub-Admin Panel
- Dedicated login
- Manage assigned users only
- Manage assigned campaigns only
- Review/approve activities per granted permission
- Reports for assigned users
- No super-admin settings unless explicitly granted

### 3.4 Cross-cutting / Additional
- Email template builder (drag-drop + HTML + variables)
- Personalization: `{{name}}`, `{{company}}`, `{{country}}`, custom fields
- Bulk import (CSV/Excel) with field mapping
- Duplicate detection & email validation (syntax, MX, optional SMTP ping)
- Unsubscribe management (per-tenant suppression list)
- Bounce handling (hard/soft classification, auto-suppress)
- Reply detection (IMAP polling / threading)
- Campaign pause/resume
- Time-zone based scheduling
- Daily sending limit + warm-up-friendly send speed (jitter between sends)
- Spam-score / basic deliverability checks (SPF/DKIM/DMARC hints, content score)
- Campaign analytics & reports
- Role-based permission system
- Notification system (in-app, email, optional webhook)
- Global search & filters
- Modern, responsive SaaS UI (light/dark)

---

## 4. Module-wise Explanation

### 4.1 Authentication & Identity
JWT (access + refresh) with httpOnly refresh cookie. Argon2id password hashing. Forgot-password via signed, time-limited token. Optional TOTP 2FA. All roles share one auth service; role/permissions resolved at login and embedded in token claims + re-checked server-side.

### 4.2 Mailbox / SMTP-IMAP Connection Module
Users add credentials (host, port, SSL/TLS, email, password/app-password). Credentials are **encrypted at rest** (AES-256-GCM via a KMS-managed key; never returned in plaintext to the client). A connection test runs an SMTP handshake + IMAP login before saving. **Any change to SMTP settings enters the approval queue** before the mailbox can send. Per-mailbox sending reputation, daily cap, and warm-up state are tracked.

### 4.3 Campaign Module
A campaign references: a sender mailbox, a contact list/segment, an email template (or steps), a schedule, and follow-up rules. Lifecycle states: `draft → pending → approved → scheduled → running → paused/completed` (or `rejected`). Users build freely; submitting flips state to `pending` and creates an approval record. Only `approved` campaigns can be queued.

### 4.4 Contacts Module
Contacts belong to a tenant/user, grouped into lists and segments, with arbitrary custom fields (JSON). Bulk import parses CSV/Excel, maps columns to fields, runs duplicate detection (by email hash) and validation, and **stages the import for approval** before contacts become usable. Suppression/unsubscribe list is checked at send time.

### 4.5 Template Builder
Reusable templates with subject + HTML/plain body, personalization tokens, and preview with sample contact data. Spam-score lint on save (link ratio, spam-trigger words, image/text balance, missing unsubscribe).

### 4.6 Scheduling & Sending Engine
The heart of the system. A **queue + background workers** model:
- A scheduler enqueues per-recipient send jobs respecting time-zone, daily cap, and warm-up speed (randomized delay/jitter).
- Workers pull jobs, render personalization, send via the assigned mailbox's SMTP, write a tracking pixel + rewritten click links, and record the `email_event`.
- Rate limiting per mailbox protects reputation.
- Failures retry with backoff; permanent failures → `failed` + bounce classification.

### 4.7 Follow-up Sequences
Each campaign can have ordered steps with wait intervals and conditions (`if no reply after N days`, `if opened`, `if not opened`). Sequences are themselves **approved** as part of (or separately from) the campaign. The engine evaluates conditions using reply/open events before queuing the next step; replies auto-stop the sequence.

### 4.8 Inbox / Reply Detection
IMAP poller (or IDLE where supported) fetches incoming mail per mailbox, threads by Message-ID / In-Reply-To, marks matching campaign contacts as "replied," and surfaces messages in the in-app Inbox/Sent/Draft views. Admins can view these if permission is enabled.

### 4.9 Approval Center
A unified queue showing all pending items (campaigns, schedules, follow-ups, imports, SMTP changes) filtered by assignment. Each item supports Approve / Reject (+ reason). Every decision writes to the audit log and notifies the submitter.

### 4.10 Credits / Balance Module (optional)
If enabled, sending consumes credits (e.g., 1 credit/email). Admin grants/deducts balance, sets per-user pricing. Campaign approval checks sufficient balance; sends halt when depleted.

### 4.11 Analytics & Reporting
Aggregates `email_events` into per-campaign and global metrics: sent, delivered, open rate, click rate, reply rate, bounce rate, unsubscribe rate. Time-series charts, per-user and per-sub-admin rollups, CSV export.

### 4.12 Notifications
In-app + email notifications for approvals, rejections, campaign completion, bounces over threshold, low credits. Optional outbound webhooks for integrations.

### 4.13 Audit Logs
Append-only record of every state change and admin action (actor, action, entity, before/after, IP, timestamp). Exportable; immutable; used for compliance.

---

## 5. Database Schema

PostgreSQL. Multi-tenant via `tenant_id` (or `owner_user_id`) on every business table + row-level security. Key tables below (abbreviated; `id` = UUID PK, plus `created_at`/`updated_at` on all).

```sql
-- Tenancy & Identity
tenants(id, name, plan, status, settings_json)
users(id, tenant_id, name, email UNIQUE, password_hash, role[super_admin|sub_admin|user],
      status, timezone, two_factor_secret, last_login_at)
permissions(id, key, description)
role_permissions(id, role, permission_id)                 -- base role grants
user_permissions(id, user_id, permission_id, granted_bool) -- per-user overrides
sub_admin_assignments(id, sub_admin_id, assigned_user_id NULL, assigned_campaign_id NULL)

-- Mailboxes / Credentials
email_accounts(id, tenant_id, user_id, label, protocol[smtp|imap|pop],
      smtp_host, smtp_port, smtp_secure, imap_host, imap_port,
      email_address, credentials_encrypted, status[active|pending|disabled],
      daily_limit, warmup_enabled, send_speed_seconds, reputation_score)

-- Contacts
contact_lists(id, tenant_id, user_id, name, description)
contacts(id, tenant_id, user_id, email, first_name, last_name, company, country,
      custom_fields_json, status[active|unsubscribed|bounced], dedupe_hash)
contact_list_members(id, list_id, contact_id)
suppression_list(id, tenant_id, email, reason[unsubscribe|bounce|manual], created_at)
import_jobs(id, tenant_id, user_id, filename, total_rows, valid_rows, dup_rows,
      status[pending|approved|rejected|processing|done], approval_id)

-- Templates & Campaigns
email_templates(id, tenant_id, user_id, name, subject, body_html, body_text, variables_json)
campaigns(id, tenant_id, user_id, name, client_label, email_account_id, list_id, template_id,
      status[draft|pending|approved|scheduled|running|paused|completed|rejected],
      timezone, daily_limit, send_speed_seconds, start_at, approval_id, credits_estimate)
campaign_steps(id, campaign_id, step_order, template_id, wait_days,
      condition[always|no_reply|opened|not_opened])      -- follow-up sequence
schedules(id, campaign_id, scheduled_at, timezone, status[pending|approved|queued|sent], approval_id)

-- Sending & Events
email_messages(id, tenant_id, campaign_id, step_id, contact_id, email_account_id,
      direction[outbound|inbound], message_id, in_reply_to, subject, body,
      status[queued|sent|delivered|failed|bounced|draft], sent_at, error)
email_events(id, message_id, contact_id, campaign_id,
      event_type[sent|delivered|open|click|reply|bounce|unsubscribe|complaint],
      meta_json, occurred_at)

-- Governance
approvals(id, tenant_id, entity_type[campaign|schedule|sequence|import|smtp],
      entity_id, submitted_by, status[pending|approved|rejected],
      reviewer_id, decision_reason, decided_at)
activity_logs(id, tenant_id, actor_id, action, entity_type, entity_id,
      before_json, after_json, ip_address, occurred_at)

-- Credits & Notifications
credit_accounts(id, tenant_id, user_id, balance, price_per_email)
credit_transactions(id, credit_account_id, delta, reason, reference_id)
notifications(id, user_id, type, title, body, read_bool, created_at)
```

**Key relationships:** `users → email_accounts → campaigns → campaign_steps`; `campaigns → email_messages → email_events`; every approvable action has an `approvals` row; every write hits `activity_logs`.

---

## 6. User Flow

```
Login ─► Dashboard
        │
        ├─ Add Mailbox (SMTP/IMAP) ─► [test connection] ─► submit ─► PENDING ─► admin approves ─► ACTIVE
        │
        ├─ Import Contacts (CSV/Excel) ─► dedupe + validate ─► submit ─► PENDING ─► approve ─► usable
        │
        ├─ Build Template ─► spam lint ─► save
        │
        └─ Create Campaign
              ├─ pick mailbox + list + template
              ├─ add follow-up steps
              ├─ set schedule (tz, daily cap, speed)
              ├─ Save as DRAFT  (editable, not sending)
              └─ Submit for Approval ─► PENDING
                         │
                  Admin/Sub-admin reviews
                    ├─ Reject (+reason) ─► back to user, notified
                    └─ Approve ─► [credit check] ─► SCHEDULED ─► engine queues ─► RUNNING
                                         │
                                   Tracking: opens/clicks/replies/bounces
                                         │
                                   Replies auto-stop sequence ─► Inbox
                                         │
                                   COMPLETED ─► Analytics
```

---

## 7. Admin Approval Workflow

**Rule:** No campaign, follow-up, schedule, contact import, or SMTP change goes live without approval. Every approvable entity carries a status of **Pending / Approved / Rejected**.

### 7.1 State Machine
```
            submit
 DRAFT ───────────────► PENDING
                          │  ├── reject(reason) ──► REJECTED ──► (user edits) ──► DRAFT
                          │  └── approve ─────────► APPROVED ──► (engine acts)
```

### 7.2 Flow
1. User submits an entity → system creates an `approvals` row (`status=pending`), snapshots the payload, notifies the assigned reviewer.
2. Reviewer = the sub-admin assigned to that user/campaign (if any) **or** a super admin. Routing is by `sub_admin_assignments`.
3. Reviewer opens the **Approval Center**, inspects details, and Approves or Rejects (reason required on reject).
4. **Approve:** entity transitions to its active state (campaign→scheduled, import→processing, smtp→active). Credit balance is checked where applicable.
5. **Reject:** entity returns to draft/editable; submitter notified with reason.
6. Every decision writes an immutable `activity_logs` entry (actor, decision, reason, IP, timestamp).
7. Bulk approve/reject supported for queues. Optional auto-approve rules per trusted user (admin-configurable).

### 7.3 Guarantees
- A user can never bypass the gate — send jobs are only enqueued from `approved` entities (enforced server-side, not in UI).
- Re-submission after edit creates a new approval cycle.
- SLA timers/notifications can flag stale pending items.

---

## 8. Recommended Tech Stack

### 8.1 Frontend
- **Next.js 14+ (React, App Router) + TypeScript** — SSR/SEO for marketing, SPA for app.
- **Tailwind CSS + shadcn/ui (Radix)** — modern, accessible, responsive component system.
- **TanStack Query** for server state, **Zustand** for light client state.
- **Recharts / Tremor** for analytics dashboards.
- **react-hook-form + Zod** for forms/validation.

### 8.2 Backend
- **NestJS (Node.js + TypeScript)** — modular, DI, guards for RBAC, great for queues. *(Alternative: Django/DRF if Python preferred.)*
- **REST (OpenAPI documented)**; optional GraphQL gateway later.
- **Prisma ORM** over PostgreSQL.

### 8.3 Database & Cache
- **PostgreSQL 15+** (primary, row-level security for tenant isolation).
- **Redis** — cache, rate-limit counters, and queue backend.

### 8.4 Queue & Workers (critical for scheduled email)
- **BullMQ (Redis-backed)** for job queues: send jobs, follow-up evaluation, IMAP polling, retries with backoff.
- **Dedicated worker processes** (separate from API) so sending scales independently.
- **Cron/scheduler service** (BullMQ repeatable jobs) for time-zone-aware dispatch and daily-cap resets.

### 8.5 Email & Tracking
- **Nodemailer** for SMTP send; **node-imap / ImapFlow** for inbox/reply polling.
- **Custom tracking service**: 1×1 open pixel + click-redirect link rewriting → writes `email_events`.
- Bounce handling via SMTP response codes + IMAP bounce parsing.
- Optional ESP relay (Amazon SES / Postmark) as a fallback path.

### 8.6 Infrastructure & Ops
- **Docker** containers; **Kubernetes** or managed (AWS ECS/Fargate) for scale.
- **AWS**: RDS (Postgres), ElastiCache (Redis), S3 (CSV uploads/attachments), KMS (credential encryption), SES (optional).
- **CI/CD**: GitHub Actions. **IaC**: Terraform.
- **Observability**: Sentry (errors), Prometheus + Grafana (metrics), structured logs (Loki/ELK).
- **Secrets**: AWS Secrets Manager / Vault.

### 8.7 Why this stack
TypeScript end-to-end (shared types), Redis/BullMQ is the industry-standard for reliable scheduled/background email at scale, Postgres+RLS gives strong tenant isolation, and the worker/queue split lets sending throughput grow without touching the API.

---

## 9. API Structure

REST, versioned under `/api/v1`, JWT bearer auth, all responses JSON, all list endpoints paginated + filterable. Representative endpoints:

```
# Auth
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
GET    /auth/me

# Users & Roles (admin)
GET    /users            POST /users         GET /users/:id
PATCH  /users/:id        DELETE /users/:id
POST   /users/:id/suspend
GET    /sub-admins       POST /sub-admins
POST   /sub-admins/:id/assignments     # assign users/campaigns
GET    /permissions      PATCH /users/:id/permissions

# Mailboxes
GET    /email-accounts   POST /email-accounts
POST   /email-accounts/:id/test
PATCH  /email-accounts/:id            # change -> creates approval
DELETE /email-accounts/:id

# Contacts
GET    /contacts         POST /contacts
POST   /contacts/import               # multipart CSV/Excel -> import_job (pending)
GET    /contact-lists    POST /contact-lists
POST   /contacts/validate
GET    /suppression-list POST /suppression-list

# Templates
GET    /templates        POST /templates       GET/PATCH/DELETE /templates/:id
POST   /templates/:id/spam-check

# Campaigns
GET    /campaigns        POST /campaigns       GET /campaigns/:id
PATCH  /campaigns/:id
POST   /campaigns/:id/submit          # -> pending
POST   /campaigns/:id/pause
POST   /campaigns/:id/resume
GET    /campaigns/:id/steps           POST /campaigns/:id/steps   # follow-ups
GET    /campaigns/:id/analytics

# Scheduling
POST   /campaigns/:id/schedule        # -> approval
GET    /schedules

# Approvals (admin/sub-admin)
GET    /approvals?status=pending&entity_type=campaign
POST   /approvals/:id/approve
POST   /approvals/:id/reject          # { reason }
POST   /approvals/bulk

# Mailbox views
GET    /mailbox/inbox     GET /mailbox/sent
GET    /mailbox/drafts    GET /mailbox/scheduled    GET /mailbox/failed

# Credits
GET    /credits/:userId   POST /credits/:userId/adjust

# Analytics & Logs
GET    /dashboard/summary             # role-aware aggregates
GET    /reports/campaigns
GET    /activity-logs
GET    /notifications     POST /notifications/:id/read

# Tracking (public, unauthenticated)
GET    /t/open/:token.png             # open pixel
GET    /t/click/:token                # click redirect
GET    /unsubscribe/:token
```

**Conventions:** every mutating endpoint enforces RBAC via guards, validates tenant ownership, and writes an `activity_log`. Webhooks: `POST {customer_url}` for approval/bounce/completion events.

---

## 10. UI/UX Layout Suggestions

### 10.1 Global Shell
- **Left sidebar** (collapsible): role-aware nav grouped into *Outreach* (Dashboard, Campaigns, Contacts, Templates, Follow-ups), *Mailbox* (Inbox, Sent, Drafts, Scheduled, Failed), *Admin* (Users, Sub-Admins, Approvals, Credits, Settings).
- **Top bar**: global search, tenant/client switcher, notifications bell, credit balance chip, profile menu.
- **Content area**: page header with primary action button + filters; data tables with inline status badges.

### 10.2 Key Screens
- **Dashboard:** metric cards (Active Campaigns, Scheduled, Sent today, Reply rate, Bounce rate) + time-series charts + pending-approval count + recent activity feed.
- **Campaign Builder:** stepper wizard — (1) Setup → (2) Audience → (3) Email/Template → (4) Follow-up steps → (5) Schedule → (6) Review & Submit. Live preview pane with personalization sample.
- **Approval Center:** filterable queue, split view (list left, detail right), Approve/Reject with reason, bulk actions.
- **Contacts:** table with search/filter/tags, import wizard with column mapping + dedupe preview.
- **Inbox:** three-pane (folders / thread list / message) like Thunderbird; reply-detected threads badged.
- **Analytics:** funnel (Sent→Delivered→Opened→Clicked→Replied), per-campaign and per-user breakdowns, export.

### 10.3 Patterns
- Status badges everywhere (Draft=gray, Pending=amber, Approved=green, Rejected=red, Running=blue).
- Empty states with guided CTAs. Skeleton loaders. Toast notifications.
- Responsive: sidebar collapses to bottom-nav on mobile; tables become cards.
- Light/dark theme; WCAG AA contrast.

---

## 11. SaaS Dashboard Design Idea

**Concept:** a clean, data-dense "command center" with a calm neutral base and one accent color (indigo/violet), generous whitespace, rounded-2xl cards, and subtle shadows — modern SaaS aesthetic (Linear/Vercel/Tremor influence).

- **Hero row:** 5 KPI cards with sparkline + delta vs. last period.
- **Row 2:** large area chart (sends & replies over time) + donut (deliverability breakdown).
- **Row 3:** "Needs your attention" — pending approvals list (admin) / campaign statuses (user).
- **Row 4:** recent activity timeline + top-performing campaigns table.
- **Role-aware:** Super Admin sees global tenant-wide numbers + per-sub-admin rollups; Sub-Admin sees assigned scope; User sees own campaigns/clients.
- **Micro-interactions:** hover tooltips on charts, click-through from any metric to its filtered list view.

---

## 12. Security Checklist

- [ ] **Passwords:** Argon2id hashing; strength rules; breach-check optional.
- [ ] **SMTP/IMAP credentials:** AES-256-GCM encryption at rest via KMS; decrypt only in worker memory at send; never returned to client.
- [ ] **Authentication:** short-lived JWT access + rotating refresh (httpOnly, Secure, SameSite); optional TOTP 2FA; account lockout on brute force.
- [ ] **RBAC:** server-side guards on every endpoint; per-entity ownership checks; deny-by-default.
- [ ] **Tenant isolation:** `tenant_id` scoping + PostgreSQL Row-Level Security; verified on every query.
- [ ] **Approval enforcement:** send jobs only enqueued from `approved` state, checked in the worker, not just UI.
- [ ] **Rate limiting:** per-IP and per-user API throttling (Redis); per-mailbox send rate limits.
- [ ] **Input validation:** Zod/DTO validation; parameterized queries (ORM); output encoding (XSS); CSRF protection on cookie flows.
- [ ] **Transport:** TLS everywhere; HSTS; secure headers (Helmet/CSP).
- [ ] **Audit logs:** immutable, append-only, exportable; capture actor/IP/before-after.
- [ ] **File uploads:** type/size validation, virus scan, stored in S3 (not web root).
- [ ] **Secrets:** in Secrets Manager/Vault, never in code or env files committed.
- [ ] **Compliance (GDPR/CAN-SPAM):** mandatory physical address + unsubscribe link in every email; one-click unsubscribe honored within seconds; suppression list enforced at send; data export & right-to-erasure tooling; consent/opt-out records; data-processing records per tenant.
- [ ] **Deliverability hygiene:** SPF/DKIM/DMARC guidance, warm-up speed, daily caps, bounce auto-suppression to protect domains.
- [ ] **Monitoring:** anomaly alerts (spike in bounces/complaints), Sentry, uptime checks.

---

## 13. Development Roadmap

**Phase 0 — Foundation (Weeks 1–2)**
Repo, CI/CD, Docker, Postgres+Prisma schema, auth (login/forgot/JWT), base RBAC, app shell + design system.

**Phase 1 — Core Outreach (Weeks 3–6)**
Mailbox connection (SMTP/IMAP + encryption + test), contacts CRUD + CSV import + dedupe, template builder, campaign CRUD + draft. *No sending yet.*

**Phase 2 — Approval & Sending Engine (Weeks 7–10)**
Approval workflow + Approval Center, BullMQ queue + workers, scheduler (tz, daily cap, warm-up speed), tracking pixel/click, basic analytics. **First real sends.**

**Phase 3 — Follow-ups & Inbox (Weeks 11–13)**
Follow-up sequences + conditions, IMAP polling + reply detection, Inbox/Sent/Scheduled/Failed views, bounce & unsubscribe handling.

**Phase 4 — Admin & Multi-tenant Depth (Weeks 14–16)**
Sub-admins + assignments + granular permissions, credits/billing, full audit logs, global admin dashboard, notifications.

**Phase 5 — Polish & Compliance (Weeks 17–18)**
Spam-score/deliverability checks, GDPR/CAN-SPAM tooling, mobile responsiveness pass, performance/load testing, security review, beta.

---

## 14. MVP Feature Set

The smallest version that delivers the core promise (controlled multi-client sending):

- Auth: login, forgot password, roles (super admin / user).
- Add one+ SMTP mailbox (encrypted) with connection test.
- Contacts: manual add + CSV import + dedupe.
- Template builder with `{{name}}/{{company}}/{{country}}` variables.
- Create campaign → save draft → **submit for approval**.
- Admin **Approval Center**: approve/reject (with reason).
- Queue + worker sending with daily cap + send-speed (warm-up friendly).
- Open/click tracking + per-campaign analytics (sent/open/click/bounce).
- Basic scheduling (date/time + timezone).
- Sent / Failed / Scheduled views.
- Unsubscribe link + suppression list (CAN-SPAM baseline).
- Activity log + audit of approvals.

---

## 15. Advanced Feature Set

Post-MVP capabilities that move it level with / beyond Instantly & Lemlist:

- **Sub-admins** with granular permissions + user/campaign assignment routing.
- **Multi-step follow-up sequences** with open/reply conditions and auto-stop on reply.
- **IMAP reply detection + unified Inbox** (Thunderbird-style threading).
- **Credits/points billing** with per-user pricing and auto-halt.
- **Deliverability suite:** SPF/DKIM/DMARC checks, spam-score linting, mailbox rotation, automated warm-up.
- **A/B testing** of subject lines / bodies.
- **Advanced segmentation** & dynamic lists.
- **AI assist:** subject/body generation, reply intent classification, send-time optimization.
- **Email validation provider integration** (MX + SMTP ping at scale).
- **Webhooks + API + integrations** (CRM sync, Zapier).
- **White-label / custom domains** for agencies.
- **Advanced analytics:** cohort reply rates, per-sub-admin performance, revenue attribution.
- **Auto-approval trust rules** for vetted users.
- **Bounce/complaint feedback-loop processing** (FBL, SES events).

---

*End of blueprint — ready for engineering breakdown into epics/tickets.*
