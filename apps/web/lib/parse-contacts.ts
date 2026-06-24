import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  [key: string]: string;
}

export interface ParseResult {
  headers: string[];
  rows: ParsedRow[];
}

export type FieldKey =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'country'
  | 'ignore';

export interface ContactRow {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  country?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads a CSV or XLSX file into headers + row objects. */
export async function parseFile(file: File): Promise<ParseResult> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: '' });
    const headers = json.length ? Object.keys(json[0]) : [];
    return { headers, rows: json };
  }
  // CSV / TSV
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) =>
        resolve({
          headers: res.meta.fields ?? [],
          rows: res.data,
        }),
      error: reject,
    });
  });
}

/** Parses raw pasted text where each line is an email (optionally name,email). */
export function parsePastedEmails(text: string): ContactRow[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => EMAIL_RE.test(s))
    .map((email) => ({ email: email.toLowerCase() }));
}

/** Best-effort auto-mapping of source headers to our contact fields. */
export function autoMap(headers: string[]): Record<string, FieldKey> {
  const map: Record<string, FieldKey> = {};
  for (const h of headers) {
    const n = h.toLowerCase().replace(/[\s_-]/g, '');
    if (/(email|e-?mail|mail)/.test(n)) map[h] = 'email';
    else if (/(firstname|fname|givenname|first)/.test(n)) map[h] = 'firstName';
    else if (/(lastname|lname|surname|last)/.test(n)) map[h] = 'lastName';
    else if (/(company|organi[sz]ation|org|business)/.test(n)) map[h] = 'company';
    else if (/(country|nation)/.test(n)) map[h] = 'country';
    else map[h] = 'ignore';
  }
  return map;
}

/** Applies the column mapping and returns clean contact rows + stats. */
export function buildContacts(
  rows: ParsedRow[],
  mapping: Record<string, FieldKey>,
): {
  contacts: ContactRow[];
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
} {
  const emailCol = Object.keys(mapping).find((k) => mapping[k] === 'email');
  const seen = new Set<string>();
  const contacts: ContactRow[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const row of rows) {
    const email = String(emailCol ? (row[emailCol] ?? '') : '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid++;
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    const c: ContactRow = { email };
    for (const [col, field] of Object.entries(mapping)) {
      if (field === 'ignore' || field === 'email') continue;
      const v = String(row[col] ?? '').trim();
      if (v) c[field] = v;
    }
    contacts.push(c);
  }

  return {
    contacts,
    total: rows.length,
    valid: contacts.length,
    invalid,
    duplicates,
  };
}
