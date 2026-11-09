'use client';

import { Component, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ModuleKey } from '@/lib/budget';
import { moduleDefinition } from '@/lib/modules';
import { IconTile } from '@/components/ui/IconTile';
import { MODULE_VISUALS } from '../visuals';

const FRAME = 'border-border bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition';
const LINKED = 'hover:border-primary/40 active:scale-[0.99]';

/** A card that takes the whole width: icon and name on top, then whatever the module shows. */
export function HomeCard({
  module,
  href,
  title,
  action,
  children,
}: {
  module: ModuleKey;
  /** The module's screen; the whole card opens it. */
  href?: string;
  title?: string;
  /** A button at the foot of the card, in the frame but out of the link (a link cannot hold one). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const visual = MODULE_VISUALS[module];
  const content = (
    <>
      <div className="flex items-center gap-3">
        <IconTile icon={visual.icon} tone={visual.tone} />
        <p className="text-foreground min-w-0 flex-1 truncate font-semibold">
          {title ?? moduleDefinition(module).name}
        </p>
        {href && <ChevronRight aria-hidden className="text-muted h-4 w-4 shrink-0" />}
      </div>
      {children}
    </>
  );
  if (href && !action) {
    return (
      <Link href={href} className={`${FRAME} ${LINKED}`} data-tour={`card-${module}`}>
        {content}
      </Link>
    );
  }
  return (
    <section className={`${FRAME} ${href ? 'hover:border-primary/40' : ''}`} data-tour={`card-${module}`}>
      {href ? (
        <Link href={href} className="flex flex-col gap-3 transition active:scale-[0.99]">
          {content}
        </Link>
      ) : (
        content
      )}
      {action}
    </section>
  );
}

/** A half-width tile: one number and a short caption (null value = still loading). */
export function HomeTile({
  module,
  href,
  title,
  value,
  valueTone,
  caption,
  action,
}: {
  module: ModuleKey;
  href?: string;
  title?: string;
  value: string | null;
  valueTone?: 'danger' | 'success';
  caption: string;
  /** A button in the corner, for a tile that opens no screen (a link cannot hold a button). */
  action?: ReactNode;
}) {
  const visual = MODULE_VISUALS[module];
  const content = (
    <>
      <div className="flex items-start justify-between">
        <IconTile icon={visual.icon} tone={visual.tone} />
        {href ? <ChevronRight aria-hidden className="text-muted h-4 w-4" /> : action && <div className="-m-2">{action}</div>}
      </div>
      <div className="min-w-0">
        <p className="text-muted truncate text-xs font-medium">
          {title ?? moduleDefinition(module).name}
        </p>
        {value === null ? (
          <Skeleton className="mt-1 h-6 w-24" />
        ) : (
          <p
            className={`truncate text-lg leading-tight font-semibold tabular-nums ${
              valueTone === 'danger'
                ? 'text-danger'
                : valueTone === 'success'
                  ? 'text-success'
                  : 'text-foreground'
            }`}
          >
            {value}
          </p>
        )}
        <p className="text-muted mt-0.5 truncate text-xs">{caption}</p>
      </div>
    </>
  );
  const className = `${FRAME} min-h-[136px] min-w-0 justify-between`;
  return href ? (
    <Link href={href} className={`${className} ${LINKED}`} data-tour={`card-${module}`}>
      {content}
    </Link>
  ) : (
    <section className={className} data-tour={`card-${module}`}>
      {content}
    </section>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`bg-border block animate-pulse rounded ${className}`} />;
}

/** A value with its label, for the numbers inside a card. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | null;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="bg-background min-w-0 rounded-xl px-3 py-2">
      <p className="text-muted truncate text-xs">{label}</p>
      {value === null ? (
        <Skeleton className="mt-1 h-5 w-20" />
      ) : (
        <p
          className={`truncate text-base font-semibold tabular-nums ${
            tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/** A message in place of a card's numbers (an error, or nothing to show yet). */
export function CardNote({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return <p className={`text-sm ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}>{children}</p>;
}

/**
 * One broken card never takes the dashboard down: it shows a short message with "Tentar de
 * novo" (which renders it again) and the other cards carry on.
 */
export class HomeCardBoundary extends Component<
  { module: ModuleKey; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[início] o card de ${this.props.module} falhou:`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <HomeCard module={this.props.module}>
        <CardNote tone="danger">Não foi possível mostrar este resumo.</CardNote>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="text-primary self-start text-sm font-semibold"
        >
          Tentar de novo
        </button>
      </HomeCard>
    );
  }
}
