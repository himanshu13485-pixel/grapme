'use client';

import {
  useEffect,
  useRef,
  useState,
  FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import { api } from '@/lib/api';
import { useAuth, useCanDelete } from '@/lib/auth';
import { PageHeader, EmptyState, Pagination } from '@/components/ui';

/** AI template generation is for staff only — never the client portal. */
function useCanUseAi(): boolean {
  const { user } = useAuth();
  return user?.role === 'SUPER_ADMIN' || user?.role === 'SUB_ADMIN';
}

interface AiDraft { kind: string; name: string; subject: string; bodyHtml: string }

interface Template {
  id: string;
  name: string;
  subject: string;
  bodyHtml?: string;
  variables: string[];
  client?: { id: string; name: string };
  /** Only APPROVED templates are sent. Client-portal templates start PENDING. */
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote?: string | null;
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
  const { user } = useAuth();
  const isClient = user?.role === 'CLIENT';
  const canUseAi = useCanUseAi();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
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
            <div className="flex gap-2">
              {canUseAi && !editing && !aiOpen && (
                <button className="btn-ghost" onClick={() => setAiOpen(true)}>✨ Generate with AI</button>
              )}
              <button className="btn-primary" onClick={() => setEditing('new')}>
                + New template
              </button>
            </div>
          }
        />
      )}
      {clientId && !editing && !aiOpen && (
        <div className="mb-4 flex gap-2">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            + New template
          </button>
          {canUseAi && (
            <button className="btn-ghost" onClick={() => setAiOpen(true)}>✨ Generate with AI</button>
          )}
        </div>
      )}

      {aiOpen ? (
        <AiBatchPanel
          clientId={clientId}
          onClose={() => setAiOpen(false)}
          onSavedAny={load}
        />
      ) : editing ? (
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
        <div className="mb-3 text-sm text-slate-400">
          {templates.length} template{templates.length === 1 ? '' : 's'}
          {isClient && (
            <span className="ml-2 text-slate-500">
              · New templates and changes to a template&apos;s subject or body are reviewed by our team
              before they can be sent.
            </span>
          )}
        </div>
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
                  <TemplateStatusBadge status={t.status} />
                </div>
                <div className="mt-1 text-sm text-slate-500">{t.subject}</div>
                {t.status === 'REJECTED' && t.reviewNote && (
                  <div className="mt-1 text-xs text-rose-600">Reviewer: {t.reviewNote}</div>
                )}
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

/** Review state of a template. Approved is the normal state, so it shows nothing. */
function TemplateStatusBadge({ status }: { status?: Template['status'] }) {
  if (status === 'PENDING') {
    return (
      <span
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
        title="Waiting for an admin to approve it. It won't be sent until then."
      >
        Awaiting approval
      </span>
    );
  }
  if (status === 'REJECTED') {
    return (
      <span
        className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700"
        title="Not approved. Edit it and save to send it for review again."
      >
        Rejected
      </span>
    );
  }
  return null;
}

/** Batch template drafting with AI. Generates a set (optional initial + follow-up
 *  + N monthly variations); each draft is reviewed and saved explicitly. */
function AiBatchPanel({
  clientId,
  onClose,
  onSavedAny,
}: {
  clientId?: string;
  onClose: () => void;
  onSavedAny: () => void;
}) {
  const [form, setForm] = useState({
    context: '',
    clientName: '',
    tone: 'professional, warm, concise',
    monthlyCount: 11,
    includeInitial: true,
    includeFollowup: true,
    namePrefix: '',
  });
  const [drafts, setDrafts] = useState<AiDraft[] | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setError('');
    if (!form.context.trim()) { setError('Describe what the emails are about first.'); return; }
    setBusy(true);
    setDrafts(null);
    setSaved(new Set());
    try {
      const res = await api.post<{ templates: AiDraft[] }>('/ai/templates/generate', {
        context: form.context.trim(),
        clientName: form.clientName.trim() || undefined,
        tone: form.tone,
        monthlyCount: Number(form.monthlyCount) || 0,
        includeInitial: form.includeInitial,
        includeFollowup: form.includeFollowup,
        namePrefix: form.namePrefix.trim() || undefined,
      });
      setDrafts(res.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  function editDraft(i: number, patch: Partial<AiDraft>) {
    setDrafts((prev) => prev ? prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) : prev);
  }

  async function saveDraft(i: number) {
    const d = drafts?.[i];
    if (!d || saved.has(i)) return;
    try {
      await api.post('/templates', { name: d.name, subject: d.subject, bodyHtml: d.bodyHtml || '<p></p>', clientId: clientId || undefined });
      setSaved((prev) => new Set(prev).add(i));
      onSavedAny();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save this template');
    }
  }
  async function saveAll() {
    if (!drafts) return;
    for (let i = 0; i < drafts.length; i++) if (!saved.has(i)) await saveDraft(i);
  }

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">✨ Generate templates with AI</h3>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>← Back to list</button>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <label className="label">What are these emails about? *</label>
        <textarea
          className="input min-h-20"
          placeholder="e.g. Cold outreach to hardware & sanitaryware importers in the UK on behalf of a steel-fittings exporter. Friendly, no hard sell."
          value={form.context}
          onChange={(e) => set({ context: e.target.value })}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Client / company (optional)</label>
            <input className="input" value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} />
          </div>
          <div>
            <label className="label">Tone</label>
            <input className="input" value={form.tone} onChange={(e) => set({ tone: e.target.value })} />
          </div>
          <div>
            <label className="label">Name prefix (optional)</label>
            <input className="input" placeholder="e.g. BHAVYA STEEL-RFM-1" value={form.namePrefix} onChange={(e) => set({ namePrefix: e.target.value })} />
          </div>
          <div>
            <label className="label">Monthly variations</label>
            <input type="number" min={0} max={12} className="input" value={form.monthlyCount} onChange={(e) => set({ monthlyCount: Number(e.target.value) })} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeInitial} onChange={(e) => set({ includeInitial: e.target.checked })} /> Initial email</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.includeFollowup} onChange={(e) => set({ includeFollowup: e.target.checked })} /> Follow-up email</label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={busy} onClick={generate}>
            {busy ? 'Generating…' : 'Generate'}
          </button>
          <span className="text-xs text-slate-400">Uses your tenant OpenAI key · review each draft before saving.</span>
        </div>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>

      {drafts && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">{drafts.length} draft{drafts.length === 1 ? '' : 's'} · {saved.size} saved</div>
            <button type="button" className="btn-primary text-sm" onClick={saveAll} disabled={saved.size === drafts.length}>Save all</button>
          </div>
          {drafts.map((d, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase text-slate-500">{d.kind}</span>
                <input
                  className="input flex-1 text-sm"
                  value={d.name}
                  onChange={(e) => editDraft(i, { name: e.target.value })}
                  disabled={saved.has(i)}
                />
                {saved.has(i) ? (
                  <span className="text-xs font-medium text-emerald-600">✓ Saved</span>
                ) : (
                  <button type="button" className="btn-ghost text-xs text-brand-600" onClick={() => saveDraft(i)}>Save</button>
                )}
              </div>
              <div className="mt-2 text-sm font-medium text-slate-700">{renderPreview(d.subject)}</div>
              <div className="mt-1 max-h-40 overflow-auto rounded border border-slate-100 bg-slate-50/60 p-2 text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: renderPreview(d.bodyHtml) }} />
            </div>
          ))}
        </div>
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
  const [aiBusy, setAiBusy] = useState(false);
  const [spam, setSpam] = useState<SpamResult | null>(null);
  const canUseAi = useCanUseAi();
  const visualRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
  function insertImg(url: string, alt = '') {
    const safeAlt = alt.replace(/"/g, '&quot;');
    const html = `<img src="${url}" alt="${safeAlt}" style="max-width:100%;height:auto" />`;
    visual ? insertHtmlVisual(html) : wrapHtml(html);
  }
  function image() {
    const url = window.prompt('Image URL', 'https://');
    if (url) insertImg(url);
  }
  // Upload a file → hosted image URL → insert inline at the cursor.
  async function uploadImage(file: File, alt = '') {
    if (!file.type.startsWith('image/')) {
      setError('Only image files can be uploaded.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read the file'));
        r.readAsDataURL(file);
      });
      const res = await api.post<{ url: string }>('/assets', {
        filename: file.name,
        mimeType: file.type,
        dataBase64,
      });
      insertImg(res.url, alt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }
  // Paste an image straight from the clipboard into the editor.
  function handlePaste(e: ReactClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (file) {
      e.preventDefault();
      uploadImage(file);
    }
  }
  // Drag & drop an image file onto the editor.
  function handleDrop(e: ReactDragEvent) {
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith('image/'),
    );
    if (file) {
      e.preventDefault();
      uploadImage(file);
    }
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

  // AI: rewrite the current subject+body to reduce spam-filter risk, then load
  // the result back into the editor as an unsaved draft (you still hit Save).
  async function aiRewrite() {
    setError('');
    setAiBusy(true);
    const liveBody = mode === 'visual' && visualRef.current ? visualRef.current.innerHTML : bodyHtml;
    try {
      const res = await api.post<{ subject: string; bodyHtml: string }>('/ai/templates/rewrite', { subject, bodyHtml: liveBody });
      setSubject(res.subject || subject);
      setBodyHtml(res.bodyHtml || liveBody);
      if (mode === 'visual' && visualRef.current) visualRef.current.innerHTML = res.bodyHtml || liveBody;
      setSpam(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rewrite failed');
    } finally {
      setAiBusy(false);
    }
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
          <button
            type="button"
            className={tool}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : '🖼 Upload image'}
          </button>
          <button type="button" className={tool} onClick={image}>Image URL</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const alt =
                  window.prompt('Alt text (describe the image, optional):', '') ?? '';
                uploadImage(f, alt);
              }
              e.target.value = '';
            }}
          />
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
          <label className="label">
            {visual ? 'Visual editor' : 'HTML body'}
            <span className="ml-2 font-normal text-slate-400">
              — paste or drop an image to insert it
            </span>
          </label>
          {visual ? (
            <div
              ref={visualRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncFromVisual}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="h-72 overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          ) : (
            <textarea
              ref={bodyRef}
              className="input h-72 font-mono text-xs"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
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
        {canUseAi && (
          <button type="button" className="btn-ghost" onClick={aiRewrite} disabled={aiBusy} title="Rewrite the wording with AI to reduce spam-filter risk (keeps variables + meaning)">
            {aiBusy ? '✨ Rewriting…' : '✨ Rewrite to reduce spam'}
          </button>
        )}
        <button className="btn-primary flex-1" disabled={busy}>
          {busy ? 'Saving…' : template ? 'Save changes' : 'Create template'}
        </button>
      </div>
    </form>
  );
}
