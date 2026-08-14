'use client';

export interface Seen {
  userId: string;
  name: string;
  role: string;
  at: string;
}

const roleShort = (r: string) =>
  r === 'SUPER_ADMIN' ? 'Admin'
    : r === 'SUB_ADMIN' ? 'Sub-admin'
      : r === 'SALES' ? 'Sales'
        : r === 'CLIENT' ? 'Client'
          : 'Staff';

/** Read receipts under a message: who (of the people it was shared with) has
 *  seen it, for transparency. Names + roles on hover with the time seen. */
export function SeenBy({ seen, align = 'left' }: { seen?: Seen[]; align?: 'left' | 'right' }) {
  const cls = `mt-1 text-[10px] ${align === 'right' ? 'text-right' : ''}`;
  if (!seen || seen.length === 0) {
    return <div className={`${cls} text-slate-300`}>Not seen yet</div>;
  }
  const title = seen
    .map((s) => `${s.name} (${roleShort(s.role)}) — ${new Date(s.at).toLocaleString()}`)
    .join('\n');
  const names = seen.map((s) => s.name);
  const shown = names.slice(0, 3).join(', ');
  const extra = names.length > 3 ? ` +${names.length - 3} more` : '';
  return (
    <div className={`${cls} cursor-default text-slate-400`} title={title}>
      ✓✓ Seen by {shown}
      {extra}
    </div>
  );
}
