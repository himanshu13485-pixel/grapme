/**
 * LinkedIn caps the note on a connection invitation at 300 characters. Past
 * that the provider rejects the whole invitation — the lead is not invited at
 * all — so the limit is enforced when a sequence is saved, when the AI writes
 * one, and once more at send time for sequences saved before this existed.
 */
export const INVITE_NOTE_MAX = 300;

/** Trim a note to the limit at a word boundary. Blank notes stay undefined. */
export function clampInviteNote(note?: string | null): string | undefined {
  const text = (note ?? '').trim();
  if (!text) return undefined;
  if (text.length <= INVITE_NOTE_MAX) return text;
  const cut = text.slice(0, INVITE_NOTE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  // Cut back to the last word unless that would lose most of the note.
  return (lastSpace > INVITE_NOTE_MAX - 40 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
