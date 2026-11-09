'use client';

import { useState } from 'react';
import {
  advancePaid,
  advanceProblem,
  advanceTotal,
  advancedPlanOf,
  currentMonthKey,
  formatBRL,
  formatMonthLabel,
  formatMonthShort,
  installmentAmount,
  installmentEndDate,
  isInstallmentFinished,
  parseAmountInput,
  remainingInstallments,
  type InstallmentPlan,
} from '@/lib/budget';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';

const INPUT =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

/**
 * "Adiantar parcelas": paying some of the charges that had not fallen due yet, which is almost
 * always done with a discount — so the app asks about it instead of letting the person discover
 * later that the purchase cost less than it says.
 *
 * What it does is the honest version of what happened: the charges brought forward leave the
 * plan, so the purchase ends earlier and stops weighing on the months ahead, and what was really
 * paid (the charges minus the discount) becomes one lançamento in the competence of the payment.
 */
export function AdvanceInstallmentSheet({
  plan,
  today,
  onClose,
  onConfirm,
}: {
  plan: InstallmentPlan;
  /** The day the server calls "hoje": what says which charges can still be brought forward. */
  today: string;
  onClose: () => void;
  onConfirm: (input: { count: number; discount: number; date: string; month: string }) => Promise<void>;
}) {
  const available = remainingInstallments(plan, today);
  const [count, setCount] = useState('1');
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discount, setDiscount] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsedCount = Number.parseInt(count, 10);
  const parsedDiscount = hasDiscount ? parseAmountInput(discount) : 0;
  const input = { count: parsedCount, discount: parsedDiscount };
  const problem = advanceProblem(plan, input, today);
  const each = installmentAmount(plan);
  const total = advanceTotal(plan, parsedCount);
  const paid = advancePaid(plan, input);
  const month = date.slice(0, 7) || currentMonthKey();

  // What the purchase looks like afterwards, worked out with the same maths the save will use.
  const after = advancedPlanOf(plan, parsedCount);
  const finished = isInstallmentFinished(after, today);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onConfirm({ count: parsedCount, discount: parsedDiscount, date, month });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open title="Adiantar parcelas" onClose={onClose} confirmDiscard={false}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <p className="text-foreground font-medium">{plan.name}</p>
          <p className="text-muted text-xs">
            {available === 0
              ? 'Nenhuma parcela a vencer.'
              : `${available} ${available === 1 ? 'parcela a vencer' : 'parcelas a vencer'} · ${formatBRL(each)} cada`}
          </p>
        </div>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Quantas parcelas você adiantou
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, available)}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            autoFocus
            className={`${INPUT} w-28`}
          />
          <span className="text-muted text-xs">Saem do fim do parcelamento: a compra termina antes.</span>
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Quando você pagou
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={INPUT}
          />
        </label>

        <div>
          <p className="text-muted mb-2 text-sm font-medium">Teve desconto para adiantar?</p>
          <div className="flex flex-wrap gap-2">
            <Chip label="Não teve" selected={!hasDiscount} onClick={() => setHasDiscount(false)} />
            <Chip label="Teve desconto" selected={hasDiscount} onClick={() => setHasDiscount(true)} />
          </div>
          {hasDiscount && (
            <div className="mt-3">
              <AmountInput value={discount} onChange={setDiscount} label="Valor do desconto" />
            </div>
          )}
        </div>

        {parsedCount > 0 && !problem && (
          <div className="bg-background flex flex-col gap-1 rounded-xl px-3 py-2.5 text-sm">
            <p className="text-foreground">
              {parsedCount}× de {formatBRL(each)} = {formatBRL(total)}
              {parsedDiscount > 0 && ` − ${formatBRL(parsedDiscount)} de desconto`}
            </p>
            <p className="text-foreground font-semibold">Você pagou {formatBRL(paid)}.</p>
            <p className="text-muted text-xs">
              Esse valor entra na fatura de {formatMonthLabel(month)}
              {plan.accounting === 'upfront'
                ? ' e não gasta categoria: a compra já contou.'
                : ' e conta na categoria deste mês.'}
            </p>
            <p className="text-muted text-xs">
              {finished
                ? 'A compra fica quitada e vai para os encerrados.'
                : `Sobram ${remainingInstallments(after, today)} parcelas, até ${formatMonthShort(installmentEndDate(after).slice(0, 7))}.`}
            </p>
          </div>
        )}

        {(error ?? (parsedCount > 0 && problem)) && (
          <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error ?? problem}</p>
        )}

        <button
          type="submit"
          disabled={saving || !!problem}
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Confirmar'}
        </button>
      </form>
    </BottomSheet>
  );
}
