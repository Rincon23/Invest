'use client';

import {
  computeProgressState,
  expenseListDate,
  formatBRL,
  formatMonthShort,
  sum,
  type Expense,
  type Income,
} from '@/lib/budget';
import { useMonthsToClose } from '@/lib/hooks/useMonthsToClose';
import { usePendingReimbursables } from '@/lib/hooks/usePendingReimbursables';
import { ClosePastMonths } from '@/components/month/ClosePastMonths';
import { useMonthContext } from '@/components/month/MonthContext';
import { useSettings } from '@/components/providers/SettingsProvider';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CardNote, HomeCard, HomeTile, Skeleton, Stat } from './HomeCard';

/** "05/09" */
function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

type Entry = { kind: 'expense'; item: Expense } | { kind: 'income'; item: Income };

/** The day the entry sits on: an instalment on the day it was bought, like in Lançamentos. */
function entryDate(entry: Entry): string {
  return entry.kind === 'expense' ? expenseListDate(entry.item) : (entry.item.date ?? '');
}

/** Lançamentos: income and spending of the month, and the three latest entries. */
export function ExpensesHomeCard() {
  const { month, summary, monthData, error } = useMonthContext();

  // The month keeps entries in the order they were made: reversed before the (stable) sort by
  // day, the last one made comes first within its day too, like in Lançamentos.
  const latest: Entry[] = monthData
    ? [
        ...[...monthData.expenses].reverse().map((item) => ({ kind: 'expense' as const, item })),
        ...[...monthData.incomes].reverse().map((item) => ({ kind: 'income' as const, item })),
      ]
        .sort((a, b) => entryDate(b).localeCompare(entryDate(a)))
        .slice(0, 3)
    : [];

  return (
    <HomeCard module="expenses" href={`/mes/${month}/lancamentos`}>
      {error && !summary ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Renda" value={summary ? formatBRL(summary.incomeTotal) : null} />
            <Stat label="Total gasto" value={summary ? formatBRL(summary.expenseTotal) : null} />
          </div>
          {!monthData ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : latest.length === 0 ? (
            <CardNote>Nenhum lançamento neste mês ainda.</CardNote>
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {latest.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.item.id}`}
                  className="flex items-center justify-between gap-2 py-1.5 text-sm"
                >
                  <span className="text-foreground min-w-0 truncate">
                    {entry.kind === 'expense' ? entry.item.description : entry.item.source}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-muted text-xs">{shortDate(entryDate(entry))}</span>
                    <span
                      className={`font-medium tabular-nums ${entry.kind === 'income' ? 'text-success' : 'text-foreground'}`}
                    >
                      {entry.kind === 'income' ? '+' : ''}
                      {formatBRL(entry.item.amount)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </HomeCard>
  );
}

/**
 * Gastos por categoria: a thin bar and what is left for each category. No total of all of them
 * together — it read as if the whole sum could go to anything (the owner asked it out). With any
 * month before this one still open, the buttons that close it at its foot.
 */
export function BudgetHomeCard() {
  const { month, summary, error } = useMonthContext();
  const { settings } = useSettings();
  const toClose = useMonthsToClose(month, settings?.topics);

  return (
    <HomeCard
      module="budget"
      href={`/mes/${month}/categorias`}
      action={toClose && <ClosePastMonths {...toClose} />}
    >
      {error && !summary ? (
        <CardNote tone="danger">{error}</CardNote>
      ) : (
        <>
          {!summary ? (
            <Skeleton className="h-2 w-full" />
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.topics.map((topic) => (
                <li key={topic.topicId} className="flex items-center gap-3 text-xs">
                  <span className="text-muted w-24 shrink-0 truncate">{topic.name}</span>
                  <span className="min-w-0 flex-1">
                    <ProgressBar
                      usedPct={topic.usedPct}
                      state={computeProgressState(topic.usedPct)}
                      color={topic.color}
                    />
                  </span>
                  <span
                    className={`w-20 shrink-0 text-right tabular-nums ${topic.remaining < 0 ? 'text-danger' : 'text-muted'}`}
                  >
                    {formatBRL(topic.remaining)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </HomeCard>
  );
}

/** A receber: what other people owe back this month. */
export function ReimbursableHomeTile() {
  const { month, monthData } = useMonthContext();
  // Owed from this month and every month before it: a debt does not vanish when the month turns.
  const { pending, error } = usePendingReimbursables(month, true, monthData);
  const total = pending ? sum(pending.map((entry) => entry.expense.amount)) : null;
  // The oldest month still owing, when it is not this one: "desde ago/26".
  const oldest = pending?.reduce<string | null>(
    (min, entry) => (min === null || entry.month < min ? entry.month : min),
    null,
  );

  return (
    <HomeTile
      module="reimbursable"
      href={`/mes/${month}/lancamentos?aba=a-receber`}
      value={error ? '—' : total === null ? null : formatBRL(total)}
      caption={
        pending && pending.length > 0
          ? `${pending.length} ${pending.length === 1 ? 'pendente' : 'pendentes'}${oldest && oldest < month ? ` · desde ${formatMonthShort(oldest)}` : ''}`
          : 'ninguém te deve'
      }
    />
  );
}
