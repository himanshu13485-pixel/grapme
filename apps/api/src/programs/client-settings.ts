/**
 * Which client fields a client-portal user may touch, and how a requested
 * change is compared, described and applied.
 */

/** Plan, entitlements, validity, billing, channels and status — staff only. */
export const ADMIN_ONLY_CLIENT_FIELDS: readonly string[] = [
  'plan',
  'status',
  'validityDays',
  'emailCredits',
  'emailCreditMetering',
  'mailboxLimit',
  'emailCampaignLimit',
  'emailEnabled',
  'linkedInEnabled',
  'linkedInCreditMetering',
  'invoiceNo',
  'invoiceDate',
];

/** Operational settings a client can ask to change; applied on approval. */
export const CLIENT_REQUESTABLE_FIELDS: readonly string[] = [
  'name',
  'contactPerson',
  'email',
  'mobile',
  'productCategory',
  'serviceType',
  'operationContacts',
  'monthlyQuota',
  'dailyBatchSize',
  'batchWindowDays',
  'stageIntervalDays',
  'followUpCount',
  'weekdaysOnly',
  'workDays',
  'emailJitterSeconds',
  'autoCohortEnabled',
  'autoCohortListId',
  'autoCohortDay',
  'sendWindowStart',
  'sendWindowEnd',
  'stageIntervalJitterDays',
  'reportDaily',
  'reportWeekly',
  'reportMonthly',
  'reportHour',
];

export const CLIENT_FIELD_LABEL: Record<string, string> = {
  plan: 'Plan',
  status: 'Status',
  validityDays: 'Validity',
  emailCredits: 'Email credits',
  emailCreditMetering: 'Email credit metering',
  mailboxLimit: 'Mailbox limit',
  emailCampaignLimit: 'Email campaign limit',
  emailEnabled: 'Email channel',
  linkedInEnabled: 'LinkedIn channel',
  linkedInCreditMetering: 'LinkedIn credit metering',
  invoiceNo: 'Invoice number',
  invoiceDate: 'Invoice date',
  name: 'Workspace name',
  contactPerson: 'Contact person',
  email: 'Email',
  mobile: 'Mobile',
  productCategory: 'Product / category',
  serviceType: 'Service type',
  operationContacts: 'Operation contacts',
  monthlyQuota: 'Monthly quota',
  dailyBatchSize: 'Daily batch size',
  batchWindowDays: 'Batch window (days)',
  stageIntervalDays: 'Stage interval (days)',
  followUpCount: 'Follow-ups',
  weekdaysOnly: 'Weekdays only',
  workDays: 'Send days',
  emailJitterSeconds: 'Email jitter (seconds)',
  autoCohortEnabled: 'Automatic monthly cohort',
  autoCohortListId: 'Auto-cohort source list',
  autoCohortDay: 'Auto-cohort day of month',
  sendWindowStart: 'Send window start',
  sendWindowEnd: 'Send window end',
  stageIntervalJitterDays: 'Stage interval jitter (days)',
  reportDaily: 'Daily report',
  reportWeekly: 'Weekly report',
  reportMonthly: 'Monthly report',
  reportHour: 'Report hour',
};

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_FIELDS = ['sendWindowStart', 'sendWindowEnd', 'reportHour'];

/** Canonical form of a value so an unchanged field never reads as a change. */
export function normalizeClientValue(key: string, v: unknown): unknown {
  if (key === 'operationContacts' && Array.isArray(v)) {
    return v.map((o: { name?: string | null; email?: string }) => ({ name: o?.name ?? '', email: o?.email ?? '' }));
  }
  if (key === 'workDays' && Array.isArray(v)) {
    return [...v].map(Number).sort((a, b) => a - b);
  }
  return v;
}

/** The client's current value for a field, in the same form a request uses. */
export function currentClientValue(client: Record<string, unknown>, key: string): unknown {
  if (key === 'invoiceDate') {
    const d = client.invoiceDate as Date | string | null | undefined;
    return d ? new Date(d).toISOString().slice(0, 10) : null;
  }
  if (key === 'validityDays') return client.validityDays ?? 0;
  return normalizeClientValue(key, client[key]);
}

export function sameClientValue(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
  return JSON.stringify(n(a)) === JSON.stringify(n(b));
}

/** Human form of a value for the Approvals page. */
export function describeClientValue(
  key: string,
  v: unknown,
  listNames?: Map<string, string>,
): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (key === 'workDays' && Array.isArray(v)) return v.map((d) => DAY[Number(d)] ?? d).join(', ') || '—';
  if (key === 'operationContacts' && Array.isArray(v)) {
    return v.map((o: { email?: string }) => o?.email).filter(Boolean).join(', ') || '—';
  }
  if (key === 'autoCohortListId' && typeof v === 'string') return listNames?.get(v) ?? 'a list';
  if (HOUR_FIELDS.includes(key) && typeof v === 'number') return `${String(v).padStart(2, '0')}:00`;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * The client update for an approved settings request. Re-filters against the
 * allowlist so a stored payload can never carry a staff-only field.
 */
export function settingsUpdateData(
  changes: Record<string, { from: unknown; to: unknown }>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, change] of Object.entries(changes ?? {})) {
    if (ADMIN_ONLY_CLIENT_FIELDS.includes(key) || !CLIENT_REQUESTABLE_FIELDS.includes(key)) continue;
    const to = change?.to;
    if (key === 'name' && !to) continue; // a workspace always keeps a name
    data[key] = to === '' ? null : to;
  }
  return data;
}
