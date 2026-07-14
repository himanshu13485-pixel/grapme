'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Lightweight rich-text editor (contentEditable + execCommand toolbar). Emits HTML
 * via onChange. The server sanitizes the HTML before storing, so this stays simple.
 *
 * Pass `onImageUpload` to enable an "Image" button that uploads a picked file and
 * inserts it inline (returns the image URL to embed).
 */
export function RichText({
  value,
  onChange,
  placeholder,
  minHeight = 130,
  onImageUpload,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  onImageUpload?: (file: File) => Promise<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Seed the editor once on mount (and when the value is externally reset to empty),
  // never on every keystroke — that would fight the caret position.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value === '']);

  const sync = () => onChange(ref.current?.innerHTML ?? '');
  const cmd = (c: string, val?: string) => {
    document.execCommand(c, false, val);
    ref.current?.focus();
    sync();
  };
  const addLink = () => {
    const url = window.prompt('Link URL (https://…):');
    if (url) cmd('createLink', /^https?:\/\//i.test(url) ? url : `https://${url}`);
  };
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImageUpload) return;
    setUploading(true);
    try {
      const url = await onImageUpload(file);
      ref.current?.focus();
      cmd('insertHTML', `<img src="${url}" alt="" style="max-width:100%;height:auto;border-radius:8px;" />`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-300 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1">
        <Btn label="Bold" onClick={() => cmd('bold')}><b>B</b></Btn>
        <Btn label="Italic" onClick={() => cmd('italic')}><i>I</i></Btn>
        <Btn label="Underline" onClick={() => cmd('underline')}><u>U</u></Btn>
        <span className="mx-1 w-px bg-slate-200" />
        <Btn label="Bulleted list" onClick={() => cmd('insertUnorderedList')}>• List</Btn>
        <Btn label="Numbered list" onClick={() => cmd('insertOrderedList')}>1. List</Btn>
        <Btn label="Add link" onClick={addLink}>🔗</Btn>
        {onImageUpload && (
          <Btn label="Insert image" onClick={() => fileRef.current?.click()}>
            {uploading ? '⏳' : '🖼'}
          </Btn>
        )}
        <Btn label="Clear formatting" onClick={() => cmd('removeFormat')}>✕</Btn>
      </div>
      {onImageUpload && (
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
      )}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className="prose-sm max-w-none px-3 py-2 text-sm leading-relaxed text-slate-800 focus:outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_a]:text-brand-600 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // preventDefault on mousedown keeps the editor selection while clicking the button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-0.5 text-sm text-slate-600 hover:bg-slate-200"
    >
      {children}
    </button>
  );
}
