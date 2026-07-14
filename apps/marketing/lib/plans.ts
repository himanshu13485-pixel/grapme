// Live membership plans, pulled from the app's public API for grapme.com/pricing.
// Fetched server-side (no CORS needed). Falls back gracefully to null so the
// pricing page can show its illustrative tiers if the API is unreachable.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type PricingRow = {
  currency: string;
  monthlyPrice: number;
  monthlyBest: number;
  yearlyPrice: number;
  yearlyBest: number;
};

export type PublicPlan = {
  id: string;
  name: string;
  color: string;
  emailEnabled: boolean;
  linkedInEnabled: boolean;
  validityDays: number | null;
  emailCredits: number;
  linkedInCredits: number;
  mailboxLimit: number;
  seatLimit: number;
  emailCampaignLimit: number;
  linkedInCampaignLimit: number;
  pricing: PricingRow[];
};

export async function fetchPublicPlans(): Promise<PublicPlan[] | null> {
  try {
    const res = await fetch(`${API_URL}/plans/public`, {
      // Refresh at most every 5 minutes so plan edits show without a redeploy.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublicPlan[];
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** Pick the pricing row to display, preferring a stable order of common currencies. */
export function preferredPricing(plan: PublicPlan): PricingRow | null {
  if (plan.pricing.length === 0) return null;
  const order = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
  for (const c of order) {
    const row = plan.pricing.find((p) => p.currency === c);
    if (row) return row;
  }
  return plan.pricing[0];
}

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ',
};

export function formatMoney(amount: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${sym}${amount.toLocaleString('en-US')}`;
}

/** Human feature bullets for a plan card. */
export function planFeatures(plan: PublicPlan): string[] {
  const f: string[] = [];
  const channels = [
    plan.emailEnabled ? 'Email' : null,
    plan.linkedInEnabled ? 'LinkedIn' : null,
  ].filter(Boolean);
  if (channels.length) f.push(`${channels.join(' + ')} outreach`);
  if (plan.validityDays) f.push(`${plan.validityDays}-day validity`);
  const credits = plan.emailCredits + plan.linkedInCredits;
  if (credits > 0) f.push(`${credits.toLocaleString('en-US')} send credits`);
  if (plan.mailboxLimit > 0) f.push(`${plan.mailboxLimit} mailbox${plan.mailboxLimit === 1 ? '' : 'es'}`);
  if (plan.seatLimit > 0) f.push(`${plan.seatLimit} LinkedIn seat${plan.seatLimit === 1 ? '' : 's'}`);
  const campaigns = plan.emailCampaignLimit + plan.linkedInCampaignLimit;
  if (campaigns > 0) f.push(`${campaigns} concurrent campaign${campaigns === 1 ? '' : 's'}`);
  f.push('Approval-gated sending');
  return f;
}
