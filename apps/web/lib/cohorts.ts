/** How a cohort is named across the UI - must match the API's cohort-ref.util.
 *
 *  A month with one cohort stays "#3". Once a month holds several, each gets a
 *  letter: "#3A", "#3B", … (subIndex 0 = A), rolling to AA, AB, … past "Z".
 */
export function cohortRef(monthIndex: number, subIndex?: number | null): string {
  return `#${monthIndex}${subIndex == null ? '' : cohortLetter(subIndex)}`;
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA" (spreadsheet-column style). */
export function cohortLetter(subIndex: number): string {
  let n = Math.max(0, Math.trunc(subIndex));
  let out = '';
  for (;;) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    if (n < 26) return out;
    n = Math.floor(n / 26) - 1;
  }
}
