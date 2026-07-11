'use client';

import { useState } from 'react';

export function LiTagInput({
  value, onChange, placeholder, suggestions = [],
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [text, setText] = useState('');
  const add = (v: string) => {
    const t = v.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  const remove = (t: string) => onChange(value.filter((v) => v !== t));
  const open = suggestions.filter((s) => !value.includes(s));

  return (
    <div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1 text-sm text-white">
              {t}
              <button type="button" onClick={() => remove(t)} className="text-white/80 hover:text-white">×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }}
      />
      {open.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {open.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:border-brand-300 hover:text-brand-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
