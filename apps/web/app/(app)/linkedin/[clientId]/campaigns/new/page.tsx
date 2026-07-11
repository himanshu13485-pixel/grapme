'use client';

import { useParams, useRouter } from 'next/navigation';
import { LiRegularWizard } from '@/components/LiRegularWizard';

export default function NewLiCampaignPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const done = () => router.push(`/linkedin/${clientId}`);

  // AI Mode is hidden for now — focusing on Regular mode. Go straight to the
  // Regular wizard instead of the mode picker. To re-enable AI, restore the
  // mode-picker version below (and the `useState`, `Link`, `PageHeader`, `LiAiWizard` imports).
  return (
    <LiRegularWizard
      clientId={clientId}
      base="/linkedin"
      launchMode="resume"
      onBack={() => router.push(`/linkedin/${clientId}`)}
      onDone={done}
    />
  );

  /* ── Mode picker (Regular vs AI) — hidden while we focus on Regular mode ──
  const [mode, setMode] = useState<'REGULAR' | 'AI' | null>(null);

  if (mode === 'REGULAR') {
    return <LiRegularWizard clientId={clientId} base="/linkedin" launchMode="resume" onBack={() => setMode(null)} onDone={done} />;
  }
  if (mode === 'AI') {
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => setMode(null)} className="text-sm text-slate-500 hover:text-slate-800">← Change mode</button>
        <PageHeader title="New LinkedIn Campaign · AI Mode" subtitle="Let AI build the campaign from the client's business DNA." />
        <LiAiWizard clientId={clientId} base="/linkedin" launchMode="resume" onDone={done} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/linkedin/${clientId}`} className="text-sm text-slate-500 hover:text-slate-800">← Back to client</Link>
      <PageHeader title="New LinkedIn Campaign" subtitle="How do you want to create this campaign?" />
      <div className="grid gap-4 sm:grid-cols-2">
        <button onClick={() => setMode('REGULAR')} className="card p-6 text-left transition hover:border-brand-300">
          <div className="mb-2 text-2xl">📄</div>
          <div className="text-lg font-semibold text-slate-800">Regular Mode</div>
          <div className="text-sm text-slate-500">Define your target audience and messages manually.</div>
        </button>
        <button onClick={() => setMode('AI')} className="card p-6 text-left transition hover:border-brand-300">
          <div className="mb-2 text-2xl">✦</div>
          <div className="text-lg font-semibold text-slate-800">AI Mode</div>
          <div className="text-sm text-slate-500">Let AI define your campaign from your business DNA.</div>
        </button>
      </div>
    </div>
  );
  */
}
