export interface ValidityInfo {
  none: boolean;
  days?: number;
  expiry?: Date;
  remaining?: number; // whole days left (can be negative)
  expired: boolean;
}

export function validityInfo(
  days?: number | null,
  startAt?: string | null,
): ValidityInfo {
  if (!days || days <= 0) return { none: true, expired: false };
  if (!startAt) return { none: false, days, expired: false };
  const start = new Date(startAt).getTime();
  const expiry = new Date(start + days * 86_400_000);
  const remaining = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
  return { none: false, days, expiry, remaining, expired: remaining <= 0 };
}

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Compact validity chip for the client cockpit header. */
export function ValidityBadge({
  days,
  startAt,
}: {
  days?: number | null;
  startAt?: string | null;
}) {
  const v = validityInfo(days, startAt);
  if (v.none) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400">
        ⏳ No validity set
      </span>
    );
  }
  const tone = v.expired
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return (
    <span className={`inline-flex flex-col rounded-lg border px-3 py-1 text-xs font-medium ${tone}`}>
      <span className="font-semibold">⏳ Validity {v.days} days</span>
      {v.expiry && (
        <span className="text-[11px] font-normal opacity-80">
          {v.expired
            ? `Expired ${fmt(v.expiry)}`
            : `${v.remaining} days left · expires ${fmt(v.expiry)}`}
        </span>
      )}
    </span>
  );
}
