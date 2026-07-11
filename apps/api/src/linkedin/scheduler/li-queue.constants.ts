export enum LiJob {
  SendConnection = 'li_send_connection',
  CheckAcceptance = 'li_check_acceptance',
  SendMessage = 'li_send_message',
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
