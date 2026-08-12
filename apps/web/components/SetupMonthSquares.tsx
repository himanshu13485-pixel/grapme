'use client';

// Little colored squares (1..N) for a client's monthly "Email arrangement" steps.
// Grey = not started · Orange = in progress · Green = finished.
type Status = 'NOT_STARTED' | 'STARTED' | 'FINISHED';
export interface MonthCell { i: number; status: Status }

const COLOR: Record<Status, string> = {
  NOT_STARTED: 'bg-slate-300',
  STARTED: 'bg-amber-500',
  FINISHED: 'bg-emerald-500',
};
const LABEL: Record<Status, string> = { NOT_STARTED: 'Not started', STARTED: 'In progress', FINISHED: 'Finished' };

/** Colour key for the month squares. */
export function SetupMonthLegend({ className = '' }: { className?: string }) {
  const items: [Status, string][] = [['NOT_STARTED', 'Not started'], ['STARTED', 'In progress'], ['FINISHED', 'Finished']];
  return (
    <div className={`flex flex-wrap items-center gap-3 text-[11px] text-slate-500 ${className}`}>
      <span className="font-medium text-slate-400">Email arrangement:</span>
      {items.map(([s, label]) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded ${COLOR[s]}`} />{label}
        </span>
      ))}
    </div>
  );
}

export function SetupMonthSquares({ months, className = '' }: { months?: MonthCell[]; className?: string }) {
  if (!months || months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a.i - b.i);
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Email arrangement</div>
      <div className="flex flex-wrap gap-1">
        {sorted.map((m) => (
          <span
            key={m.i}
            title={`Month ${m.i}: ${LABEL[m.status]}`}
            className={`grid h-5 w-5 place-items-center rounded text-[9px] font-semibold text-white ${COLOR[m.status]}`}
          >
            {m.i}
          </span>
        ))}
      </div>
    </div>
  );
}
