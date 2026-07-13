import { ReactNode } from 'react';

export function Badge({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-[13px] font-bold text-brand">
      {icon}
      {children}
    </span>
  );
}
