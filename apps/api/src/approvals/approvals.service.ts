import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalEntity,
  ApprovalStatus,
  CampaignStatus,
  ImportStatus,
  LiCampaignStatus,
  LinkedInAccountStatus,
  LiMessageSource,
  MailboxStatus,
  ClientChangeKind,
  CohortStatus,
  EnrollmentStatus,
  Prisma,
  Role,
  ScheduleStatus,
  TemplateStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { LiCampaignsService } from '../linkedin/campaigns/li-campaigns.service';
import { LiInboxService } from '../linkedin/inbox/li-inbox.service';
import {
  ContactCreateInput,
  ContactUpdateInput,
  writeContactCreate,
  writeContactUpdate,
} from '../contacts/contact-writes.util';
import { ListApprovalsQuery } from './dto/approvals.dto';
import { cohortRef } from '../common/cohort-ref.util';
import {
  persistSequenceSteps,
  rebaseCohortStart,
  SequenceStepInput,
} from '../programs/schedule.util';
import {
  CLIENT_FIELD_LABEL,
  describeClientValue,
  settingsUpdateData,
} from '../programs/client-settings';

interface ApprovalMeta {
  target?: string;
  clientName?: string;
  /** What is being approved, shown inline: a template's content, or summary lines. */
  detail?: { subject?: string; bodyHtml?: string; lines?: string[] };
}

/** Shape of ClientChangeRequest.payload. */
interface ChangePayload {
  steps?: SequenceStepInput[];
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** Review lines written when the request was made (contacts, lists, LinkedIn). */
  lines?: string[];
  /** Kind-specific input used to apply the change. */
  data?: Record<string, unknown>;
  /** LI_ACCOUNT_CONNECT: the seat an approved request was used to start. */
  accountId?: string;
}

/** Repeating one of these while one is still waiting is a no-op. */
const ONE_SHOT_CHANGES: ClientChangeKind[] = [
  ClientChangeKind.COHORT_STOP,
  ClientChangeKind.COHORT_DELETE,
  ClientChangeKind.CONTACT_DELETE,
  ClientChangeKind.LIST_DELETE,
  ClientChangeKind.LI_CAMPAIGN_ARCHIVE,
  ClientChangeKind.LI_CAMPAIGN_DELETE,
  ClientChangeKind.LI_ACCOUNT_CONNECT,
];
/** A newer one of these replaces the one still waiting (settings are merged). */
const SUPERSEDING_CHANGES: ClientChangeKind[] = [
  ClientChangeKind.SEQUENCE,
  ClientChangeKind.COHORT_SEQUENCE,
  ClientChangeKind.SETTINGS,
  ClientChangeKind.CONTACT_UPDATE,
];
// Everything else (new contacts and lists, list membership, bulk deletes,
// LinkedIn replies) queues up independently.

const idsIn = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private liCampaigns: LiCampaignsService,
    private liInbox: LiInboxService,
  ) {}

  /** Called by other modules when a user submits an entity for review. */
  async submit(params: {
    tenantId: string;
    submittedById: string;
    entityType: ApprovalEntity;
    entityId: string;
  }) {
    const approval = await this.prisma.approval.create({
      data: {
        tenantId: params.tenantId,
        entityType: params.entityType,
        entityId: params.entityId,
        submittedById: params.submittedById,
        status: ApprovalStatus.PENDING,
      },
    });
    await this.activity.log({
      tenantId: params.tenantId,
      actorId: params.submittedById,
      action: 'SUBMIT_FOR_APPROVAL',
      entityType: params.entityType,
      entityId: params.entityId,
      after: await this.describeForLog(approval),
    });
    return approval;
  }

  /**
   * Hold a client-portal change for review. A newer request for the same thing
   * supersedes the one still waiting (settings requests are merged, so no
   * earlier field change is lost); a repeated stop/delete request is a no-op.
   */
  async submitClientChange(params: {
    tenantId: string;
    clientId: string;
    requestedById: string;
    kind: ClientChangeKind;
    targetId?: string | null;
    summary: string;
    payload: Prisma.InputJsonValue;
  }): Promise<{ id: string; duplicate: boolean }> {
    const targetId = params.targetId ?? null;
    const earlier = await this.prisma.clientChangeRequest.findMany({
      where: { tenantId: params.tenantId, clientId: params.clientId, kind: params.kind, targetId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, payload: true },
    });
    const waiting = earlier.length
      ? new Set(
          (
            await this.prisma.approval.findMany({
              where: {
                tenantId: params.tenantId,
                entityType: ApprovalEntity.CLIENT_CHANGE,
                status: ApprovalStatus.PENDING,
                entityId: { in: earlier.map((e) => e.id) },
              },
              select: { entityId: true },
            })
          ).map((a) => a.entityId),
        )
      : new Set<string>();
    const pending = earlier.filter((e) => waiting.has(e.id));

    if (ONE_SHOT_CHANGES.includes(params.kind) && pending.length) {
      return { id: pending[pending.length - 1].id, duplicate: true };
    }

    let payload = params.payload;
    let summary = params.summary;
    if (params.kind === ClientChangeKind.SETTINGS) {
      const merged: Record<string, unknown> = {};
      for (const p of pending) Object.assign(merged, (p.payload as ChangePayload)?.changes ?? {});
      Object.assign(merged, (params.payload as ChangePayload)?.changes ?? {});
      payload = { changes: merged } as Prisma.InputJsonValue;
      summary = `Settings · ${Object.keys(merged).map((k) => CLIENT_FIELD_LABEL[k] ?? k).join(', ')}`;
    }

    if (pending.length && SUPERSEDING_CHANGES.includes(params.kind)) {
      await this.prisma.approval.updateMany({
        where: {
          entityType: ApprovalEntity.CLIENT_CHANGE,
          status: ApprovalStatus.PENDING,
          entityId: { in: pending.map((p) => p.id) },
        },
        data: {
          status: ApprovalStatus.REJECTED,
          decisionReason: 'Superseded by a newer request',
          decidedAt: new Date(),
        },
      });
    }
    const request = await this.prisma.clientChangeRequest.create({
      data: {
        tenantId: params.tenantId,
        clientId: params.clientId,
        requestedById: params.requestedById,
        kind: params.kind,
        targetId,
        summary,
        payload,
      },
    });
    await this.submit({
      tenantId: params.tenantId,
      submittedById: params.requestedById,
      entityType: ApprovalEntity.CLIENT_CHANGE,
      entityId: request.id,
    });
    return { id: request.id, duplicate: false };
  }

  /**
   * An approved "connect a LinkedIn account" request the client hasn't finished
   * using. It stays usable while the seat it started is still unconnected, so an
   * abandoned LinkedIn login can be retried without asking again.
   */
  async openConnectGrant(tenantId: string, clientId: string) {
    const requests = await this.prisma.clientChangeRequest.findMany({
      where: { tenantId, clientId, kind: ClientChangeKind.LI_ACCOUNT_CONNECT },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true, createdAt: true },
    });
    if (!requests.length) return null;
    const approved = new Set(
      (
        await this.prisma.approval.findMany({
          where: {
            tenantId,
            entityType: ApprovalEntity.CLIENT_CHANGE,
            status: ApprovalStatus.APPROVED,
            entityId: { in: requests.map((r) => r.id) },
          },
          select: { entityId: true },
        })
      ).map((a) => a.entityId),
    );
    for (const r of requests) {
      if (!approved.has(r.id)) continue;
      const accountId = (r.payload as ChangePayload)?.accountId;
      if (!accountId) return { id: r.id, createdAt: r.createdAt };
      const seat = await this.prisma.linkedInAccount.findUnique({
        where: { id: accountId },
        select: { status: true, unipileAccountId: true },
      });
      if (seat && seat.status === LinkedInAccountStatus.PENDING && !seat.unipileAccountId) {
        return { id: r.id, createdAt: r.createdAt };
      }
    }
    return null;
  }

  /** Record which seat an approved connect request started. */
  async useConnectGrant(requestId: string, accountId: string) {
    const r = await this.prisma.clientChangeRequest.findUnique({
      where: { id: requestId },
      select: { payload: true },
    });
    await this.prisma.clientChangeRequest.update({
      where: { id: requestId },
      data: { payload: { ...((r?.payload as Record<string, unknown>) ?? {}), accountId } as Prisma.InputJsonValue },
    });
  }

  /** What is waiting for review in one workspace, for the client portal. */
  async pendingForClient(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        tenantId: user.tenantId,
        ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}),
      },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Workspace not found');

    const [requests, cohorts, grant] = await Promise.all([
      this.prisma.clientChangeRequest.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, kind: true, summary: true, createdAt: true },
      }),
      this.prisma.cohort.findMany({
        where: { clientId, status: CohortStatus.PENDING },
        select: { id: true, label: true, monthIndex: true, subIndex: true, createdAt: true },
      }),
      this.openConnectGrant(user.tenantId, clientId),
    ]);
    const waiting = requests.length
      ? new Set(
          (
            await this.prisma.approval.findMany({
              where: {
                tenantId: user.tenantId,
                entityType: ApprovalEntity.CLIENT_CHANGE,
                status: ApprovalStatus.PENDING,
                entityId: { in: requests.map((r) => r.id) },
              },
              select: { entityId: true },
            })
          ).map((a) => a.entityId),
        )
      : new Set<string>();

    const items: { id: string; kind: string; summary: string; createdAt: Date; ready?: boolean }[] = [
      ...requests
        .filter((r) => waiting.has(r.id))
        .map((r) => ({ id: r.id, kind: r.kind as string, summary: r.summary, createdAt: r.createdAt })),
      ...cohorts.map((c) => ({
        id: c.id,
        kind: 'COHORT',
        summary: `New cohort ${cohortRef(c.monthIndex, c.subIndex)} · ${c.label}`,
        createdAt: c.createdAt,
      })),
    ];
    if (grant) {
      items.push({
        id: grant.id,
        kind: ClientChangeKind.LI_ACCOUNT_CONNECT,
        summary: 'LinkedIn account connection approved. Click Connect account to sign in to LinkedIn.',
        createdAt: grant.createdAt,
        ready: true,
      });
    }
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async list(reviewer: AuthUser, query: ListApprovalsQuery) {
    // A sub-admin reviews items submitted by their assigned users — plus
    // anything submitted by a client-portal user (activations and any profile
    // change a client makes). Client submissions aren't tied to an assigned
    // user, so they must reach every sub-admin who can review approvals.
    let scopeFilter = {};
    if (reviewer.role === Role.SUB_ADMIN) {
      const [rows, clientUsers] = await Promise.all([
        this.prisma.subAdminAssignment.findMany({
          where: { subAdminId: reviewer.userId, assignedUserId: { not: null } },
          select: { assignedUserId: true },
        }),
        this.prisma.user.findMany({
          where: { tenantId: reviewer.tenantId, role: Role.CLIENT },
          select: { id: true },
        }),
      ]);
      const submitterIds = [
        reviewer.userId, // their own submissions (e.g. a contact import they staged)
        ...rows.map((r) => r.assignedUserId!),
        ...clientUsers.map((u) => u.id),
      ];
      scopeFilter = { submittedById: { in: submitterIds } };
    }
    const approvals = await this.prisma.approval.findMany({
      where: {
        tenantId: reviewer.tenantId,
        status: query.status,
        entityType: query.entityType,
        ...scopeFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewer: { select: { name: true, email: true } },
      },
    });
    const meta = await this.resolveTargets(approvals);
    return approvals.map((a) => ({
      ...a,
      target: meta.get(a.id)?.target ?? null,
      clientName: meta.get(a.id)?.clientName ?? null,
      // What the reviewer is actually approving, where it can be shown inline
      // (today: a template's subject and body).
      detail: meta.get(a.id)?.detail ?? null,
    }));
  }

  /** Human "what" label + owning client name per approval. */
  private async resolveTargets(
    approvals: { id: string; entityType: ApprovalEntity; entityId: string }[],
  ): Promise<Map<string, ApprovalMeta>> {
    const out = new Map<string, ApprovalMeta>();
    const idsOf = (t: ApprovalEntity) =>
      approvals.filter((a) => a.entityType === t).map((a) => a.entityId);

    const [mailboxes, imports, campaigns, schedules, messages, activations, liCampaigns] =
      await Promise.all([
      this.prisma.emailAccount.findMany({
        where: { id: { in: idsOf(ApprovalEntity.SMTP) } },
        select: { id: true, label: true, emailAddress: true, clientId: true },
      }),
      this.prisma.importJob.findMany({
        where: { id: { in: idsOf(ApprovalEntity.IMPORT) } },
        select: { id: true, filename: true, validRows: true, clientId: true },
      }),
      this.prisma.campaign.findMany({
        where: {
          id: {
            in: [
              ...idsOf(ApprovalEntity.CAMPAIGN),
              ...idsOf(ApprovalEntity.SEQUENCE),
            ],
          },
        },
        select: { id: true, name: true, clientId: true },
      }),
      this.prisma.schedule.findMany({
        where: { id: { in: idsOf(ApprovalEntity.SCHEDULE) } },
        select: {
          id: true,
          campaign: { select: { name: true, clientId: true } },
        },
      }),
      this.prisma.emailMessage.findMany({
        where: { id: { in: idsOf(ApprovalEntity.MESSAGE_DELETE) } },
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          direction: true,
          emailAccount: { select: { clientId: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: idsOf(ApprovalEntity.CLIENT_ACTIVATION) } },
        select: { id: true, name: true, email: true, companyName: true },
      }),
      this.prisma.liCampaign.findMany({
        where: { id: { in: idsOf(ApprovalEntity.LI_CAMPAIGN) } },
        select: { id: true, name: true, clientId: true },
      }),
    ]);

    // Login-email-change approvals reference the owner user; show the pending email.
    const loginEmailUsers = await this.prisma.user.findMany({
      where: { id: { in: idsOf(ApprovalEntity.CLIENT_LOGIN_EMAIL) } },
      select: { id: true, name: true, email: true, pendingEmail: true, companyName: true },
    });

    const templates = await this.prisma.emailTemplate.findMany({
      where: { id: { in: idsOf(ApprovalEntity.TEMPLATE) } },
      select: { id: true, name: true, subject: true, bodyHtml: true, clientId: true },
    });

    const changeRows = await this.prisma.clientChangeRequest.findMany({
      where: { id: { in: idsOf(ApprovalEntity.CLIENT_CHANGE) } },
    });
    const cohortRows = await this.prisma.cohort.findMany({
      where: {
        id: {
          in: [
            ...idsOf(ApprovalEntity.COHORT),
            ...changeRows.map((r) => r.targetId).filter((x): x is string => !!x),
          ],
        },
      },
      select: {
        id: true,
        label: true,
        monthIndex: true,
        subIndex: true,
        clientId: true,
        startDate: true,
        _count: { select: { enrollments: true } },
      },
    });
    // Names for the templates and lists a change request refers to.
    const refTemplateIds = new Set<string>();
    const refListIds = new Set<string>();
    for (const r of changeRows) {
      const p = (r.payload ?? {}) as ChangePayload;
      for (const step of p.steps ?? []) {
        [step.templateId, ...(step.templateIds ?? [])].forEach((t) => t && refTemplateIds.add(t));
      }
      const l = p.changes?.autoCohortListId;
      [l?.from, l?.to].forEach((v) => typeof v === 'string' && v && refListIds.add(v));
    }
    const [refTemplates, refLists] = await Promise.all([
      this.prisma.emailTemplate.findMany({
        where: { id: { in: [...refTemplateIds] } },
        select: { id: true, name: true, status: true },
      }),
      this.prisma.contactList.findMany({
        where: { id: { in: [...refListIds] } },
        select: { id: true, name: true },
      }),
    ]);

    // Resolve every referenced clientId to a name in one query.
    const clientIds = new Set<string>([...idsOf(ApprovalEntity.CLIENT_DELETE), ...idsOf(ApprovalEntity.LI_CHANNEL_REQUEST)]);
    mailboxes.forEach((m) => m.clientId && clientIds.add(m.clientId));
    imports.forEach((j) => j.clientId && clientIds.add(j.clientId));
    campaigns.forEach((c) => c.clientId && clientIds.add(c.clientId));
    schedules.forEach((s) => s.campaign?.clientId && clientIds.add(s.campaign.clientId));
    messages.forEach((m) => m.emailAccount?.clientId && clientIds.add(m.emailAccount.clientId));
    liCampaigns.forEach((c) => c.clientId && clientIds.add(c.clientId));
    templates.forEach((t) => t.clientId && clientIds.add(t.clientId));
    cohortRows.forEach((c) => clientIds.add(c.clientId));
    changeRows.forEach((r) => clientIds.add(r.clientId));
    const clientRows = await this.prisma.client.findMany({
      where: { id: { in: [...clientIds] } },
      select: { id: true, name: true },
    });
    const clientName = new Map(clientRows.map((c) => [c.id, c.name]));

    const mb = new Map(
      mailboxes.map((m) => [
        m.id,
        {
          target: m.label ? `${m.label} (${m.emailAddress})` : m.emailAddress,
          clientName: m.clientId ? clientName.get(m.clientId) : undefined,
        },
      ]),
    );
    const im = new Map(
      imports.map((j) => [
        j.id,
        {
          target: `${j.filename} · ${j.validRows} rows`,
          clientName: j.clientId ? clientName.get(j.clientId) : undefined,
        },
      ]),
    );
    const cp = new Map(
      campaigns.map((c) => [
        c.id,
        { name: c.name, clientName: c.clientId ? clientName.get(c.clientId) : undefined },
      ]),
    );
    const sc = new Map(
      schedules.map((s) => [
        s.id,
        {
          name: s.campaign?.name ?? 'campaign',
          clientName: s.campaign?.clientId ? clientName.get(s.campaign.clientId) : undefined,
        },
      ]),
    );
    const mg = new Map(
      messages.map((m) => [
        m.id,
        {
          target: `Delete ${m.direction === 'INBOUND' ? 'inbound' : 'sent'}: ${m.subject || m.fromAddress || 'message'}`,
          clientName: m.emailAccount?.clientId ? clientName.get(m.emailAccount.clientId) : undefined,
        },
      ]),
    );
    const ac = new Map(
      activations.map((u) => [
        u.id,
        {
          target: `Activate client login: ${u.name} (${u.email})`,
          clientName: u.companyName ?? u.name,
        },
      ]),
    );
    const lc = new Map(
      liCampaigns.map((c) => [
        c.id,
        { name: c.name, clientName: c.clientId ? clientName.get(c.clientId) : undefined },
      ]),
    );
    const le = new Map(
      loginEmailUsers.map((u) => [
        u.id,
        {
          target: `Change login email → ${u.pendingEmail ?? '(pending)'} (was ${u.email})`,
          clientName: u.companyName ?? u.name,
        },
      ]),
    );

    const tp = new Map(
      templates.map((t) => [
        t.id,
        {
          target: `Template · ${t.name}`,
          clientName: t.clientId ? clientName.get(t.clientId) : undefined,
          detail: { subject: t.subject, bodyHtml: t.bodyHtml },
        },
      ]),
    );

    const tplName = new Map(
      refTemplates.map((t) => [
        t.id,
        t.status === TemplateStatus.APPROVED ? t.name : `${t.name} (${t.status.toLowerCase()})`,
      ]),
    );
    const listName = new Map(refLists.map((l) => [l.id, l.name]));
    const cohortById = new Map(cohortRows.map((c) => [c.id, c]));
    const cohortLine = (id: string | null) => {
      const c = id ? cohortById.get(id) : undefined;
      return c ? `${cohortRef(c.monthIndex, c.subIndex)} · ${c.label}` : 'a cohort that no longer exists';
    };
    const co = new Map<string, ApprovalMeta>(
      cohortRows.map((c): [string, ApprovalMeta] => [
        c.id,
        {
          target: `New cohort ${cohortRef(c.monthIndex, c.subIndex)} · ${c.label}`,
          clientName: clientName.get(c.clientId),
          detail: {
            lines: [
              `${c._count.enrollments} contact${c._count.enrollments === 1 ? '' : 's'}`,
              `Starts ${c.startDate.toISOString().slice(0, 10)}, or on approval if that is later`,
            ],
          },
        },
      ]),
    );
    const cc = new Map<string, ApprovalMeta>(
      changeRows.map((r): [string, ApprovalMeta] => {
        const p = (r.payload ?? {}) as ChangePayload;
        let lines: string[];
        if (p.lines?.length) {
          lines = p.lines;
        } else if (r.kind === ClientChangeKind.SEQUENCE || r.kind === ClientChangeKind.COHORT_SEQUENCE) {
          lines = [...(p.steps ?? [])]
            .sort((a, b) => a.stageOrder - b.stageOrder)
            .map((step, i) => {
              const ids = (step.templateIds?.length ? step.templateIds : [step.templateId])
                .filter((t): t is string => !!t);
              const names = ids.map((t) => tplName.get(t) ?? 'unknown template');
              return `${i === 0 ? 'Initial' : `Follow-up ${i}`} · month ${step.monthOffset ?? 1} · ${names.join(' / ') || 'no template'}`;
            });
          if (r.kind === ClientChangeKind.COHORT_SEQUENCE) lines.unshift(`Cohort: ${cohortLine(r.targetId)}`);
        } else if (r.kind === ClientChangeKind.SETTINGS) {
          lines = Object.entries(p.changes ?? {}).map(
            ([k, c]) =>
              `${CLIENT_FIELD_LABEL[k] ?? k}: ${describeClientValue(k, c.from, listName)} → ${describeClientValue(k, c.to, listName)}`,
          );
        } else {
          lines = [`Cohort: ${cohortLine(r.targetId)}`];
        }
        return [r.id, { target: r.summary, clientName: clientName.get(r.clientId), detail: { lines } }];
      }),
    );

    for (const a of approvals) {
      switch (a.entityType) {
        case ApprovalEntity.TEMPLATE:
          if (tp.has(a.entityId)) out.set(a.id, tp.get(a.entityId)!);
          break;
        case ApprovalEntity.COHORT:
          if (co.has(a.entityId)) out.set(a.id, co.get(a.entityId)!);
          break;
        case ApprovalEntity.CLIENT_CHANGE:
          if (cc.has(a.entityId)) out.set(a.id, cc.get(a.entityId)!);
          break;
        case ApprovalEntity.SMTP:
          if (mb.has(a.entityId)) out.set(a.id, mb.get(a.entityId)!);
          break;
        case ApprovalEntity.IMPORT:
          if (im.has(a.entityId)) out.set(a.id, im.get(a.entityId)!);
          break;
        case ApprovalEntity.CAMPAIGN: {
          const c = cp.get(a.entityId);
          if (c) out.set(a.id, { target: c.name, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.SEQUENCE: {
          const c = cp.get(a.entityId);
          if (c) out.set(a.id, { target: `Sequence · ${c.name}`, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.SCHEDULE: {
          const s = sc.get(a.entityId);
          if (s) out.set(a.id, { target: `Schedule · ${s.name}`, clientName: s.clientName });
          break;
        }
        case ApprovalEntity.MESSAGE_DELETE:
          if (mg.has(a.entityId)) out.set(a.id, mg.get(a.entityId)!);
          break;
        case ApprovalEntity.CLIENT_DELETE: {
          const n = clientName.get(a.entityId);
          if (n) out.set(a.id, { target: `Delete client: ${n}`, clientName: n });
          break;
        }
        case ApprovalEntity.CLIENT_ACTIVATION:
          if (ac.has(a.entityId)) out.set(a.id, ac.get(a.entityId)!);
          break;
        case ApprovalEntity.CLIENT_LOGIN_EMAIL:
          if (le.has(a.entityId)) out.set(a.id, le.get(a.entityId)!);
          break;
        case ApprovalEntity.LI_CAMPAIGN: {
          const c = lc.get(a.entityId);
          if (c) out.set(a.id, { target: `LinkedIn campaign · ${c.name}`, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.LI_CHANNEL_REQUEST: {
          const n = clientName.get(a.entityId);
          out.set(a.id, { target: 'Enable LinkedIn channel', clientName: n });
          break;
        }
      }
    }
    return out;
  }

  /** What an approval is about, for the activity log: item, company and the reviewed detail. */
  private async describeForLog(a: { id: string; entityType: ApprovalEntity; entityId: string }) {
    try {
      const meta = (await this.resolveTargets([a])).get(a.id);
      const details =
        meta?.detail?.lines?.join(' · ') ??
        (meta?.detail?.subject ? `Subject: ${meta.detail.subject}` : undefined);
      return JSON.parse(
        JSON.stringify({
          name: meta?.target,
          client: meta?.clientName,
          type: a.entityType,
          details: details?.slice(0, 1000),
        }),
      ) as Record<string, unknown>;
    } catch {
      return { type: a.entityType };
    }
  }

  async approve(reviewer: AuthUser, approvalId: string) {
    const approval = await this.getPending(reviewer.tenantId, approvalId);
    // Described before it's applied: approving a delete removes the thing it names.
    const what = await this.describeForLog(approval);
    await this.transitionEntity(approval.entityType, approval.entityId, true);
    return this.finalize(reviewer, approvalId, ApprovalStatus.APPROVED, undefined, what);
  }

  async reject(reviewer: AuthUser, approvalId: string, reason: string) {
    const approval = await this.getPending(reviewer.tenantId, approvalId);
    const what = await this.describeForLog(approval);
    await this.transitionEntity(approval.entityType, approval.entityId, false, reason);
    return this.finalize(reviewer, approvalId, ApprovalStatus.REJECTED, reason, what);
  }

  private async getPending(tenantId: string, approvalId: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, tenantId, status: ApprovalStatus.PENDING },
    });
    if (!approval) throw new NotFoundException('Pending approval not found');
    return approval;
  }

  private async finalize(
    reviewer: AuthUser,
    approvalId: string,
    status: ApprovalStatus,
    reason?: string,
    what?: Record<string, unknown>,
  ) {
    const updated = await this.prisma.approval.update({
      where: { id: approvalId },
      data: {
        status,
        reviewerId: reviewer.userId,
        decisionReason: reason,
        decidedAt: new Date(),
      },
    });
    await this.activity.log({
      tenantId: reviewer.tenantId,
      actorId: reviewer.userId,
      action: status === ApprovalStatus.APPROVED ? 'APPROVE' : 'REJECT',
      entityType: updated.entityType,
      entityId: updated.entityId,
      after: { ...(what ?? {}), reason },
    });
    return updated;
  }

  /**
   * Drives the linked entity into its post-decision state.
   * This is the gate: entities only become active here, never from the user API.
   */
  private async transitionEntity(
    entityType: ApprovalEntity,
    entityId: string,
    approved: boolean,
    reason?: string,
  ) {
    // updateMany (not update) so a decision on an approval whose entity was
    // already deleted finalizes cleanly instead of throwing a 500.
    switch (entityType) {
      case ApprovalEntity.TEMPLATE:
        // Approve = the template becomes sendable; reject = it stays unsendable
        // and the reason is shown to the client so they can fix and resubmit.
        await this.prisma.emailTemplate.updateMany({
          where: { id: entityId },
          data: approved
            ? { status: TemplateStatus.APPROVED, reviewNote: null }
            : { status: TemplateStatus.REJECTED, reviewNote: reason ?? null },
        });
        break;
      case ApprovalEntity.COHORT: {
        // Approve = start sending; reject = remove the cohort so its contacts
        // are free for a future cohort (a contact can only be in one).
        const waiting = await this.prisma.cohort.count({
          where: { id: entityId, status: CohortStatus.PENDING },
        });
        if (!waiting) break;
        if (approved) {
          await rebaseCohortStart(this.prisma, entityId, new Date());
          await this.prisma.cohort.updateMany({
            where: { id: entityId, status: CohortStatus.PENDING },
            data: { status: CohortStatus.RUNNING },
          });
        } else {
          await this.prisma.cohort.deleteMany({
            where: { id: entityId, status: CohortStatus.PENDING },
          });
        }
        break;
      }
      case ApprovalEntity.CLIENT_CHANGE:
        // Approve = apply the held change; reject = discard it (nothing was changed).
        if (approved) await this.applyClientChange(entityId);
        break;
      case ApprovalEntity.CAMPAIGN:
        await this.prisma.campaign.updateMany({
          where: { id: entityId },
          data: {
            status: approved
              ? CampaignStatus.APPROVED
              : CampaignStatus.REJECTED,
          },
        });
        break;
      case ApprovalEntity.SMTP:
        await this.prisma.emailAccount.updateMany({
          where: { id: entityId },
          data: {
            status: approved ? MailboxStatus.ACTIVE : MailboxStatus.DISABLED,
            // Approving an enable request (including a client's re-enable after the
            // bounce breaker) starts a fresh bounce window, so the old bounces can't
            // disable it again on the next sweep.
            ...(approved ? { statusReason: null, bounceWindowFrom: new Date() } : {}),
          },
        });
        break;
      case ApprovalEntity.IMPORT:
        if (approved) {
          await this.processImport(entityId);
        } else {
          await this.prisma.importJob.updateMany({
            where: { id: entityId },
            data: { status: ImportStatus.REJECTED },
          });
        }
        break;
      case ApprovalEntity.SCHEDULE:
        await this.prisma.schedule.updateMany({
          where: { id: entityId },
          data: {
            status: approved ? ScheduleStatus.APPROVED : ScheduleStatus.PENDING,
          },
        });
        break;
      case ApprovalEntity.SEQUENCE:
        // Sequences live on the campaign; approval is recorded but no
        // entity-level flag is flipped here.
        break;
      case ApprovalEntity.MESSAGE_DELETE:
        // Approve = carry out the requested deletion; reject = keep the message.
        if (approved) {
          await this.prisma.emailMessage.deleteMany({ where: { id: entityId } });
        }
        break;
      case ApprovalEntity.CLIENT_DELETE:
        // Approve = delete the client (cohorts/sequences/enrollments cascade;
        // mailboxes/contacts/lists/templates/campaigns are kept + unlinked).
        if (approved) {
          await this.prisma.client.deleteMany({ where: { id: entityId } });
        }
        break;
      case ApprovalEntity.LI_CAMPAIGN:
        // Approve = launch the LinkedIn campaign (RUNNING + scheduler picks it up);
        // reject = leave it DRAFT so the client can edit and resubmit.
        if (approved) {
          const exists = await this.prisma.liCampaign.count({ where: { id: entityId } });
          if (exists) await this.liCampaigns.setStatus(entityId, LiCampaignStatus.RUNNING);
        }
        break;
      case ApprovalEntity.LI_CHANNEL_REQUEST:
        // Approve = turn the LinkedIn channel on for a client who requested it at
        // self-service setup; reject = leave it off (Email stays active either way).
        if (approved) {
          await this.prisma.client.updateMany({ where: { id: entityId }, data: { linkedInEnabled: true } });
        }
        break;
      case ApprovalEntity.CLIENT_ACTIVATION:
        // Approve = confirm the client's email so they can sign in; reject =
        // suspend the pending login so it can't be used.
        await this.prisma.user.updateMany({
          where: { id: entityId },
          data: approved
            ? {
                emailVerified: true,
                verifyTokenHash: null,
                verifyExpires: null,
                status: 'ACTIVE',
              }
            : { status: 'SUSPENDED' },
        });
        break;
      case ApprovalEntity.CLIENT_LOGIN_EMAIL: {
        // Fallback path (email not received): approve = apply the pending login email;
        // reject = discard it (current login stays unchanged).
        const u = await this.prisma.user.findFirst({ where: { id: entityId } });
        if (u?.pendingEmail && approved) {
          const clash = await this.prisma.user.findFirst({ where: { email: u.pendingEmail, id: { not: u.id } } });
          await this.prisma.user.update({
            where: { id: u.id },
            data: clash
              ? { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null }
              : { email: u.pendingEmail, emailVerified: true, pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null },
          });
        } else if (!approved) {
          await this.prisma.user.updateMany({
            where: { id: entityId },
            data: { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null },
          });
        }
        break;
      }
    }
  }

  /** Carry out an approved client-portal change request. */
  private async applyClientChange(requestId: string) {
    const req = await this.prisma.clientChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) return;
    const p = (req.payload ?? {}) as ChangePayload;
    // Workspaces the requesting client owns, re-read now so the checks the
    // direct path runs are enforced again at apply time.
    const requesterClients = async () =>
      (
        await this.prisma.client.findMany({
          where: { tenantId: req.tenantId, ownerUserId: req.requestedById },
          select: { id: true },
        })
      ).map((c) => c.id);
    switch (req.kind) {
      case ClientChangeKind.SEQUENCE: {
        const steps = p.steps ?? [];
        if (!steps.length) break;
        await persistSequenceSteps(this.prisma, { clientId: req.clientId, cohortId: null }, steps);
        await this.prisma.client.updateMany({
          where: { id: req.clientId },
          data: { followUpCount: steps.reduce((m, st) => Math.max(m, st.stageOrder), 0) },
        });
        break;
      }
      case ClientChangeKind.COHORT_SEQUENCE: {
        if (!req.targetId || !p.steps?.length) break;
        const live = await this.prisma.cohort.count({ where: { id: req.targetId, clientId: req.clientId } });
        if (!live) break;
        await persistSequenceSteps(this.prisma, { clientId: req.clientId, cohortId: req.targetId }, p.steps);
        break;
      }
      case ClientChangeKind.SETTINGS: {
        const data = settingsUpdateData(p.changes ?? {});
        const listId = data.autoCohortListId;
        if (typeof listId === 'string' && listId) {
          const own = await this.prisma.contactList.count({ where: { id: listId, clientId: req.clientId } });
          if (!own) delete data.autoCohortListId;
        }
        if (Object.keys(data).length) {
          await this.prisma.client.updateMany({
            where: { id: req.clientId },
            data: data as Prisma.ClientUncheckedUpdateManyInput,
          });
        }
        break;
      }
      case ClientChangeKind.COHORT_STOP: {
        if (!req.targetId) break;
        const stopped = await this.prisma.cohort.updateMany({
          where: {
            id: req.targetId,
            clientId: req.clientId,
            status: { in: [CohortStatus.RUNNING, CohortStatus.PAUSED] },
          },
          data: { status: CohortStatus.STOPPED, endedAt: new Date() },
        });
        if (stopped.count) {
          await this.prisma.enrollment.updateMany({
            where: { cohortId: req.targetId, status: EnrollmentStatus.ACTIVE },
            data: { status: EnrollmentStatus.STOPPED },
          });
        }
        break;
      }
      case ClientChangeKind.COHORT_DELETE:
        if (req.targetId) {
          await this.prisma.cohort.deleteMany({ where: { id: req.targetId, clientId: req.clientId } });
        }
        break;
      case ClientChangeKind.CONTACT_CREATE:
        await writeContactCreate(
          this.prisma,
          { tenantId: req.tenantId, userId: req.requestedById },
          p.data as unknown as ContactCreateInput,
          await requesterClients(),
        );
        break;
      case ClientChangeKind.CONTACT_UPDATE:
        if (req.targetId) {
          await writeContactUpdate(
            this.prisma,
            req.tenantId,
            req.targetId,
            p.data as unknown as ContactUpdateInput,
            await requesterClients(),
          );
        }
        break;
      case ClientChangeKind.CONTACT_DELETE:
        if (req.targetId) {
          await this.prisma.contact.deleteMany({ where: { id: req.targetId, clientId: req.clientId } });
        }
        break;
      case ClientChangeKind.CONTACT_BULK_DELETE:
        await this.prisma.contact.deleteMany({
          where: { id: { in: idsIn(p.data?.ids) }, clientId: req.clientId },
        });
        break;
      case ClientChangeKind.LIST_CREATE:
        await this.prisma.contactList.create({
          data: {
            tenantId: req.tenantId,
            userId: req.requestedById,
            clientId: req.clientId,
            name: String(p.data?.name ?? 'New list'),
            description: typeof p.data?.description === 'string' ? p.data.description : null,
          },
        });
        break;
      case ClientChangeKind.LIST_DELETE:
        if (req.targetId) {
          await this.prisma.contactList.deleteMany({ where: { id: req.targetId, clientId: req.clientId } });
        }
        break;
      case ClientChangeKind.LIST_MEMBERS_ADD: {
        if (!req.targetId) break;
        const listId = req.targetId;
        const live = await this.prisma.contactList.count({ where: { id: listId, clientId: req.clientId } });
        if (!live) break;
        const contacts = await this.prisma.contact.findMany({
          where: { id: { in: idsIn(p.data?.contactIds) }, clientId: { in: await requesterClients() } },
          select: { id: true },
        });
        for (const c of contacts) {
          await this.prisma.contactListMember.upsert({
            where: { listId_contactId: { listId, contactId: c.id } },
            update: {},
            create: { listId, contactId: c.id },
          });
        }
        break;
      }
      case ClientChangeKind.LIST_MEMBERS_REMOVE: {
        if (!req.targetId) break;
        const live = await this.prisma.contactList.count({ where: { id: req.targetId, clientId: req.clientId } });
        if (!live) break;
        await this.prisma.contactListMember.deleteMany({
          where: { listId: req.targetId, contactId: { in: idsIn(p.data?.contactIds) } },
        });
        break;
      }
      case ClientChangeKind.LI_REPLY:
        // Sends now, from the client's seat. If LinkedIn rejects the send the
        // approval throws and stays pending, so the reviewer sees the failure.
        if (req.targetId) {
          await this.liInbox.reply(
            req.targetId,
            String(p.data?.text ?? ''),
            p.data?.source === LiMessageSource.AI ? LiMessageSource.AI : LiMessageSource.MANUAL,
          );
        }
        break;
      case ClientChangeKind.LI_CAMPAIGN_ARCHIVE:
      case ClientChangeKind.LI_CAMPAIGN_DELETE: {
        if (!req.targetId) break;
        const target =
          req.kind === ClientChangeKind.LI_CAMPAIGN_DELETE ? LiCampaignStatus.DELETED : LiCampaignStatus.ARCHIVED;
        const c = await this.prisma.liCampaign.findFirst({
          where: { id: req.targetId, clientId: req.clientId },
          select: { status: true },
        });
        if (c && c.status !== target) await this.liCampaigns.setStatus(req.targetId, target);
        break;
      }
      case ClientChangeKind.LI_ACCOUNT_CONNECT:
        // The approval is the permission: the client's next Connect click issues
        // the LinkedIn login link (see openConnectGrant).
        break;
    }
  }

  /** Inserts the staged rows of an approved import (deduped per tenant). */
  private async processImport(importJobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: importJobId },
    });
    if (!job) return;

    const rows = (job.payload as Array<Record<string, string>>) ?? [];

    // The list being uploaded into (List-2), for the duplicate report.
    const newListName = job.listId
      ? (await this.prisma.contactList.findUnique({ where: { id: job.listId }, select: { name: true } }))?.name ?? null
      : null;
    const dupes: Prisma.DuplicateEmailCreateManyInput[] = [];

    for (const row of rows) {
      const hash = createHash('sha256')
        .update((row.email ?? '').trim().toLowerCase())
        .digest('hex');

      // Already in the tenant? Then this row is a duplicate (e.g. it already
      // lived in List-1). Record where it came from and where it already exists.
      const existing = await this.prisma.contact.findUnique({
        where: { tenantId_dedupeHash: { tenantId: job.tenantId, dedupeHash: hash } },
        select: {
          company: true,
          clientId: true,
          lists: { select: { list: { select: { name: true } } } },
        },
      });
      if (existing) {
        // Duplicate: record it and EXCLUDE it entirely — the address is not
        // touched and is NOT added to the new list. Only genuinely new
        // contacts flow into List-2.
        dupes.push({
          tenantId: job.tenantId,
          email: (row.email ?? '').trim(),
          fileName: job.filename,
          importJobId: job.id,
          newListId: job.listId,
          newListName,
          newCompany: row.company ?? null,
          existingListNames:
            existing.lists.map((l) => l.list.name).filter(Boolean).join(', ') || null,
          existingCompany: existing.company ?? null,
          existingClientId: existing.clientId ?? null,
        });
        continue;
      }

      const contact = await this.prisma.contact.create({
        data: {
          tenantId: job.tenantId,
          userId: job.userId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          country: row.country,
          clientId: job.clientId,
          dedupeHash: hash,
        },
      });

      if (job.listId) {
        await this.prisma.contactListMember.create({
          data: { listId: job.listId, contactId: contact.id },
        });
      }
    }

    if (dupes.length) {
      await this.prisma.duplicateEmail.createMany({ data: dupes });
    }

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: ImportStatus.DONE },
    });
  }
}
