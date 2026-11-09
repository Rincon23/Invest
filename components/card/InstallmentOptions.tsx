'use client';

import {
  activeDueDates,
  formatBRL,
  formatMonthShort,
  type InstallmentAccounting,
  type Month,
} from '@/lib/budget';

const INPUT =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

/** The maximum the bank itself would take, and what the plan's validation allows. */
export const MAX_INSTALLMENTS = 120;

/** The two ways a split purchase enters the budget, as the person reads them. */
export const ACCOUNTING_LABELS: Record<InstallmentAccounting, string> = {
  upfront: 'Contar tudo neste mês',
  installment: 'Contar uma parcela por mês',
};

export interface InstallmentOptionsValue {
  /** Kept as text while it is being typed (it can be empty for a moment). */
  count: string;
  firstDebitDate: string;
  accounting: InstallmentAccounting;
}

/**
 * "nov/26 ▸ dez ▸ jan ▸ … ▸ ago/27": every month when there are few, the first three and the last
 * two otherwise. Only the ends carry the year, so the strip fits on one line.
 */
function stripOf(months: Month[]): { key: string; label: string }[] {
  const kept: (Month | null)[] = months.length <= 6 ? months : [...months.slice(0, 3), null, ...months.slice(-2)];
  return kept.map((month, index) => {
    if (!month) return { key: `pausa-${index}`, label: '…' };
    const short = formatMonthShort(month);
    const end = index === 0 || index === kept.length - 1;
    return { key: month, label: end ? short : short.split('/')[0] };
  });
}

/**
 * How a purchase is split: in how many times, when the first charge falls, and — the part that
 * actually changes the numbers — how it enters the budget.
 *
 * "Contar tudo neste mês" is the recommended one and comes chosen: the whole purchase counts in the
 * category in the month it was bought, which is when the money was really committed, and the
 * following months only see the instalment on the bill. "Contar uma parcela por mês" spreads it
 * instead, so each month's instalment counts in that month's category. (The payment itself is "À
 * vista / Parcelado" in the form; this is only about the budget, so it never says "à vista".)
 * Instead of sentences, a strip of the bill's months and what the category gets show the result.
 */
export function InstallmentOptions({
  value,
  onChange,
  totalAmount,
  categoryLabel,
  purchaseMonth,
  lockedReason,
  lockedTo,
  paidCount,
  withoutFirstDebit = false,
}: {
  value: InstallmentOptionsValue;
  onChange: (value: InstallmentOptionsValue) => void;
  /** The whole purchase, to show what one instalment is worth. */
  totalAmount: number;
  /** The category the person chose in the form, named as they see it. */
  categoryLabel: string;
  /** The competence of the purchase date, where an "everything this month" plan lands. */
  purchaseMonth: Month;
  /**
   * Why the choice is not being offered, when it is not. A purchase that started before it was
   * registered here can only count one instalment a month: counting it all at once would have to
   * write the whole amount into the month it was bought, which is a month the person asked not to
   * touch.
   */
  lockedReason?: string;
  /** The mode that applies while the choice is locked, so the summary tells the same story. */
  lockedTo?: InstallmentAccounting;
  /** Charges already paid before the purchase was registered: they are not on any bill. */
  paidCount?: number;
  /**
   * Hides "Primeira cobrança" and everything that depends on it. A recurring template is not a
   * purchase yet — the first charge is only known on the day it is launched — so it says in how
   * many times and how it enters the budget, and nothing about dates.
   */
  withoutFirstDebit?: boolean;
}) {
  const count = Number.parseInt(value.count, 10);
  const valid = count >= 2 && count <= MAX_INSTALLMENTS && totalAmount > 0;
  const each = valid ? totalAmount / count : 0;
  const accounting = lockedTo ?? value.accounting;
  // The months the bill really sees: the charges already paid before the cadastro are not among
  // them, so the strip never promises a charge that will not arrive.
  const due = activeDueDates({
    firstDebitDate: value.firstDebitDate,
    count: Math.max(count || 0, 1),
    paidCount,
  }).map((date) => date.slice(0, 7));

  return (
    <div className="border-border flex flex-col gap-4 rounded-xl border border-dashed p-3">
      <div className="flex gap-3">
        <label className="text-muted flex flex-1 flex-col gap-1.5 text-sm font-medium">
          Em quantas vezes
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={MAX_INSTALLMENTS}
            value={value.count}
            onChange={(event) => onChange({ ...value, count: event.target.value })}
            className={INPUT}
          />
        </label>
        {!withoutFirstDebit && (
          <label className="text-muted flex flex-1 flex-col gap-1.5 text-sm font-medium">
            Primeira cobrança
            <input
              type="date"
              value={value.firstDebitDate}
              onChange={(event) => onChange({ ...value, firstDebitDate: event.target.value })}
              className={INPUT}
            />
          </label>
        )}
      </div>

      <div>
        <p className="text-muted mb-2 text-sm font-medium">Como entra no orçamento</p>
        {lockedReason ? (
          <p className="bg-background text-muted rounded-lg px-3 py-2 text-xs">{lockedReason}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(['upfront', 'installment'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...value, accounting: mode })}
                aria-pressed={value.accounting === mode}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  value.accounting === mode ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-foreground text-sm font-semibold">{ACCOUNTING_LABELS[mode]}</span>
                {mode === 'upfront' && (
                  <span className="bg-success-bg text-success rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    Recomendado
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {valid && (
        <div className="bg-background flex flex-col gap-2.5 rounded-xl p-3 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted">Na fatura</span>
            <span className="text-foreground text-sm font-semibold tabular-nums">
              {count}× {formatBRL(each)}
            </span>
          </div>
          {!withoutFirstDebit && due.length > 0 && (
            <p className="text-foreground truncate font-medium tracking-tight" aria-label="Meses da fatura">
              {stripOf(due)
                .map((cell) => cell.label)
                .join(' ▸ ')}
            </p>
          )}
          <div className="border-border flex items-baseline justify-between gap-2 border-t pt-2.5">
            <span className="text-muted min-w-0 truncate">Em {categoryLabel}</span>
            <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
              {accounting === 'upfront'
                ? `${formatBRL(totalAmount)} ${withoutFirstDebit ? 'no mês da compra' : `em ${formatMonthShort(purchaseMonth)}`}`
                : `${formatBRL(each)} por mês`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
