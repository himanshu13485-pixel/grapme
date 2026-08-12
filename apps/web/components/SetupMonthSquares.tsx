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
