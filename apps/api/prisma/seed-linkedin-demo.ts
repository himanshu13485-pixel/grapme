/**
 * LinkedIn demo seed — attaches a fully-populated LinkedIn subscription + connected
 * account + campaign + ~25 leads (with replies) to an EXISTING aeo client, so the
 * LinkedIn UI (campaign detail, inbox) is clickable locally without Unipile/AI keys.
 *
 *   npm run db:seed:linkedin        (from repo root)
 *
 * Idempotent — safe to run repeatedly.
 */
import 'dotenv/config';
import {
  PrismaClient, LinkedInAccountStatus, LiCampaignStatus, LiCampaignType, LiCampaignMode,
  LiOutreachType, LiStepType, LiLeadStatus, LiSentiment, LiMessageDirection, LiMessageSource,
  LiKnowledgeKind, LiCreditReason,
} from '@prisma/client';

const prisma = new PrismaClient();

const FIRST = ['Ashish', 'Mohd', 'Anil', 'Kasim', 'Sonal', 'Rahul', 'Priya', 'Vikram', 'Neha', 'Arjun', 'Sameer', 'Divya', 'Karan', 'Meera', 'Rohit', 'Sneha', 'Amit', 'Pooja', 'Nikhil', 'Anjali', 'Rajesh', 'Kavya', 'Deepak', 'Ritu', 'Manish'];
const LAST = ['Bansal', 'Shariq', 'Vaniya', 'Akbani', 'Sahu', 'Karad', 'Gupta', 'Mehta', 'Rao', 'Nair', 'Ganatra', 'Shah', 'Singh', 'Patel', 'Kumar', 'Reddy', 'Jain', 'Verma', 'Bose', 'Iyer', 'Khanna', 'Menon', 'Chopra', 'Das', 'Gurnani'];
const TITLES = ['Founder', 'CEO', 'Managing Director', 'Export Manager', 'Owner', 'Co-Founder', 'Business Owner', 'Purchase Manager'];
const COMPANIES = ['Aksons Overseas', 'S.S Overseas', 'VAD Industries', 'Green International', 'Sahuji Global', 'Karad Agro', 'Kajar Exports', 'BALAJI EXIM', 'MV Global', 'SKY Foods', 'Aroma Ingredients', 'Netyex'];
const CITIES = ['Mumbai, India', 'Delhi, India', 'Bangalore, India', 'Pune, India', 'Ahmedabad, India', 'Chennai, India'];
const pick = <T,>(a: T[], i: number) => a[i % a.length];

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) { console.error('No tenant found — run the aeo seed first (start-dev.bat migrates + seeds).'); process.exit(1); }

  let client = await prisma.client.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } });
  if (!client) {
    client = await prisma.client.create({ data: { tenantId: tenant.id, name: 'Acme Exports (LinkedIn Demo)', status: 'active', plan: 'Growth' } });
    console.log(`Created demo client "${client.name}"`);
  }
  const tenantId = tenant.id, clientId = client.id;

  // Demo client is subscribed to BOTH outreach channels.
  await prisma.client.update({ where: { id: clientId }, data: { emailEnabled: true, linkedInEnabled: true } });

  if (await prisma.liCampaign.findFirst({ where: { clientId, name: 'Q3 Founders Outreach (Demo)' } })) {
    console.log(`Demo LinkedIn campaign already exists on client "${client.name}" — skipping.`);
    return;
  }

  // Subscription (separate LinkedIn billing) + credit ledger
  const sub = await prisma.linkedInSubscription.upsert({
    where: { clientId },
    create: { tenantId, clientId, planName: 'Growth Plus', seats: 2, creditsBalance: 500, validityDays: 180, validityStartAt: new Date(), whatsappEnabled: true, whatsappNumber: '+91 9810000000' },
    update: { creditsBalance: 500 },
  });
  await prisma.liCreditTransaction.create({ data: { subscriptionId: sub.id, amount: 500, reason: LiCreditReason.TOPUP, balanceAfter: 500, note: 'Demo credits' } });

  // Connected account (fake, so the wizard step 1 has an option)
  const account = await prisma.linkedInAccount.create({
    data: { tenantId, clientId, status: LinkedInAccountStatus.CONNECTED, unipileAccountId: `demo-${clientId.slice(0, 8)}`, fullName: 'Himanshu Sachdeva', headline: 'Founder @ Acme Exports | Helping exporters find global buyers', connectionsCount: 650, profileUrl: 'https://linkedin.com/in/demo' },
  });

  // AI-mode knowledge (partially filled)
  const business = await prisma.liKnowledgeProfile.create({
    data: { tenantId, clientId, kind: LiKnowledgeKind.BUSINESS, name: 'Acme Exports', slug: 'acme_exports', completeness: 29,
      content: { businessModel: 'B2B (Selling to other businesses)', industry: 'Manufacturing', coreProblemSolved: 'We connect Indian exporters with verified global buyers.', targetAudience: 'Export houses and manufacturers', companyStage: 'Growing' } },
  });
  const strategy = await prisma.liKnowledgeProfile.create({
    data: { tenantId, clientId, kind: LiKnowledgeKind.STRATEGY, parentId: business.id, name: 'B2B Founders', slug: 'b2b_founders', completeness: 21,
      content: { campaignPurpose: 'To find new clients/orders (Sales)', targetDepartment: 'Sales', painIfNoService: 'Wasted Money', firstCTA: '15-min Demo Call' } },
  });

  // Campaign (AI mode, paused) with sequence + audience
  const campaign = await prisma.liCampaign.create({
    data: {
      tenantId, clientId, linkedInAccountId: account.id, name: 'Q3 Founders Outreach (Demo)',
      type: LiCampaignType.AUTOMATIC, mode: LiCampaignMode.AI, outreachType: LiOutreachType.WITH_CONNECTION,
      status: LiCampaignStatus.PAUSED, dailyConnectionLimit: 20, dailyMessageLimit: 20,
      businessProfileId: business.id, strategyId: strategy.id,
      steps: { create: [
        { order: 1, type: LiStepType.CONNECTION_REQUEST, waitHours: 0, note: 'Hi {first_name}, would love to connect!' },
        { order: 2, type: LiStepType.MESSAGE, waitHours: 2, body: "Hi {first_name}, thanks for connecting. We help exporters like {company} reach verified global buyers." },
        { order: 3, type: LiStepType.MESSAGE, waitHours: 24, body: 'Just following up {first_name} — open to a quick chat this week?' },
      ] },
      audienceSpec: { create: { countries: ['India'], cities: ['Mumbai', 'Delhi'], industries: ['Export', 'Manufacturing'], companySizes: ['Small (11-50)', 'Medium (51-200)'], departments: ['Sales', 'Business Development'], jobTitles: ['Founder', 'Export Manager'], personKeywordsInclude: ['export'] } },
    },
  });

  const plan: { status: LiLeadStatus; step: number; sentiment?: LiSentiment }[] = [
    ...Array(6).fill({ status: LiLeadStatus.PENDING, step: 0 }),
    ...Array(5).fill({ status: LiLeadStatus.CONNECTION_PENDING, step: 1 }),
    ...Array(4).fill({ status: LiLeadStatus.CONNECTED, step: 1 }),
    ...Array(5).fill({ status: LiLeadStatus.MESSAGED, step: 2 }),
    { status: LiLeadStatus.REPLIED, step: 3, sentiment: LiSentiment.POSITIVE },
    { status: LiLeadStatus.REPLIED, step: 3, sentiment: LiSentiment.POSITIVE },
    { status: LiLeadStatus.REPLIED, step: 2, sentiment: LiSentiment.NEUTRAL },
    { status: LiLeadStatus.REPLIED, step: 3, sentiment: LiSentiment.NEUTRAL },
    { status: LiLeadStatus.REPLIED, step: 2, sentiment: LiSentiment.NEGATIVE },
  ];

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const first = pick(FIRST, i), last = pick(LAST, i);
    const lead = await prisma.liLead.create({
      data: {
        campaignId: campaign.id, fullName: `${first} ${last}`, firstName: first, lastName: last,
        title: pick(TITLES, i), company: pick(COMPANIES, i), location: pick(CITIES, i),
        profileUrl: `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`,
        unipileMemberId: `demo-member-${i}`, status: p.status, currentStep: p.step, sentiment: p.sentiment ?? null,
        connectedAt: p.step >= 1 && p.status !== LiLeadStatus.CONNECTION_PENDING ? new Date() : null,
        lastReplyAt: p.status === LiLeadStatus.REPLIED ? new Date(Date.now() - i * 36e5) : null,
      },
    });
    if (p.status === LiLeadStatus.REPLIED) {
      const convo = await prisma.liConversation.create({ data: { leadId: lead.id, unipileChatId: `demo-chat-${clientId.slice(0, 6)}-${i}`, unreadCount: 1, needsReply: true, lastReplyAt: new Date(Date.now() - i * 36e5) } });
      await prisma.liMessage.createMany({ data: [
        { conversationId: convo.id, direction: LiMessageDirection.OUTBOUND, source: LiMessageSource.AUTO, body: `Hi ${first}, thanks for connecting!` },
        { conversationId: convo.id, direction: LiMessageDirection.INBOUND, source: LiMessageSource.MANUAL, body: p.sentiment === LiSentiment.POSITIVE ? 'Sure, sounds interesting — happy to chat!' : p.sentiment === LiSentiment.NEGATIVE ? 'Not interested, please remove me.' : 'What exactly do you do?' },
      ] });
    }
  }

  console.log(`Seeded LinkedIn demo on client "${client.name}" (id ${clientId}):`);
  console.log(`  · subscription (2 seats, 500 credits), 1 connected account, AI campaign "Q3 Founders Outreach (Demo)" + 25 leads (5 replied).`);
  console.log(`  → In the panel: LinkedIn Outreach → ${client.name} → Campaigns / Inbox.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
