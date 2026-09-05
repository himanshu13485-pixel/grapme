import { ReactNode } from 'react';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  SCHEDULED: 'bg-sky-100 text-sky-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  PAUSED: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-slate-200 text-slate-600',
  DISABLED: 'bg-rose-100 text-rose-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  STOPPED: 'bg-rose-100 text-rose-700',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status}
    </span>
  );
}

/**
 * The product / category a client exports or imports, as a bubble — the same
 * shape as the salesperson bubble, so the two read as a pair. Renders nothing
 * when the client has no category set.
 */
export function CategoryBadge({
  category,
  compact = false,
  className = '',
}: {
  category?: string | null;
  /** Sits in a row of 11px pills (the workspace cards) rather than beside a heading. */
  compact?: boolean;
  className?: string;
}) {
  const label = category?.trim();
  if (!label) return null;
  const size = compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <span
      className={`inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-teal-50 font-medium text-teal-700 ${size} ${className}`}
      title={label}
    >
      <span aria-hidden>📦</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: string;
  /** Optional bubble shown beside the title, e.g. a client's product category. */
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="bg-gradient-to-r from-slate-900 via-brand-800 to-accent-700 bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="card flex items-center justify-center p-12 text-sm text-slate-400">
      {message}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  disableBackdropClose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** When set, a click on the dimmed background won't close the modal — use for
   *  data-entry forms so an accidental click doesn't discard typed values. */
  disableBackdropClose?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        className={`card my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shared pager: shows "X-Y of N" + Prev/Next. Renders nothing if it all fits. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const safe = Math.min(Math.max(1, page), pageCount);
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
      <span>
        Showing {(safe - 1) * pageSize + 1}–{Math.min(safe * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost px-3 py-1 disabled:opacity-40"
          disabled={safe <= 1}
          onClick={() => onPage(safe - 1)}
        >
          ← Prev
        </button>
        <span>
          Page {safe} / {pageCount}
        </span>
        <button
          className="btn-ghost px-3 py-1 disabled:opacity-40"
          disabled={safe >= pageCount}
          onClick={() => onPage(safe + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
            active === t.key
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
