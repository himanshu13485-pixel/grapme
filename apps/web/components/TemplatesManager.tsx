'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/auth';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  subject: string;
  bodyHtml?: string;
  variables: string[];
  client?: { id: string; name: string };
}

const VARS = ['first_name', 'last_name', 'company', 'country', 'email'];

const SAMPLE: Record<string, string> = {
  first_name: 'Priya',
  last_name: 'Sharma',
  name: 'Priya',
  company: 'Acme Exports',
  country: 'India',
  email: 'priya@acme.com',
};

function renderPreview(html: string): string {
  return (html ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => SAMPLE[k] ?? `{{${k}}}`);
}

/**
 * Template manager + advanced editor (Visual WYSIWYG + HTML source). Standalone
 * on /templates, or scoped to one client inside the Clients Workspace.
 */
export function TemplatesManager({ clientId }: { clientId?: string }) {
  const canDelete = useCanDelete();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const paged = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function load() {
    const q = clientId ? `?clientId=${clientId}` : '';
    api.get<Template[]>(`/templates${q}`).then(setTemplates).catch(() => {});
  }
  useEffect(load, [clientId]);

  async function deleteTemplate(t: Template) {
    if (
      !confirm(
        `Delete the template "${t.name}"? Any sequence/campaign using it will be unassigned.`,
      )
    )
      return;
    try {
      await api.del(`/templates/${t.id}`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }

  return (
    <div>
      {!clientId && (
        <PageHeader
          title="Email templates"
          subtitle="Visual editor + HTML source, merge variables, live preview"
          action={
            <button className="btn-primary" onClick={() => setEditing('new')}>
              + New template
            </button>
          }
        />
      )}
      {clientId && !editing && (
        <div className="mb-4">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + New template
          </button>
        </div>
      )}

      {editing ? (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          clientId={clientId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : templates.length === 0 ? (
        <EmptyState message="No templates yet. Create one with the editor." />
      ) : (
        <>
        <div className="mb-3 text-sm text-slate-400">{templates.length} template{templates.length === 1 ? '' : 's'}</div>
        <div className="card divide-y divide-slate-100">
          {paged.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  {!clientId && t.client?.name && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                      {t.client.name}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-slate-500">{t.subject}</div>
              </div>
              <div className="whitespace-nowrap">
                <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>
                  Edit
                </button>
                {canDelete && (
                  <button
                    className="btn-ghost text-xs text-rose-600"
                    onClick={() => deleteTemplate(t)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={templates.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

interface SpamResult {
  score: number;
  spamTriggerWords: string[];
  linkCount: number;
  hasUnsubscribe: boolean;
  advice: string;
}

function TemplateEditor({
  template,
  clientId,
  onClose,
  onSaved,
}: {
  template: Template | null;
  clientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(
    template?.subject ?? 'Quick question, {{first_name}}',
  );
  const [bodyHtml, setBodyHtml] = useState(
    template?.bodyHtml ??
      '<p>Hi {{first_name}},</p><p>I noticed {{company}} and wanted to reach out.</p><p>Best,<br/>The team</p>',
  );
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [spam, setSpam] = useState<SpamResult | null>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Load HTML into the visual editor whenever we (re)enter visual mode. We do
  // NOT re-set it on every keystroke, so the caret position is preserved.
  useEffect(() => {
    if (mode === 'visual' && visualRef.current) {
      visualRef.current.innerHTML = bodyHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function syncFromVisual() {
    if (visualRef.current) setBodyHtml(visualRef.current.innerHTML);
  }

  // ── HTML-source insert (wrap selection in the textarea) ──
  function wrapHtml(before: string, after = '') {
    const ta = bodyRef.current;
    if (!ta) return setBodyHtml(bodyHtml + before + after);
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = bodyHtml.slice(s, e);
    const next = bodyHtml.slice(0, s) + before + sel + after + bodyHtml.slice(e);
    setBodyHtml(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
    });
  }

  // ── Visual (WYSIWYG) commands ──
  function execCmd(cmd: string, val?: string) {
    visualRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncFromVisual();
  }
  function insertHtmlVisual(html: string) {
    visualRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    syncFromVisual();
  }

  // ── Mode-aware toolbar actions ──
  const visual = mode === 'visual';
  const bold = () => (visual ? execCmd('bold') : wrapHtml('<strong>', '</strong>'));
  const italic = () => (visual ? execCmd('italic') : wrapHtml('<em>', '</em>'));
  const underline = () => (visual ? execCmd('underline') : wrapHtml('<u>', '</u>'));
  const heading = () => (visual ? execCmd('formatBlock', 'h2') : wrapHtml('<h2>', '</h2>'));
  const bullets = () => (visual ? execCmd('insertUnorderedList') : wrapHtml('<ul>\n  <li>', '</li>\n</ul>'));
  function link() {
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    visual ? execCmd('createLink', url) : wrapHtml(`<a href="${url}">`, '</a>');
  }
  function button() {
    const url = window.prompt('Button URL', 'https://') ?? 'https://';
    const html = `<a href="${url}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Click here</a>`;
    visual ? insertHtmlVisual(html) : wrapHtml(html);
  }
  function image() {
    const url = window.prompt('Image URL', 'https://');
    if (!url) return;
    const html = `<img src="${url}" alt="" style="max-width:100%" />`;
    visual ? insertHtmlVisual(html) : wrapHtml(html);
  }
  const divider = () => (visual ? insertHtmlVisual('<hr />') : wrapHtml('<hr />'));
  const insertVar = (v: string) =>
    visual ? insertHtmlVisual(`{{${v}}}`) : wrapHtml(`{{${v}}}`);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = { name, subject, bodyHtml, clientId: clientId || undefined };
      if (template) await api.patch(`/templates/${template.id}`, payload);
      else await api.post('/templates', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  // Runs on the LIVE editor content (mirrors the server lint) so it works for
  // brand-new, unsaved templates too — no save required.
  function runSpamCheck() {
    setError('');
    const liveBody =
      mode === 'visual' && visualRef.current
        ? visualRef.current.innerHTML
        : bodyHtml;
    const haystack = `${subject} ${liveBody}`.toLowerCase();
    const triggers = ['free', 'guarantee', 'act now', 'winner', '100%', '$$$'];
    const hits = triggers.filter((t) => haystack.includes(t));
    const linkCount = (liveBody.match(/href=/gi) ?? []).length;
    const hasUnsub = /unsubscribe/i.test(liveBody);

    let score = 100;
    score -= hits.length * 8;
    if (linkCount > 5) score -= 15;
    if (!hasUnsub) score -= 20;

    setSpam({
      score: Math.max(0, score),
      spamTriggerWords: hits,
      linkCount,
      hasUnsubscribe: hasUnsub,
      advice: hasUnsub
        ? 'Looks reasonable.'
        : 'Add an unsubscribe link (required for CAN-SPAM/GDPR compliance).',
    });
  }

  const tool = 'rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50';

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{template ? 'Edit template' : 'New template'}</h3>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          ← Back to list
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Subject *</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </div>
      </div>

      {/* Toolbar */}
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={tool} onClick={bold}><b>B</b></button>
          <button type="button" className={tool} onClick={italic}><i>I</i></button>
          <button type="button" className={tool} onClick={underline}><u>U</u></button>
          <button type="button" className={tool} onClick={heading}>H2</button>
          <button type="button" className={tool} onClick={bullets}>• List</button>
          <button type="button" className={tool} onClick={link}>Link</button>
          <button type="button" className={tool} onClick={button}>Button</button>
          <button type="button" className={tool} onClick={image}>Image</button>
          <button type="button" className={tool} onClick={divider}>Divider</button>
          <span className="mx-2 h-4 w-px bg-slate-200" />
          {/* Mode toggle */}
          <div className="inline-flex overflow-hidden rounded border border-slate-200">
            <button
              type="button"
              className={`px-2 py-1 text-xs ${visual ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}
              onClick={() => setMode('visual')}
            >
              Visual
            </button>
            <button
              type="button"
              className={`px-2 py-1 text-xs ${!visual ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'}`}
              onClick={() => {
                syncFromVisual();
                setMode('html');
              }}
            >
              HTML
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-slate-500">Variables:</span>
          {VARS.map((v) => (
            <button key={v} type="button" className={tool} onClick={() => insertVar(v)}>
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      </div>

      {/* Editor + live preview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className="label">{visual ? 'Visual editor' : 'HTML body'}</label>
          {visual ? (
            <div
              ref={visualRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncFromVisual}
              className="h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          ) : (
            <textarea
              ref={bodyRef}
              className="input h-72 font-mono text-xs"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              required
            />
          )}
        </div>
        <div>
          <label className="label">Live preview (sample data)</label>
          <div className="h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
              {renderPreview(subject)}
            </div>
            <div
              className="max-w-none text-sm text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderPreview(bodyHtml) }}
            />
          </div>
        </div>
      </div>

      {spam && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="font-medium">
            Deliverability score:{' '}
            <span className={spam.score >= 80 ? 'text-emerald-600' : 'text-amber-600'}>
              {spam.score}/100
            </span>
          </div>
          <div className="mt-1 text-slate-500">
            Links: {spam.linkCount} · Unsubscribe: {spam.hasUnsubscribe ? 'yes' : 'no'}
            {spam.spamTriggerWords.length > 0 && ` · Spam words: ${spam.spamTriggerWords.join(', ')}`}
          </div>
          <div className="mt-1 text-slate-600">{spam.advice}</div>
        </div>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={runSpamCheck}>
          Spam check
        </button>
        <button className="btn-primary flex-1" disabled={busy}>
          {busy ? 'Saving…' : template ? 'Save changes' : 'Create template'}
        </button>
      </div>
    </form>
  );
}
