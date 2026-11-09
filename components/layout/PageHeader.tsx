'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  backHref,
  action,
  accentColor,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: ReactNode;
  /** Hex color shown as a dot before the title (e.g. a category's color). */
  accentColor?: string;
}) {
  return (
    <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex items-center gap-2 border-b px-4 py-3 backdrop-blur">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Voltar"
          className="text-foreground hover:bg-card flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl"
        >
          ‹
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-foreground flex items-center gap-2 text-lg leading-tight font-semibold">
          {accentColor && (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
          )}
          {/* Two lines rather than a cut-off word: a long name ("Reserva de emergência") does not
              fit next to a back arrow and two buttons on a phone. */}
          <span className="line-clamp-2">{title}</span>
        </h1>
        {subtitle && <p className="text-muted truncate text-sm">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
