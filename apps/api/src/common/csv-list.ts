/**
 * Comma-separated value lists stored in a single text column — invoice numbers and
 * product categories.
 *
 * Stored in one canonical shape ("a, b, c") so a value typed as "12345,67890 " and
 * one typed as "12345, 67890" are the same thing to filters, history diffs and the
 * tag inputs in the UI.
 */

/** Split a stored list into its trimmed, non-empty, de-duplicated items (case-insensitive). */
export function splitCsvList(value?: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Canonical stored form: "a, b, c". An empty list becomes '' (callers decide null vs ''). */
export function joinCsvList(items: string[]): string {
  return items.join(', ');
}

/** class-transformer hook: normalise a submitted list, leaving non-strings for validation to reject. */
export function normalizeCsvListInput({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? joinCsvList(splitCsvList(value)) : value;
}
