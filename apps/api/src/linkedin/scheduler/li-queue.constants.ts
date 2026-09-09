export enum LiJob {
  SendConnection = 'li_send_connection',
  CheckAcceptance = 'li_check_acceptance',
  SendMessage = 'li_send_message',
  CompleteLead = 'li_complete_lead', // grace-window close: mark CAMPAIGN_COMPLETED if no reply
  DripSource = 'li_drip_source', // repeatable tick: auto-refill campaign audiences
  SyncSweep = 'li_sync_sweep', // repeatable tick: re-sync acceptance + messages for running campaigns
}

export const DRIP_SCAN_MS = 60 * 60 * 1000; // sweep drip campaigns hourly
// Re-sync every 3h, not every 30 min. The sweep touches every in-flight lead on a
// seat; at 30 min it was the single largest source of LinkedIn profile reads and is
// what triggered the "high volume of profile data" warning. Unipile's own guidance is
// to poll relations "a few times a day with randomly spaced intervals of several hours".
export const SYNC_SWEEP_MS = 3 * 60 * 60 * 1000;

export interface LiJobData {
  scheduledActionId: string;
  leadId: string;
  stepOrder?: number;
}

// Per-lead acceptance polling has been removed entirely, along with the constants that
// paced it. Each rung cost a profile read, so it scaled with the number of outstanding
// invites and drained the seat's daily profile budget. The 3-hourly sync sweep resolves
// acceptance for the whole seat from a single relations call instead.

/**
 * Decided invites needed before the acceptance guard may pause a campaign.
 *
 * Small samples lie: 4 ignored invites out of 5 is a 20% rate and means nothing. This
 * is the point where a rate below the threshold is a real signal about targeting.
 */
export const MIN_ACCEPTANCE_SAMPLE = 30;

/**
 * Stale-invite cleanup, per seat per sweep.
 *
 * A pile of ignored invites drags on account standing, but withdrawing hundreds in one
 * burst is itself the machine-like behaviour we're trying to avoid — so the backlog is
 * drained a slice at a time.
 */
export const MAX_WITHDRAWALS_PER_SWEEP = 15;
/** Extra days past connectionWindowDays before the sweep withdraws, so it never races
 *  the per-lead acceptance ladder to the same invite. */
export const WITHDRAW_GRACE_DAYS = 1;
/** Spacing between withdrawals so a cleanup run isn't a burst of identical calls. */
export const WITHDRAW_MIN_GAP_MS = 4_000;
export const WITHDRAW_MAX_GAP_MS = 15_000;

export const MIN_JITTER_MS = 20_000;
export const MAX_JITTER_MS = 90_000;

export function renderTemplate(
  body: string,
  lead: { firstName?: string | null; lastName?: string | null; company?: string | null; title?: string | null },
): string {
  return (body ?? '')
    // Tolerate the {{token}} form (and stray spaces). Without this the inner
    // {token} matches and the outer braces survive → the lead reads "Hi {Rahul},".
    .replace(/\{\{\s*(first_name|last_name|company|title)\s*\}\}/gi, '{$1}')
    .replace(/\{\s*first_name\s*\}/gi, lead.firstName ?? '')
    .replace(/\{\s*last_name\s*\}/gi, lead.lastName ?? '')
    .replace(/\{\s*company\s*\}/gi, lead.company ?? '')
    .replace(/\{\s*title\s*\}/gi, lead.title ?? '');
}

export function jitterMs(): number {
  return MIN_JITTER_MS + Math.floor(Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS));
}

// ── name hygiene: replace URL-slug placeholder names with the real profile name ──

/** LinkedIn vanity slug (lowercased, trailing hash id stripped) from a profile URL. */
export function profileSlug(url?: string | null): string | null {
  const m = (url ?? '').match(/\/in\/([^/?#]+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/-[a-z0-9]{6,}$/i, '').toLowerCase();
}

/**
 * Canonical profile URL for storage + duplicate detection:
 * `https://www.linkedin.com/in/<slug>` — lowercased, no scheme/host/case/trailing-slash
 * or query/hash differences. Keeps the FULL slug (incl. any trailing id) so distinct
 * people stay distinct. So `/in/x/`, `/in/x`, `http://…/in/x?foo` all collapse to one.
 */
export function normalizeProfileUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/in\/([^/?#]+)/i);
  if (!m) return url.trim() || null; // non-standard URL — keep as typed (trimmed)
  const raw = decodeURIComponent(m[1]);
  // LinkedIn internal member-id slugs (ACoAA…/ACwAA… — base64url, case-SENSITIVE) must
  // NOT be lowercased or the profile becomes unresolvable. Only vanity slugs (which are
  // case-insensitive) get lowercased for consistent de-dup.
  const slug = /^AC[a-zA-Z]AA/.test(raw) ? raw : raw.toLowerCase();
  return `https://www.linkedin.com/in/${slug}`;
}

/**
 * True if a stored name field looks derived from the URL slug (e.g. "sachdevahimanshu"
 * or "Sachdevahimanshu") rather than a real name — those must not be used in
 * `{first_name}` tokens. Empty is NOT a slug (handled separately).
 */
export function isSlugName(name?: string | null, url?: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  const norm = n.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slug = (profileSlug(url) ?? '').replace(/[^a-z0-9]/g, '');
  if (slug && norm === slug) return true; // the whole slug got stuffed into this field
  // A long, single, all-lowercase token with no space = a concatenated slug.
  return !/\s/.test(n) && n === n.toLowerCase() && n.replace(/[^a-z]/g, '').length > 12;
}

/** Split a full name into Title-cased {firstName,lastName}. */
export function splitName(full?: string | null): { firstName?: string; lastName?: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  const tc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return { firstName: tc(parts[0]), lastName: parts.length > 1 ? parts.slice(1).map(tc).join(' ') : undefined };
}

/**
 * Reconcile a lead's stored name with the real resolved profile. When the stored
 * name is slug-derived (or empty), take the real name/first/last from the member
 * (falling back to splitting the real full name); otherwise keep the stored values.
 */
export function reconcileName(
  stored: { fullName?: string | null; firstName?: string | null; lastName?: string | null; profileUrl?: string | null },
  member: { fullName?: string | null; firstName?: string | null; lastName?: string | null },
): { fullName: string; firstName?: string; lastName?: string } {
  const url = stored.profileUrl;
  const badFull = isSlugName(stored.fullName, url) || !stored.fullName;
  const badFirst = isSlugName(stored.firstName, url) || !stored.firstName;
  const realFull = (badFull && member.fullName) ? member.fullName : (stored.fullName || member.fullName || '');
  const s = splitName(member.fullName || stored.fullName);
  return {
    fullName: realFull,
    firstName: badFirst ? (member.firstName || s.firstName || stored.firstName || undefined) : (stored.firstName || member.firstName || undefined),
    lastName: badFirst ? (member.lastName || s.lastName || stored.lastName || undefined) : (stored.lastName || member.lastName || undefined),
  };
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
