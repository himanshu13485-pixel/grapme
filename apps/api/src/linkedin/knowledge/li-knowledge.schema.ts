import { LiKnowledgeKind } from '@prisma/client';

export type KnowledgeFieldType = 'choice' | 'text';

export interface KnowledgeField {
  key: string;
  label: string;
  section: string;
  type: KnowledgeFieldType;
  question: string;
  options?: string[];
}

// ── Business Profile ("business DNA") — 4 sections, ~17 fields ──────────
export const BUSINESS_FIELDS: KnowledgeField[] = [
  { key: 'businessModel', label: 'Business Model', section: 'The Basics', type: 'choice',
    question: 'To get started, how would you classify your business model?',
    options: ['B2B (Selling to other businesses)', 'B2C (Selling to individual consumers)', 'D2C (Direct-to-Consumer brand)', 'Marketplace/Platform'] },
  { key: 'industry', label: 'Industry', section: 'The Basics', type: 'choice',
    question: 'What industry are you in?',
    options: ['SaaS / Technology', 'Financial Services', 'Healthcare', 'Manufacturing', 'Retail & E-commerce', 'Consulting', 'Marketing & Advertising'] },
  { key: 'coreProblemSolved', label: 'Core Problem Solved', section: 'The Basics', type: 'text',
    question: 'In a few sentences, what is the core problem your business solves for your customers?' },
  { key: 'targetAudience', label: 'Target Audience', section: 'The Basics', type: 'text',
    question: 'Who is your ideal customer? Describe the kind of person or company you serve best.' },
  { key: 'companyStage', label: 'Company Stage', section: 'Growth & Operations', type: 'choice',
    question: 'What stage is your company at?', options: ['Idea / Pre-launch', 'Early Startup', 'Growing', 'Established', 'Enterprise'] },
  { key: 'teamSize', label: 'Team Size', section: 'Growth & Operations', type: 'choice',
    question: 'How big is your team?', options: ['Just me', '2-10', '11-50', '51-200', '200+'] },
  { key: 'acquisitionChannels', label: 'Acquisition Channels', section: 'Growth & Operations', type: 'text',
    question: 'How do you currently get most of your customers?' },
  { key: 'techMaturity', label: 'Tech Maturity', section: 'Growth & Operations', type: 'choice',
    question: 'How tech-savvy is your typical customer?', options: ['Very technical', 'Somewhat technical', 'Non-technical'] },
  { key: 'magicWandFix', label: 'Magic Wand Fix', section: 'Pain & Goals', type: 'text',
    question: 'If you could wave a magic wand and fix one thing in your business, what would it be?' },
  { key: 'biggestBottleneck', label: 'Biggest Bottleneck', section: 'Pain & Goals', type: 'text',
    question: 'What is the biggest bottleneck holding your growth back right now?' },
  { key: 'sixMonthPriority', label: '6-Month Priority', section: 'Pain & Goals', type: 'text',
    question: 'What is your single most important priority for the next 6 months?' },
  { key: 'competitiveLandscape', label: 'Competitive Landscape', section: 'Pain & Goals', type: 'text',
    question: 'How would you describe the competition in your space?' },
  { key: 'keyCompetitor', label: 'Key Competitor', section: 'Pain & Goals', type: 'text',
    question: 'Who is your single biggest competitor?' },
  { key: 'competitorStrength', label: 'Competitor Strength', section: 'Pain & Goals', type: 'text',
    question: 'What does that competitor do better than you?' },
  { key: 'competitiveAdvantage', label: 'Competitive Advantage', section: 'Success & Future', type: 'text',
    question: 'What is the one thing you do better than anyone else?' },
  { key: 'successMetric', label: 'Success Metric', section: 'Success & Future', type: 'text',
    question: 'What single metric best defines success for your business?' },
  { key: 'threeYearVision', label: '3-Year Vision', section: 'Success & Future', type: 'text',
    question: 'Where do you want the business to be in 3 years?' },
];

// ── Campaign Strategy — 6 sections, ~14 fields ─────────────────────────
export const STRATEGY_FIELDS: KnowledgeField[] = [
  { key: 'campaignPurpose', label: 'Campaign Purpose', section: 'The Big Goal', type: 'choice',
    question: 'What is the main reason you want to start this LinkedIn campaign?',
    options: ['To find new clients/orders (Sales)', 'To find people to work for me (Hiring)', 'To find a partner or investor', 'To become famous in my industry (Brand Building)', 'To find a new job or project for myself'] },
  { key: 'successDefinition', label: 'Success Definition', section: 'The Big Goal', type: 'text',
    question: "In your own words, if this campaign is a 100% success after one month, what will happen? (e.g. 'I will have 5 meetings booked')" },
  { key: 'targetDepartment', label: 'Target Department', section: 'The Offer', type: 'choice',
    question: 'Which department usually handles the budget for what you sell?', options: ['Marketing', 'IT/Tech', 'Finance', 'Operations/HR'] },
  { key: 'painIfNoService', label: 'Pain If No Service', section: 'The Offer', type: 'choice',
    question: "What is the biggest 'loss' a client faces if they don't use your service?",
    options: ['Wasted Money', 'Slow Work/Manual Effort', 'Loss of Customers', 'Legal/Compliance Risk'] },
  { key: 'firstCTA', label: 'First CTA', section: 'The Offer', type: 'choice',
    question: "What is the first 'yes' we want from them?", options: ['15-min Demo Call', 'Free Audit/Trial', 'Reading a Case Study'] },
  { key: 'whyTheyShouldReply', label: 'Why They Should Reply', section: 'The Offer', type: 'text',
    question: 'Why should a busy prospect stop and reply to your message?' },
  { key: 'targetLocation', label: 'Target Location', section: 'Ideal Person', type: 'text',
    question: 'Which countries or cities should we focus on?' },
  { key: 'targetSeniority', label: 'Target Seniority', section: 'Ideal Person', type: 'choice',
    question: 'What seniority level are you targeting?', options: ['Founder/Owner', 'C-Suite', 'VP/Director', 'Manager', 'Individual Contributor'] },
  { key: 'bestClientExample', label: 'Best Client Example', section: 'Ideal Person', type: 'text',
    question: 'Think of your best client. What was their job title and what kind of company did they work for?' },
  { key: 'weeklyVolume', label: 'Weekly Volume', section: 'Campaign Limits', type: 'choice',
    question: 'How many new people should we reach out to per week?', options: ['Low (~25/week)', 'Medium (~50/week)', 'High (~100/week)'] },
  { key: 'biggestWin', label: 'Biggest Win', section: 'Social Proof', type: 'text',
    question: "What is the most impressive result you've delivered for a client?" },
  { key: 'referenceClient', label: 'Reference Client', section: 'Social Proof', type: 'text',
    question: 'Name a well-known client we can mention as social proof (optional).' },
  { key: 'contentLink', label: 'Content Link', section: 'Social Proof', type: 'text',
    question: 'Do you have a case study or content link we can share? (optional)' },
  { key: 'commonTraits', label: 'Common Traits', section: 'Target Understanding', type: 'text',
    question: 'What do your best prospects usually have in common?' },
  { key: 'specialRequirements', label: 'Special Requirements', section: 'Target Understanding', type: 'text',
    question: 'Any specific instructions or things to avoid in the messaging? (optional)' },
];

export function fieldsFor(kind: LiKnowledgeKind): KnowledgeField[] {
  return kind === LiKnowledgeKind.BUSINESS ? BUSINESS_FIELDS : STRATEGY_FIELDS;
}

export function computeCompleteness(kind: LiKnowledgeKind, content: Record<string, unknown>): number {
  const fields = fieldsFor(kind);
  const filled = fields.filter((f) => {
    const v = content?.[f.key];
    return v !== undefined && v !== null && String(v).trim() !== '';
  }).length;
  return Math.round((filled / fields.length) * 100);
}

export function nextField(kind: LiKnowledgeKind, content: Record<string, unknown>): KnowledgeField | null {
  return fieldsFor(kind).find((f) => {
    const v = content?.[f.key];
    return v === undefined || v === null || String(v).trim() === '';
  }) ?? null;
}
