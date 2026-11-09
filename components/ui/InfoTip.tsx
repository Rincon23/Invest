'use client';

import { useId, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * A line with an ⓘ at its end that opens a longer explanation right below it. A screen keeps at
 * most one line of help in sight; the rest waits behind one of these until the person asks.
 */
export function InfoTip({
  children,
  hint,
  info,
  label = 'Por quê?',
}: {
  /** The line the ⓘ goes after (a field's name, a short sentence). */
  children: ReactNode;
  /** A short line that stays under it (examples, say), above the explanation when it opens. */
  hint?: ReactNode;
  info: ReactNode;
  /** What the ⓘ button says to a screen reader. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={id}
          aria-label={label}
          title={label}
          className={`-my-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            open ? 'text-primary' : 'text-muted hover:text-foreground'
          }`}
        >
          <Info aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {hint && <p className="text-muted text-sm">{hint}</p>}
      <p
        id={id}
        hidden={!open}
        className="bg-card text-muted mt-2 rounded-xl px-3 py-2.5 text-sm leading-snug shadow-sm"
      >
        {info}
      </p>
    </div>
  );
}
