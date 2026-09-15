import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  LiCreditReason, LiLeadStatus, LiMessageDirection, LiMessageSource,
  LiScheduledActionStatus, LiSentiment, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { LiAiService } from '../ai/ai.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { quickSentiment } from './li-sentiment';
import { linkConversation } from '../link-conversation';

export type InboxTab = 'all' | 'unread' | 'needs_reply' | 'replied';

interface AiFetchResult { sentiment: LiSentiment; intent: string; draftReply: string; }

@Injectable()
export class LiInboxService {
  private readonly logger = new Logger(LiInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: LinkedInSubscriptionService,
    private readonly ai: LiAiService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {}

  /** Ingest an inbound message from the Unipile messaging webhook. */
  async ingestInbound(payload: { account_id?: string; chat_id?: string; message_id?: string; text?: string; is_sender?: boolean; timestamp?: string; sender_id?: string }) {
    if (payload.is_sender) return { ok: true, ignored: 'outbound echo' };
    const chatId = payload.chat_id;
    const text = payload.text ?? '';
    if (!chatId) return { ok: false, reason: 'no chat_id' };

    let conversation = await this.prisma.liConversation.findFirst({ where: { unipileChatId: chatId }, include: { lead: true } });
    // Unknown chat: the lead was messaged manually (or replied before we messaged) —
    // match the chat's participant to a lead on this seat and attach it, instead of dropping.
    if (!conversation) {
      conversation = await this.attachUnknownChat(payload.account_id, chatId, payload.sender_id);
    }
    if (!conversation) { this.logger.warn(`Inbound for unknown chat ${chatId} (no matching lead)`); return { ok: false, reason: 'no conversation' }; }

    if (payload.message_id) {
      const dupe = await this.prisma.liMessage.findUnique({ where: { unipileMessageId: payload.message_id } });
      if (dupe) return { ok: true, ignored: 'duplicate' };
    }

    const at = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const sentiment = quickSentiment(text);
    await this.prisma.$transaction([
      this.prisma.liMessage.create({
        data: { conversationId: conversation.id, direction: LiMessageDirection.INBOUND, source: LiMessageSource.MANUAL, body: text, unipileMessageId: payload.message_id ?? null, sentAt: at },
      }),
      this.prisma.liConversation.update({ where: { id: conversation.id }, data: { unreadCount: { increment: 1 }, needsReply: true, lastReplyAt: at } }),
      this.prisma.liLead.update({ where: { id: conversation.leadId }, data: { status: LiLeadStatus.REPLIED, sentiment, lastReplyAt: at } }),
      // A reply ends the sequence — cancel any pending follow-ups / acceptance checks so
      // they don't linger as "Scheduled" (the processor already skips REPLIED leads).
      this.prisma.liScheduledAction.updateMany({
        where: { leadId: conversation.leadId, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] } },
        data: { status: LiScheduledActionStatus.CANCELLED, lastError: 'Lead replied — sequence stopped' },
      }),
    ]);
    return { ok: true };
  }

  /**
   * Resolve an inbound message on a chat we haven't seen to the right lead: match the
   * chat's participant (from the webhook's sender id, else fetched from the provider)
   * to a lead on the same seat, then create the conversation. Returns null if no lead
   * matches (a genuinely unrelated chat).
   */
  private async attachUnknownChat(accountId: string | undefined, chatId: string, senderId?: string) {
    if (!accountId) return null;
    const memberIds = senderId ? [senderId] : await this.provider.getChatMemberIds({ accountId, chatId });
    if (memberIds.length === 0) return null;
    const lead = await this.prisma.liLead.findFirst({
      where: {
        unipileMemberId: { in: memberIds },
        campaign: { linkedInAccount: { unipileAccountId: accountId } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) return null;
    const conv = await linkConversation(this.prisma, lead.id, chatId, (m) => this.logger.warn(m));
    return { ...conv, lead };
  }

  /**
   * Pull a lead's full chat history from the provider (both directions) and reconcile
   * it into the DB — used by the admin "Sync from LinkedIn" so manually-exchanged
   * messages appear too. Dedupes by provider message id. Returns messages added.
   */
  async backfillLeadMessages(leadId: string, accountId: string, chatId: string): Promise<number> {
    const msgs = await this.provider.listMessages({ accountId, chatId }).catch(() => []);
    if (msgs.length === 0) return 0;
    const conv = await linkConversation(this.prisma, leadId, chatId, (m) => this.logger.warn(m));
    let added = 0;
    let lastInboundAt: Date | null = null;
    let lastInboundText = '';
    for (const m of msgs) {
      if (m.messageId) {
        const dupe = await this.prisma.liMessage.findUnique({ where: { unipileMessageId: m.messageId } });
        if (dupe) continue;
      }
      const at = m.timestamp ? new Date(m.timestamp) : new Date();
      const inbound = m.direction === 'INBOUND';
      await this.prisma.liMessage.create({
        data: {
          conversationId: conv.id,
          direction: inbound ? LiMessageDirection.INBOUND : LiMessageDirection.OUTBOUND,
          source: inbound ? LiMessageSource.MANUAL : LiMessageSource.AUTO,
          body: m.text,
          unipileMessageId: m.messageId || null,
          sentAt: at,
        },
      });
      added++;
      if (inbound && (!lastInboundAt || at > lastInboundAt)) { lastInboundAt = at; lastInboundText = m.text; }
    }
    // If they've replied at any point, reflect it on the conversation + lead.
    if (lastInboundAt) {
      await this.prisma.liConversation.update({ where: { id: conv.id }, data: { needsReply: true, lastReplyAt: lastInboundAt } });
      await this.prisma.liLead.update({
        where: { id: leadId },
        data: { status: LiLeadStatus.REPLIED, lastReplyAt: lastInboundAt, sentiment: quickSentiment(lastInboundText) },
      });
      // Reply ends the sequence — cancel any pending follow-ups / acceptance checks.
      await this.prisma.liScheduledAction.updateMany({
        where: { leadId, status: { in: [LiScheduledActionStatus.PENDING, LiScheduledActionStatus.QUEUED] } },
        data: { status: LiScheduledActionStatus.CANCELLED, lastError: 'Lead replied — sequence stopped' },
      });
    }
    return added;
  }

  /** Unified inbox list for a client. */
  async list(clientId: string, opts: { tab?: InboxTab; accountId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const where: Prisma.LiConversationWhereInput = {
      lastReplyAt: { not: null },
      lead: {
        campaign: { clientId, ...(opts.accountId ? { linkedInAccountId: opts.accountId } : {}) },
        ...(opts.search ? { OR: [{ fullName: { contains: opts.search, mode: 'insensitive' } }, { company: { contains: opts.search, mode: 'insensitive' } }] } : {}),
      },
      ...this.tabWhere(opts.tab),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.liConversation.count({ where }),
      this.prisma.liConversation.findMany({
        where, orderBy: { lastReplyAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: {
          lead: {
            select: {
              id: true, fullName: true, title: true, company: true, location: true, avatarUrl: true, sentiment: true, intent: true,
              campaign: { select: { id: true, name: true, linkedInAccount: { select: { id: true, fullName: true } } } },
              aiFetches: { select: { id: true }, take: 1 },
            },
          },
        },
      }),
    ]);
    const items = rows.map((c) => ({
      conversationId: c.id, unreadCount: c.unreadCount, needsReply: c.needsReply, lastReplyAt: c.lastReplyAt,
      analyzed: c.lead.aiFetches.length > 0,
      lead: { id: c.lead.id, fullName: c.lead.fullName, title: c.lead.title, company: c.lead.company, location: c.lead.location, avatarUrl: c.lead.avatarUrl, sentiment: c.lead.sentiment, intent: c.lead.intent },
      account: c.lead.campaign.linkedInAccount,
      campaign: { id: c.lead.campaign.id, name: c.lead.campaign.name },
    }));
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), items };
  }

  /**
   * Build the tenant-scoped where clause for the admin cross-client inbox.
   * The free-text filter matches the owning CLIENT (name / company / invoice),
   * the CONTACT that replied (lead name / company), or the LinkedIn SEAT (account name),
   * so an admin can search by whichever they remember.
   */
  private async globalWhere(tenantId: string, search?: string, tab?: InboxTab): Promise<Prisma.LiConversationWhereInput> {
    const where: Prisma.LiConversationWhereInput = {
      lastReplyAt: { not: null },
      lead: { campaign: { tenantId } },
      ...this.tabWhere(tab),
    };
    const q = search?.trim();
    if (!q) return where;

    const ci = { contains: q, mode: 'insensitive' as const };
    const clients = await this.prisma.client.findMany({
      where: { tenantId, OR: [{ name: ci }, { productCategory: ci }, { invoiceNo: ci }] },
      select: { id: true },
    });
    const clientIds = clients.map((c) => c.id);
    const or: Prisma.LiConversationWhereInput[] = [
      { lead: { fullName: ci } },
      { lead: { company: ci } },
      { lead: { campaign: { linkedInAccount: { is: { fullName: ci } } } } },
    ];
    if (clientIds.length) or.push({ lead: { campaign: { clientId: { in: clientIds } } } });
    return { AND: [where, { OR: or }] };
  }

  /** Admin cross-client LinkedIn inbox: all conversations in the tenant, filterable by client/contact/seat. */
  async globalList(tenantId: string, opts: { tab?: InboxTab; clientSearch?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const where = await this.globalWhere(tenantId, opts.clientSearch, opts.tab);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.liConversation.count({ where }),
      this.prisma.liConversation.findMany({
        where, orderBy: { lastReplyAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: {
          lead: {
            select: {
              id: true, fullName: true, title: true, company: true, location: true, avatarUrl: true, sentiment: true, intent: true,
              campaign: { select: { id: true, name: true, clientId: true, linkedInAccount: { select: { id: true, fullName: true } } } },
              aiFetches: { select: { id: true }, take: 1 },
            },
          },
        },
      }),
    ]);
    const cids = [...new Set(rows.map((r) => r.lead.campaign.clientId))];
    const clients = await this.prisma.client.findMany({ where: { id: { in: cids } }, select: { id: true, name: true, productCategory: true, invoiceNo: true } });
    const cmap = new Map(clients.map((c) => [c.id, c]));
    const items = rows.map((c) => {
      const cl = cmap.get(c.lead.campaign.clientId);
      return {
        conversationId: c.id, unreadCount: c.unreadCount, needsReply: c.needsReply, lastReplyAt: c.lastReplyAt,
        analyzed: c.lead.aiFetches.length > 0,
        lead: { id: c.lead.id, fullName: c.lead.fullName, title: c.lead.title, company: c.lead.company, location: c.lead.location, avatarUrl: c.lead.avatarUrl, sentiment: c.lead.sentiment, intent: c.lead.intent },
        account: c.lead.campaign.linkedInAccount,
        campaign: { id: c.lead.campaign.id, name: c.lead.campaign.name },
        client: cl ? { id: cl.id, name: cl.name, company: cl.productCategory, invoice: cl.invoiceNo } : null,
      };
    });
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), items };
  }

  async globalCounts(tenantId: string, clientSearch?: string) {
    const base = await this.globalWhere(tenantId, clientSearch);
    const [all, unread, needsReply, replied] = await this.prisma.$transaction([
      this.prisma.liConversation.count({ where: base }),
      this.prisma.liConversation.count({ where: { AND: [base, { unreadCount: { gt: 0 } }] } }),
      this.prisma.liConversation.count({ where: { AND: [base, { needsReply: true }] } }),
      this.prisma.liConversation.count({ where: { AND: [base, { needsReply: false }] } }),
    ]);
    return { all, unread, needsReply, replied };
  }

  async counts(clientId: string, accountId?: string) {
    const base: Prisma.LiConversationWhereInput = {
      lastReplyAt: { not: null },
      lead: { campaign: { clientId, ...(accountId ? { linkedInAccountId: accountId } : {}) } },
    };
    const [all, unread, needsReply, replied] = await this.prisma.$transaction([
      this.prisma.liConversation.count({ where: base }),
      this.prisma.liConversation.count({ where: { ...base, unreadCount: { gt: 0 } } }),
      this.prisma.liConversation.count({ where: { ...base, needsReply: true } }),
      this.prisma.liConversation.count({ where: { ...base, needsReply: false } }),
    ]);
    return { all, unread, needsReply, replied };
  }

  async thread(conversationId: string) {
    const c = await this.prisma.liConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { sentAt: 'asc' } }, lead: { include: { aiFetches: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  async markRead(conversationId: string) {
    await this.assertExists(conversationId);
    return this.prisma.liConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  }

  async reply(conversationId: string, text: string, source: LiMessageSource = LiMessageSource.MANUAL) {
    const ctx = await this.loadSendContext(conversationId);
    const res = await this.provider.sendMessage({ accountId: ctx.accountId, memberId: ctx.memberId, text });
    await this.prisma.$transaction([
      this.prisma.liMessage.create({ data: { conversationId, direction: LiMessageDirection.OUTBOUND, source, body: text, unipileMessageId: res.messageId || null } }),
      this.prisma.liConversation.update({ where: { id: conversationId }, data: { needsReply: false, unreadCount: 0 } }),
    ]);
    return { ok: true, chatId: res.chatId };
  }

  /** AI Fetch — enrich + classify + draft. Debits 1 LinkedIn credit from the client's subscription. */
  async aiFetch(conversationId: string) {
    const c = await this.prisma.liConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { sentAt: 'asc' } }, lead: { include: { campaign: { select: { tenantId: true, clientId: true, businessProfile: true, strategy: true } } } } },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    const { tenantId, clientId } = c.lead.campaign;

    const sub = await this.subs.getOrCreate(tenantId, clientId);
    if (sub.creditsBalance < 1) throw new BadRequestException('Insufficient LinkedIn credits');

    const result = this.ai.configured ? await this.aiClassifyAndDraft(c) : this.fallbackClassifyAndDraft(c);

    const fetch = await this.prisma.liAiFetch.create({
      data: {
        leadId: c.leadId, intent: result.intent, sentiment: result.sentiment, draftReply: result.draftReply,
        enrichment: { title: c.lead.title, company: c.lead.company, location: c.lead.location } as Prisma.InputJsonValue,
        creditCost: 1,
      },
    });
    try {
      await this.subs.debit(tenantId, clientId, 1, LiCreditReason.AI_FETCH, { refType: 'LiAiFetch', refId: fetch.id });
    } catch (e) {
      await this.prisma.liAiFetch.delete({ where: { id: fetch.id } }).catch(() => undefined);
      throw e;
    }
    await this.prisma.liLead.update({ where: { id: c.leadId }, data: { sentiment: result.sentiment, intent: result.intent } });
    return fetch;
  }

  // ── helpers ──────────────────────────────────────────────────────────
  private tabWhere(tab?: InboxTab): Prisma.LiConversationWhereInput {
    switch (tab) {
      case 'unread': return { unreadCount: { gt: 0 } };
      case 'needs_reply': return { needsReply: true };
      case 'replied': return { needsReply: false };
      default: return {};
    }
  }

  private async aiClassifyAndDraft(c: any): Promise<AiFetchResult> {
    const transcript = c.messages.map((m: any) => `${m.direction === 'INBOUND' ? 'THEM' : 'US'}: ${m.body}`).join('\n');
    const business = c.lead.campaign.businessProfile?.content ?? {};
    const strategy = c.lead.campaign.strategy?.content ?? {};
    const system = 'You classify a LinkedIn reply and draft a short, human response. Respond with ONLY JSON: { "sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE", "intent": string, "draftReply": string }.';
    const user = `CONTEXT business:\n${JSON.stringify(business)}\nstrategy:\n${JSON.stringify(strategy)}\n\nTHREAD:\n${transcript}\n\nClassify sentiment + a short intent label (e.g. "interested", "not_interested", "question", "referral", "out_of_office"), and draft a concise friendly reply that moves toward the goal. Under 80 words.`;
    try {
      const r = await this.ai.generateJson<AiFetchResult>(system, user);
      return { sentiment: (r.sentiment as LiSentiment) ?? LiSentiment.NEUTRAL, intent: r.intent ?? 'unknown', draftReply: r.draftReply ?? '' };
    } catch (e) {
      this.logger.warn(`AI Fetch failed, using fallback: ${(e as Error).message}`);
      return this.fallbackClassifyAndDraft(c);
    }
  }

  private fallbackClassifyAndDraft(c: any): AiFetchResult {
    const lastInbound = [...c.messages].reverse().find((m: any) => m.direction === 'INBOUND');
    const sentiment = lastInbound ? quickSentiment(lastInbound.body) : LiSentiment.NEUTRAL;
    const intent = sentiment === LiSentiment.POSITIVE ? 'interested' : sentiment === LiSentiment.NEGATIVE ? 'not_interested' : 'question';
    const name = c.lead.firstName ?? c.lead.fullName?.split(' ')[0] ?? 'there';
    const draftReply = sentiment === LiSentiment.POSITIVE
      ? `Great to hear, ${name}! Would a quick 15-min call this week work? Happy to share how we can help.`
      : sentiment === LiSentiment.NEGATIVE
      ? `No problem, ${name} — appreciate the reply. I'll leave you to it; feel free to reach out anytime.`
      : `Thanks for getting back, ${name}. Happy to share a quick example — would that be useful?`;
    return { sentiment, intent, draftReply };
  }

  private async loadSendContext(conversationId: string) {
    const c = await this.prisma.liConversation.findUnique({
      where: { id: conversationId },
      include: { lead: { include: { campaign: { include: { linkedInAccount: true } } } } },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    if (!c.lead.campaign.linkedInAccount) {
      throw new BadRequestException('This campaign has no LinkedIn account — attach one to reply');
    }
    const accountId = c.lead.campaign.linkedInAccount.unipileAccountId;
    if (!accountId) throw new BadRequestException('Account not connected');
    if (!c.lead.unipileMemberId) throw new BadRequestException('Lead has no resolved member id');
    return { accountId, memberId: c.lead.unipileMemberId };
  }

  private async assertExists(id: string) {
    const n = await this.prisma.liConversation.count({ where: { id } });
    if (!n) throw new NotFoundException('Conversation not found');
  }
}
