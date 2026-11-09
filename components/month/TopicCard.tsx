'use client';

import Link from 'next/link';
import { computeProgressState, formatBRL, formatPct, type Month, type TopicResult } from '@/lib/budget';
import { ProgressBar } from '@/components/ui/ProgressBar';

export function TopicCard({ month, topic }: { month: Month; topic: TopicResult }) {
  const state = computeProgressState(topic.usedPct);

  return (
    <Link
      href={`/mes/${month}/categoria/${topic.topicId}`}
      className="border-border bg-card hover:border-primary/40 block rounded-xl border p-4 shadow-sm transition-colors"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: topic.color }}
          />
          <span className="text-foreground truncate font-semibold">{topic.name}</span>
        </span>
        <span className="text-muted shrink-0 text-xs">
          {topic.archived ? 'arquivada' : `meta ${formatPct(topic.targetPct, 0)}`}
        </span>
      </div>

      {topic.archived ? (
        <p className="text-muted mb-2 text-xs">
          Some no mês que vem (já tem gastos neste).
        </p>
      ) : (
        topic.description && <p className="text-muted mb-2 line-clamp-2 text-xs">{topic.description}</p>
      )}

      <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">Gasto {formatBRL(topic.spent)}</span>
        <span className={`font-semibold ${state === 'danger' ? 'text-danger' : 'text-foreground'}`}>
          Limite {formatBRL(topic.available)}
        </span>
      </div>

      <ProgressBar usedPct={topic.usedPct} state={state} color={topic.color} />

      <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">
          {topic.usedPct === null ? '—' : formatPct(topic.usedPct)} utilizada
        </span>
        <span className={topic.remaining < 0 ? 'text-danger font-medium' : 'text-muted'}>
          Sobra {formatBRL(topic.remaining)}
        </span>
      </div>
    </Link>
  );
}
