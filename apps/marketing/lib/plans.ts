// Live membership plans, pulled from the app's public API for grapme.com/pricing.
// Fetched server-side (no CORS needed). Falls back gracefully to null so the
// pricing page can show its illustrative tiers if the API is unreachable.

// Server-side only. Prefer a runtime var (API_URL) over NEXT_PUBLIC_* — the
// latter is inlined at build time and can't be set per-deploy. In prod this
// points at the internal API service (e.g. http://api:4000/api/v1).
const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type PricingRow = {
  currency: string;
  monthlyPrice: number;
  monthlyBest: number;
  yearlyPrice: number;
  yearlyBest: number;
};

export type YearlyEntitlements = Partial<{
  emailCredits: number;
  linkedInCredits: number;
  mailboxLimit: number;
  seatLimit: number;
  emailCampaignLimit: number;
  linkedInCampaignLimit: number;
  validityDays: number;
}>;

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
  yearlyEntitlements: YearlyEntitlements | null;
  cardStyle: string; // "entitlements" | "features"
  features: string[];
  popular: boolean;
};

export async function fetchPublicPlans(): Promise<PublicPlan[] | null> {
  try {
    const res = await fetch(`${API_URL}/plans/public`, {
      // Tagged so an admin plan change can revalidate on demand (see /api/revalidate);
      // the 2-min window is just a fallback if the webhook is missed.
      next: { revalidate: 120, tags: ['public-plans'] },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublicPlan[];
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

