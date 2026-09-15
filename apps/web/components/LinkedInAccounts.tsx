'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui';
import { LinkedInAccount, accountHealth, timeAgo } from '@/lib/linkedin';

/**
 * Shared LinkedIn "Accounts" (seats) UI used by both the client portal
 * (ClientLinkedIn) and the admin client page. The connect/remove/sync/poll logic
 * lives in `useLinkedInAccounts`; <LinkedInAccounts> is the presentational panel.
 *
 * The two surfaces differ only in a few flags:
 *  - client portal → mode="popup" (opens a popup-blocker-safe tab to Unipile).
 *  - admin page    → mode="modal" (shows a shareable hosted-auth link + Sync/Reconnect).
 * Routes are identical apart from a base prefix (`/linkedin/portal` vs `/linkedin`),
 * so the hook is parametrized by `base`.
 */

export type ConnectMode = 'popup' | 'modal';

export interface UseLinkedInAccounts {
  /** Route prefix the hook was built with, so rows can call seat-scoped endpoints. */
  base: string;
  accounts: LinkedInAccount[];
  loaded: boolean;
  connecting: boolean;
  /** popup mode: a tab was just opened to Unipile — show the "finish on LinkedIn" banner. */
  justOpened: boolean;
  /** modal mode: the shareable hosted-auth URL to display, or null. */
  connectUrl: string | null;
  dismissConnectUrl: () => void;
  reload: () => void;
  connect: () => void;
  remove: (id: string) => void;
  sync: (id: string) => void;
}

export function useLinkedInAccounts({
  base,
  clientId,
  mode,
}: {
  base: string;
  clientId: string;
  mode: ConnectMode;
}): UseLinkedInAccounts {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    api
      .get<LinkedInAccount[]>(`${base}/clients/${clientId}/linkedin-accounts`)
      .then(setAccounts)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [base, clientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // While a connection is in flight, poll quietly so a seat flips from
  // "Pending auth" → "Connected" as soon as the webhook lands — no manual refresh.
  const hasPending = accounts.some((a) => a.status === 'PENDING');
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [hasPending, reload]);

  // Clear the "just opened" banner timer on unmount.
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current); }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    // Popup mode: open the tab synchronously (inside the click) so popup blockers
    // allow it, then point it at the Unipile URL once we have it.
    const w = mode === 'popup' && typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
      const res = await api.post<{ accountId?: string; url?: string; pendingApproval?: boolean; message?: string }>(
        `${base}/clients/${clientId}/linkedin-accounts/connect`,
        { successRedirect: typeof window !== 'undefined' ? window.location.href : undefined },
      );
      if (res.pendingApproval) {
        // Client portal: connecting needs approval first; no LinkedIn login yet.
        if (w) w.close();
        alert(res.message ?? 'Sent for approval.');
        return;
      }
      reload(); // the PENDING seat row exists now — show it immediately
      if (res.url) {
        if (mode === 'popup') {
          if (w) w.location.href = res.url; // new tab → Unipile (returns to portal after auth)
          else window.location.href = res.url; // popup blocked → same-tab fallback
          setJustOpened(true);
          if (bannerTimer.current) clearTimeout(bannerTimer.current);
          bannerTimer.current = setTimeout(() => setJustOpened(false), 8000);
        } else {
          setConnectUrl(res.url); // admin: show a shareable link (row already PENDING)
        }
      } else if (w) {
        w.close();
      }
    } catch (e: any) {
      if (w) w.close();
      alert(e?.message ?? 'Could not start the connection');
    } finally {
      setConnecting(false);
    }
  }, [base, clientId, mode, reload]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm('Remove this LinkedIn account? Its campaigns are kept but paused — attach a new account to a campaign to resume it.')) return;
      try {
        await api.del(`${base}/linkedin-accounts/${id}`);
        reload();
      } catch (e: any) {
        alert(e?.message ?? 'Could not remove the account');
      }
    },
    [base, reload],
  );

  const sync = useCallback(
    async (id: string) => {
      try {
        await api.post(`${base}/linkedin-accounts/${id}/sync`);
        reload();
      } catch (e: any) {
        alert(e?.message ?? 'Could not sync the account');
      }
    },
    [base, reload],
  );

  const dismissConnectUrl = useCallback(() => {
    setConnectUrl(null);
    reload();
  }, [reload]);

  return { base, accounts, loaded, connecting, justOpened, connectUrl, dismissConnectUrl, reload, connect, remove, sync };
}

interface LinkedInAccountsProps {
  li: UseLinkedInAccounts;
  mode: ConnectMode;
  /** Plan seat limit — drives the labelled progress bar + "at limit" state. */
  seats?: number;
  /** Admin: show a per-row Sync button. */
  showSync?: boolean;
  /** Admin: offer Reconnect on accounts that need attention. */
  showReconnect?: boolean;
  /** Admin: allow removing CONNECTED accounts (clients can only remove pending/broken). */
  allowRemoveConnected?: boolean;
  /** Admin: show the connected-count + "needs attention" banner in-panel. */
  showHealthSummary?: boolean;
}

export function LinkedInAccounts({
  li,
  mode,
  seats,
  showSync = false,
  showReconnect = false,
  allowRemoveConnected = false,
  showHealthSummary = false,
}: LinkedInAccountsProps) {
  const { base, accounts, loaded, connecting, justOpened, connectUrl, dismissConnectUrl, reload, connect, remove, sync } = li;
  const atLimit = seats != null && accounts.length >= seats;
  const seatPct = seats ? Math.min(100, Math.round((accounts.length / seats) * 100)) : 0;
  const connected = accounts.filter((a) => a.status === 'CONNECTED').length;
  const attention = accounts.filter((a) => accountHealth(a.status, a.deactivated).attention).length;

  const ConnectButton = ({ className = 'btn-primary' }: { className?: string }) => (
    <button
      className={className}
      disabled={connecting || atLimit}
      onClick={connect}
      title={atLimit ? 'Seat limit reached — increase seats to add accounts' : undefined}
    >
      {connecting ? (
        <span className="inline-flex items-center gap-2">
          <Spinner /> Starting…
        </span>
      ) : (
        '+ Connect Account'
      )}
    </button>
  );

  return (
    <div>
      {/* Seat usage + connect */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-700">
              {accounts.length}
              {seats != null ? ` of ${seats}` : ''} seat{accounts.length === 1 ? '' : 's'} used
            </span>
            {atLimit && <span className="text-xs font-medium text-rose-600">· Limit reached</span>}
            {showHealthSummary && connected > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {connected} connected
              </span>
            )}
          </div>
          {seats != null && seats > 0 && (
            <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${atLimit ? 'bg-rose-500' : 'bg-brand-gradient'}`}
                style={{ width: `${seatPct}%` }}
              />
            </div>
          )}
        </div>
        {accounts.length > 0 && <ConnectButton />}
      </div>

      {justOpened && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-brand-100 bg-brand-50/70 px-3.5 py-2.5 text-sm text-brand-700">
          <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-500" />
          <span>
            A new tab opened to finish logging in on LinkedIn. This page updates automatically once it&apos;s
            connected — no need to refresh.
          </span>
        </div>
      )}

      {showHealthSummary && loaded && attention > 0 && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          ⚠ {attention} account{attention === 1 ? '' : 's'} need{attention === 1 ? 's' : ''} attention — reconnect to
          resume sending. Sends pause for any account that isn&apos;t connected.
        </div>
      )}

      {!loaded ? (
        <AccountsSkeleton />
      ) : accounts.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-2xl">🔗</div>
          <div>
            <div className="font-medium text-slate-700">No LinkedIn accounts connected yet</div>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Connect a LinkedIn profile to start sending outreach campaigns from it.
            </p>
          </div>
          <div className="mt-1">
            <ConnectButton />
          </div>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {accounts.map((a) => {
            const h = accountHealth(a.status, a.deactivated);
            const pending = a.status === 'PENDING';
            const canRemove = allowRemoveConnected || a.status !== 'CONNECTED';
            return (
              <div
                key={a.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/60 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <img
                      src={a.avatarUrl || 'https://placehold.co/40x40/ede9fe/6d28d9?text=in'}
                      alt=""
                      className="h-10 w-10 rounded-full bg-brand-50 object-cover ring-1 ring-slate-100"
                    />
                    {pending && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-white bg-amber-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{a.fullName ?? 'Pending connection…'}</div>
                    <div className="line-clamp-1 text-xs text-slate-500">
                      {a.headline ?? (a.status === 'CONNECTED' ? 'LinkedIn account' : 'Awaiting LinkedIn auth')}
                      {a.connectionsCount != null && ` · ${a.connectionsCount} connections`}
                      {a.status === 'CONNECTED' && ` · synced ${timeAgo(a.lastSyncedAt)}`}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium ${h.text}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${h.dot}`} />
                    {h.label}
                  </span>
                  {showSync && <SeatRegion base={base} account={a} onSaved={reload} />}
                  {showSync && (
                    <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => sync(a.id)}>
                      Sync
                    </button>
                  )}
                  {showReconnect && h.attention && (
                    <button className="text-sm text-brand-600 hover:text-brand-800" onClick={connect}>
                      Reconnect
                    </button>
                  )}
                  {canRemove && (
                    <button className="text-sm text-rose-500 hover:text-rose-700" onClick={() => remove(a.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {mode === 'modal' && connectUrl && <ConnectLinkModal url={connectUrl} onClose={dismissConnectUrl} />}
    </div>
  );
}

/**
 * Which country a seat's traffic appears to come from.
 *
 * Left unset, the provider assigns an IP near whoever completed the LinkedIn login —
 * usually us, not the client. LinkedIn weighs login location, so a seat that suddenly
 * appears from another country collects checkpoints no matter how gently it sends.
 * Admin-only: the client portal must not expose infrastructure settings.
 */
function SeatRegion({
  base,
  account,
  onSaved,
}: {
  base: string;
  account: LinkedInAccount;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.proxyCountry ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const country = value.trim().toUpperCase();
    if (country && country.length !== 2) return; // ISO 3166-1 alpha-2 only
    setBusy(true);
    try {
      await api.post(`${base}/linkedin-accounts/${account.id}/proxy`, country ? { country } : {});
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        className="text-sm text-slate-500 hover:text-slate-800"
        title={
          account.proxyCountry
            ? `Traffic routed via ${account.proxyCountry}${account.proxyAppliedAt ? '' : ' (not yet applied)'}`
            : 'Region not set — the provider picks an IP near whoever logged in'
        }
        onClick={() => setEditing(true)}
      >
        {account.proxyCountry ?? 'Region'}
        {account.proxyCountry && !account.proxyAppliedAt && (
          <span className="ml-1 text-amber-500" title="Saved but not yet applied">•</span>
        )}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={value}
        maxLength={2}
        placeholder="IN"
        className="w-12 rounded border border-slate-200 px-1.5 py-0.5 text-sm uppercase"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
      />
      <button className="text-sm text-brand-600 hover:text-brand-800" disabled={busy} onClick={() => void save()}>
        Save
      </button>
      <button className="text-sm text-slate-400 hover:text-slate-600" onClick={() => setEditing(false)}>
        ✕
      </button>
    </span>
  );
}

/** Placeholder rows shown while the first accounts fetch is in flight — avoids an
 *  empty-state flash before the real (possibly non-empty) list arrives. */
function AccountsSkeleton() {
  return (
    <div className="card divide-y divide-slate-100">
      {[0, 1].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 p-4">
          <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="h-2.5 w-48 rounded bg-slate-100" />
          </div>
          <div className="h-5 w-20 shrink-0 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/** Shareable Unipile hosted-auth link (admin). Send it to the client, or open it yourself. */
function ConnectLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can select the field manually */
    }
  }
  return (
    <Modal open onClose={onClose} title="Connect a LinkedIn account" wide disableBackdropClose>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Whoever opens this link logs into the <strong>LinkedIn account to connect</strong> on Unipile&apos;s secure
          page (we never see the password). Send it to the client, or open it yourself if you have their login. The link
          expires in about <strong>60 minutes</strong>.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="input flex-1 font-mono text-xs"
          />
          <button className="btn-ghost whitespace-nowrap" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Once they finish, the account appears as <strong>Connected</strong> automatically. If it still shows
          “Pending”, click <strong>Sync</strong> on the account row.
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Done
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="btn-primary">
            Open now →
          </a>
        </div>
      </div>
    </Modal>
  );
}
