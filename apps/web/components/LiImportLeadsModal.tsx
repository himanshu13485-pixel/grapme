'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui';

type ParsedLead = { fullName: string; profileUrl?: string; company?: string; title?: string };

/** Turn a LinkedIn profile URL slug into a display name (real name arrives via enrichment at send). */
function slugToName(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/i);
  if (!m) return '';
  const slug = decodeURIComponent(m[1]).replace(/-[a-z0-9]{6,}$/i, '');
  return slug.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Parse pasted lines: a LinkedIn URL, optionally `, Name, Company, Title`. */
export function parseLeads(text: string): ParsedLead[] {
  const out: ParsedLead[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
    const url = parts.find((p) => /linkedin\.com\/in\//i.test(p));
    const rest = parts.filter((p) => p !== url);
    let fullName = rest[0] || (url ? slugToName(url) : line);
    if (!fullName) fullName = line;
    out.push({ fullName, profileUrl: url, company: rest[1] || undefined, title: rest[2] || undefined });
  }
  return out;
}

/** Import leads into a campaign by pasting LinkedIn profile URLs. `base` selects
 *  the admin ('/linkedin') or client-portal ('/linkedin/portal') API. */
export function LiImportLeadsModal({
  campaignId,
  base = '/linkedin',
  onClose,
  onImported,
}: {
  campaignId: string;
  base?: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = parseLeads(text);
  const withUrl = parsed.filter((l) => l.profileUrl).length;

  async function submit() {
    if (parsed.length === 0) { setError('Paste at least one LinkedIn profile URL.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<{ imported: number; skipped?: number; creditsCharged?: number }>(`${base}/campaigns/${campaignId}/leads`, { leads: parsed });
      alert(
        `Imported ${res.imported} lead${res.imported === 1 ? '' : 's'}.` +
        (res.skipped ? ` · ${res.skipped} already in the campaign (skipped).` : '') +
        (res.creditsCharged ? ` · ${res.creditsCharged} credit${res.creditsCharged === 1 ? '' : 's'} used.` : ''),
      );
      onImported();
    } catch (e: any) {
      setError(e.message ?? 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import leads" wide disableBackdropClose>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Paste one LinkedIn profile URL per line. Optionally add a name, company, and title after the URL,
          comma-separated. Names and companies are auto-enriched from LinkedIn when the campaign runs.
        </p>
        <textarea
          className="input h-56 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`https://www.linkedin.com/in/jane-doe\nhttps://www.linkedin.com/in/john-smith, John Smith, Acme Exports, Founder`}
        />
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{parsed.length} row{parsed.length === 1 ? '' : 's'} · {withUrl} with profile URL</span>
          {parsed.length > 0 && withUrl < parsed.length && (
            <span className="text-amber-600">Rows without a profile URL can&apos;t be contacted until a URL is added.</span>
          )}
        </div>
        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || parsed.length === 0}>
            {busy ? 'Importing…' : `Import ${parsed.length || ''} lead${parsed.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
