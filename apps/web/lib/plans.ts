'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface Plan {
  id: string;
  name: string;
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
