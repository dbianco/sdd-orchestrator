import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command { id: string; label: string; hint: string; run: () => void }

/** Ctrl/⌘+K launcher: jump to a section, switch project, refresh or toggle the theme. */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); setQuery(''); setIndex(0); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  if (!open) return null;
  const run = (c: Command | undefined) => { if (c) { setOpen(false); c.run(); } };

  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input} value={query} placeholder="Jump to… (type to filter)" aria-label="Search commands"
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') run(shown[index]);
          }}
        />
        <ul role="listbox">
          {shown.length === 0 && <li aria-disabled="true"><span>No matches</span></li>}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
              <span>{c.label}</span><span>{c.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
