'use client';

import { ModuleGate } from '@/components/modules/ModuleGate';
import { useMonthContext } from '@/components/month/MonthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import {
  computeProgressState,
  expenseDayLabel,
  expenseListDate,
  formatBRL,
  formatMonthLabel,
  formatPct,
} from '@/lib/budget';

export function CategoryDetailScreen({ topicId }: { topicId: string }) {
  return (
    <ModuleGate module="budget">
      <CategoryDetail topicId={topicId} />
    </ModuleGate>
  );
}

function CategoryDetail({ topicId }: { topicId: string }) {
  const { month, summary, monthData, loading, openExpenseForm } = useMonthContext();

  if (loading || !summary || !monthData) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }

  const topic = summary.topics.find((t) => t.topicId === topicId);
  if (!topic) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <PageHeader title="Categoria" backHref={`/mes/${month}/categorias`} />
        <p className="text-muted px-4">Categoria não encontrada neste mês.</p>
      </div>
    );
  }

  const entries = monthData.expenses
    .filter((e) => e.topicId === topicId && e.categoryKind === 'topic')
    .sort((a, b) => expenseListDate(b).localeCompare(expenseListDate(a)));

  const state = computeProgressState(topic.usedPct);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      <PageHeader
        title={topic.name}
        subtitle={formatMonthLabel(month)}
        backHref={`/mes/${month}/categorias`}
        accentColor={topic.color}
      />

      <div className="flex flex-col gap-3 px-4">
        <div className="border-border bg-card rounded-xl border p-4 shadow-sm">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-muted">Gasto {formatBRL(topic.spent)}</span>
            <span className="text-foreground font-semibold">Limite {formatBRL(topic.available)}</span>
          </div>
          <ProgressBar usedPct={topic.usedPct} state={state} color={topic.color} />
          <div className="mt-2 flex items-baseline justify-between text-sm">
            <span className="text-muted">
              {topic.usedPct === null ? '—' : formatPct(topic.usedPct)} utilizada
            </span>
            <span className={topic.remaining < 0 ? 'text-danger font-medium' : 'text-muted'}>
              Sobra {formatBRL(topic.remaining)}
            </span>
          </div>
        </div>

        <div className="border-border bg-card rounded-xl border p-4 text-sm shadow-sm">
          <p className="text-muted mb-2 text-xs font-medium tracking-wide uppercase">
            Como chegamos nesse valor
          </p>
          <dl className="space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-muted">Renda total × {formatPct(topic.targetPct, 0)}</dt>
              <dd className="text-foreground">{formatBRL(topic.incomeShare)}</dd>
            </div>
            {topic.directIncome > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">+ Renda só desta categoria</dt>
                <dd className="text-foreground">{formatBRL(topic.directIncome)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">− Custos fixos e imprevistos (divididos)</dt>
              <dd className="text-foreground">{formatBRL(topic.proportionalFixed)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">+ Mês passado</dt>
              <dd className={topic.carryIn < 0 ? 'text-danger' : 'text-foreground'}>
                {formatBRL(topic.carryIn)}
              </dd>
            </div>
            <div className="border-border flex justify-between border-t pt-1.5 font-semibold">
              <dt className="text-foreground">= Limite do mês</dt>
              <dd className="text-foreground">{formatBRL(topic.available)}</dd>
            </div>
          </dl>
        </div>

        <button
          type="button"
          onClick={() => openExpenseForm(undefined, 'topic')}
          className="border-primary text-primary min-h-[44px] rounded-lg border px-4 py-2 text-sm font-semibold"
        >
          + Lançar gasto em {topic.name}
        </button>

        <ul className="flex flex-col gap-2">
          {entries.length === 0 && (
            <p className="text-muted py-6 text-center text-sm">Nenhum lançamento ainda.</p>
          )}
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => openExpenseForm(entry)}
                className="border-border bg-card flex min-h-[56px] w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left shadow-sm"
              >
                <span className="min-w-0">
                  <span className="text-foreground block truncate font-medium">{entry.description}</span>
                  <span className="text-muted block text-xs">{expenseDayLabel(entry)}</span>
                </span>
                <span className="text-foreground font-semibold">{formatBRL(entry.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
