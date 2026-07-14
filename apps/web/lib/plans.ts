'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface PlanPrice {
  currency: string;
  monthlyPrice: number;
  monthlyBest: number;
  yearlyPrice: number;
  yearlyBest: number;
}

export interface PlanEntitlements {
  emailCredits?: number;
  linkedInCredits?: number;
  mailboxLimit?: number;
  seatLimit?: number;
  emailCampaignLimit?: number;
  linkedInCampaignLimit?: number;
  validityDays?: number;
}

export interface Plan {
  id: string;
  name: string;
  color: string;
  sortOrder?: number;
  pricing?: PlanPrice[] | null;
  emailEnabled?: boolean;
  linkedInEnabled?: boolean;
  validityDays?: number | null;
  emailCredits?: number;
  linkedInCredits?: number;
  mailboxLimit?: number;
  seatLimit?: number;
  emailCampaignLimit?: number;
  linkedInCampaignLimit?: number;
  // Optional yearly overrides for the entitlements above (base = monthly).
  yearlyEntitlements?: PlanEntitlements | null;
  // "entitlements" (default) shows the credits/mailboxes/seats/campaigns breakdown;
  // "features" shows a simple price + best price + a free-text feature list.
  cardStyle?: string;
  features?: string[] | null;
  popular?: boolean;
}

/**
 * Loads the tenant's plan names. Backing every plan picker/filter so a plan
 * added on the Plans page shows up everywhere (admin / sub-admin / client).
 */
export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<Plan[]>('/plans')
      .then(setPlans)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  return { plans, planNames: plans.map((p) => p.name), loading, reload };
}
