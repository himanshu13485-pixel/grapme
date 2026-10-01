/**
 * How long the note on a connection invitation may be.
 *
 * Two different limits bite here. Unipile's schema rejects anything over 300
 * characters before the request even leaves us. LinkedIn itself then applies
 * its own, lower limit — a seat without Premium answers `too_many_characters`
 * well before 300 — and in both cases the whole invitation fails, so the lead
 * is never invited at all.
 *
 * The default is therefore the conservative 200 that any seat accepts. A tenant
 * whose seats are all Premium can raise it with LINKEDIN_INVITE_NOTE_MAX (up to
 * the hard 300 Unipile allows). The provider also retries a rejected note at
 * SAFE_MAX, and finally with no note, so a long note can't cost a lead.
 */
export const INVITE_NOTE_HARD_MAX = 300;
export const INVITE_NOTE_SAFE_MAX = 200;

/** The configured limit, clamped to something sane. */
export function inviteNoteMax(): number {
  const raw = Number.parseInt(process.env.LINKEDIN_INVITE_NOTE_MAX ?? '', 10);
  if (!Number.isFinite(raw) || raw <= 0) return INVITE_NOTE_SAFE_MAX;
  return Math.min(raw, INVITE_NOTE_HARD_MAX);
}

/** Trim a note to `max` at a word boundary. Blank notes stay undefined. */
export function clampInviteNote(
  note?: string | null,
  max: number = inviteNoteMax(),
): string | undefined {
  const text = (note ?? '').trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Cut back to the last word unless that would lose most of the note.
  return (lastSpace > max - 40 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
