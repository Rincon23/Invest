'use client';

import { useState } from 'react';
import { formatBRL, formatMonthLabel, type Month, type MonthSummary } from '@/lib/budget';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface CloseMonthSheetProps {
  summary: MonthSummary;
  /** The month that gets the leftovers. */
  target: Month;
  /** Closing several at once: them, with `summary` showing what the last one would end with. */
  months?: Month[];
  /** Runs the close itself with the answer; resolves when the month is closed. */
  onConfirm: (bringLeftovers: boolean) => Promise<void>;
  onCancel: () => void;
}

const hasLeftovers = (summary: MonthSummary) => summary.topics.some((topic) => topic.remaining !== 0);

/** What to tell the person once the month (or the `months`) is closed. */
export function closedMonthMessage(
  summary: MonthSummary,
  target: Month,
  bringLeftovers: boolean,
  months?: Month[],
): string {
  const closed = months ? `${months.length} meses fechados.` : `${formatMonthLabel(summary.month)} fechado.`;
  if (!hasLeftovers(summary)) return closed;
  return bringLeftovers
    ? `${closed} O que restou foi para ${formatMonthLabel(target)}.`
    : `${closed} ${formatMonthLabel(target)} começa sem o que restou.`;
}

const OUTLINE =
  'border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-4 py-2 font-medium disabled:opacity-50';
const PRIMARY =
  'bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold disabled:opacity-50';

/**
 * "Fechar mês" with the preview the bot never had: every category's leftover — including the
 * negative ones — and the question of whether they go on to `target`, where they land as "mês
 * passado". The answer closes the month: there is no closed month still waiting for one. With
 * nothing left in any category, there is nothing to ask. Closing several, each passes its
 * leftovers to the next, so the list is what the last one ends with and the question is about that.
 */
export function CloseMonthSheet({ summary, target, months, onConfirm, onCancel }: CloseMonthSheetProps) {
  const [answer, setAnswer] = useState<boolean | null>(null);
  const busy = answer !== null;

  async function handleConfirm(bringLeftovers: boolean) {
    setAnswer(bringLeftovers);
    try {
      await onConfirm(bringLeftovers);
    } finally {
      setAnswer(null);
    }
  }

  return (
    <BottomSheet
      open
      title={months ? `Fechar ${months.length} meses` : `Fechar ${formatMonthLabel(summary.month)}`}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-5">
        {months ? (
          <p className="text-muted text-sm leading-relaxed">
            De {formatMonthLabel(months[0])} a {formatMonthLabel(months[months.length - 1])}. Depois de
            fechados, eles não aceitam mais lançamentos (dá para reabrir). Abaixo, o que restou somando
            todos.
          </p>
        ) : (
          <p className="text-muted text-sm leading-relaxed">
            Depois de fechado, ele não aceita mais lançamentos (dá para reabrir).
          </p>
        )}

        <ul className="border-border divide-border divide-y rounded-xl border">
          {summary.topics.map((topic) => (
            <li key={topic.topicId} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="text-muted flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: topic.color }}
                />
                <span className="truncate">{topic.name}</span>
              </span>
              <span className={`font-semibold ${topic.remaining < 0 ? 'text-danger' : 'text-foreground'}`}>
                {formatBRL(topic.remaining)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold">
            <span className="text-muted">Total</span>
            <span className={summary.balance < 0 ? 'text-danger' : 'text-foreground'}>
              {formatBRL(summary.balance)}
            </span>
          </li>
        </ul>

        {hasLeftovers(summary) ? (
          <>
            <p className="text-foreground font-semibold">Trazer o que restou para {formatMonthLabel(target)}?</p>

            {summary.topics.some((topic) => topic.remaining < 0) && (
              <p className="bg-warning-bg text-warning rounded-lg px-3 py-2 text-xs">
                O que ficou negativo também vem: essas categorias começam o mês devendo.
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleConfirm(false)}
                disabled={busy}
                className={OUTLINE}
              >
                {answer === false ? 'Fechando…' : 'Não trazer'}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm(true)}
                disabled={busy}
                className={PRIMARY}
              >
                {answer === true ? 'Fechando…' : 'Trazer'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex">
            <button
              type="button"
              onClick={() => void handleConfirm(true)}
              disabled={busy}
              className={PRIMARY}
            >
              {busy ? 'Fechando…' : 'Fechar mês'}
            </button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
