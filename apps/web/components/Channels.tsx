/** Small badges showing which outreach channels a client is subscribed to. */
export function Channels({ email, linkedIn }: { email: boolean; linkedIn: boolean }) {
  return (
    <div className="flex gap-1">
      {email && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">Email</span>}
      {linkedIn && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">LinkedIn</span>}
      {!email && !linkedIn && <span className="text-xs text-slate-400">—</span>}
    </div>
  );
}
