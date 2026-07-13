export enum LiJob {
  SendConnection = 'li_send_connection',
  CheckAcceptance = 'li_check_acceptance',
  SendMessage = 'li_send_message',
  CompleteLead = 'li_complete_lead', // grace-window close: mark CAMPAIGN_COMPLETED if no reply
  DripSource = 'li_drip_source', // repeatable tick: auto-refill campaign audiences
}

export const DRIP_SCAN_MS = 60 * 60 * 1000; // sweep drip campaigns hourly

export interface LiJobData {
  scheduledActionId: string;
  leadId: string;
  stepOrder?: number;
}

export const FIRST_ACCEPTANCE_CHECK_MS = 6 * 60 * 60 * 1000; // +6h after invite
export const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // every 12h
export const MAX_ACCEPTANCE_CHECKS = 20; // ~10 days then give up

export const MIN_JITTER_MS = 20_000;
export const MAX_JITTER_MS = 90_000;

export function renderTemplate(
  body: string,
  lead: { firstName?: string | null; lastName?: string | null; company?: string | null; title?: string | null },
): string {
  return body
    .replace(/\{first_name\}/gi, lead.firstName ?? '')
    .replace(/\{last_name\}/gi, lead.lastName ?? '')
    .replace(/\{company\}/gi, lead.company ?? '')
    .replace(/\{title\}/gi, lead.title ?? '');
}

export function jitterMs(): number {
  return MIN_JITTER_MS + Math.floor(Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS));
}

/**
 * Pick one wording at random from a step's pool: the primary body/note plus any
 * alternate `variants`. Blank entries are ignored. Returns undefined when the pool
 * is empty. This is what makes outreach look human — the same string never repeats
 * to the whole audience.
 */
export function pickVariant(primary: string | null | undefined, variants?: string[] | null): string | undefined {
  const pool = [primary, ...(variants ?? [])]
    .map((t) => (t ?? '').trim())
    .filter((t) => t.length > 0);
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}
