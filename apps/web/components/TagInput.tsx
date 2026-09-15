'use client';

import { KeyboardEvent, useState } from 'react';

/** Split "a, b ,, a" into ["a", "b"] — mirrors the API's canonical list shape. */
export function splitList(value?: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const item = raw.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
  }
  return out;
}

/**
 * A comma-separated list edited as chips: type a value and press comma or Enter to add
 * it, Backspace on an empty box removes the last one, and a pasted "a, b, c" becomes
 * three chips. The value in and out is the stored string ("a, b, c"), so forms and the
 * API keep working with a single text field.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Highlight as a failed required field. */
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const items = splitList(value);

  const commit = (text: string) => {
    const added = splitList(text);
    if (added.length === 0) return;
    onChange(splitList([...items, ...added].join(',')).join(', '));
    setDraft('');
  };
  const removeAt = (i: number) => onChange(items.filter((_, j) => j !== i).join(', '));

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault(); // Enter must not submit the surrounding form mid-entry
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && items.length) {
      removeAt(items.length - 1);
    }
  }

  return (
    <div
      className={`input flex min-h-[2.5rem] flex-wrap items-center gap-1.5 ${invalid ? 'border-rose-400 ring-1 ring-rose-200' : ''}`}
    >
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {item}
          <button
            type="button"
            className="text-slate-400 hover:text-rose-600"
            aria-label={`Remove ${item}`}
            onClick={() => removeAt(i)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
        value={draft}
        placeholder={items.length ? '' : placeholder}
        onChange={(e) => {
          // A paste containing commas becomes several chips at once.
          if (e.target.value.includes(',')) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
