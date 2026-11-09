'use client';

import { useState } from 'react';
import {
  amountToInputValue,
  billDueDate,
  CARD_NOTIFY_BEFORE_OPTIONS,
  createId,
  currentMonthKey,
  formatDayMonth,
  formatMonthLabel,
  nominalDueDate,
  parseAmountInput,
  type CardDueMonth,
  type CreditCard,
} from '@/lib/budget';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { Switch } from '@/components/ui/Switch';

const INPUT =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

export function notifyBeforeLabel(days: number): string {
  if (days === 0) return 'Só no dia';
  return days === 1 ? '1 dia antes' : `${days} dias antes`;
}

/** A registered card: the name, the day the bill is due, the notice and, if wanted, the limit. */
export function CardFormSheet({
  initial,
  isFirst,
  order,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: CreditCard;
  isFirst: boolean;
  order: number;
  onClose: () => void;
  onSave: (card: CreditCard) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 10));
  const [dueMonth, setDueMonth] = useState<CardDueMonth>(initial?.dueMonth ?? 'next');
  const [notifyEnabled, setNotifyEnabled] = useState(initial?.notifyEnabled ?? true);
  const [notifyBeforeDays, setNotifyBeforeDays] = useState(initial?.notifyBeforeDays ?? 1);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? isFirst);
  const [limit, setLimit] = useState(initial?.limit === undefined ? '' : amountToInputValue(initial.limit));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const day = Number.parseInt(dueDay, 10);
  const month = currentMonthKey();
  const preview = day >= 1 && day <= 31 ? previewLine({ dueDay: day, dueMonth }, month) : null;
  const parsedLimit = parseAmountInput(limit);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!name.trim()) problems.push('Dê um nome ao cartão (Nubank, Itaú...).');
    if (!(day >= 1 && day <= 31)) problems.push('O dia do vencimento vai de 1 a 31.');
    if (limit.trim() && !(parsedLimit > 0)) problems.push('O limite deve ser maior que zero.');
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? createId(),
        name: name.trim(),
        dueDay: day,
        dueMonth,
        notifyEnabled,
        notifyBeforeDays,
        isDefault,
        ...(parsedLimit > 0 ? { limit: parsedLimit } : {}),
        ...(initial?.color ? { color: initial.color } : {}),
        order: initial?.order ?? order,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open title={initial ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Nome do cartão
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Nubank, Itaú..."
            autoFocus
            className={INPUT}
          />
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Dia do vencimento
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={dueDay}
            onChange={(event) => setDueDay(event.target.value)}
            className={`${INPUT} w-28`}
          />
        </label>

        <div>
          <p className="text-muted mb-2 text-sm font-medium">A fatura de um mês vence</p>
          <div className="flex flex-wrap gap-2">
            <Chip
              label="No mês seguinte"
              selected={dueMonth === 'next'}
              onClick={() => setDueMonth('next')}
            />
            <Chip label="No mesmo mês" selected={dueMonth === 'same'} onClick={() => setDueMonth('same')} />
          </div>
          {preview && <p className="text-muted mt-2 text-xs">{preview}</p>}
        </div>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Limite
          <input
            type="text"
            inputMode="decimal"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            placeholder="R$ 0,00"
            className={`${INPUT} w-40`}
          />
          <span className="text-muted text-xs">Deixe em branco se não quiser acompanhar.</span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">Avisar do vencimento</p>
            <p className="text-muted text-xs">Uma notificação no celular quando a fatura estiver perto.</p>
          </div>
          <Switch checked={notifyEnabled} label="Avisar do vencimento" onChange={setNotifyEnabled} />
        </div>

        {notifyEnabled && (
          <div>
            <p className="text-muted mb-2 text-sm font-medium">Avisar</p>
            <div className="flex flex-wrap gap-2">
              {CARD_NOTIFY_BEFORE_OPTIONS.map((days) => (
                <Chip
                  key={days}
                  label={notifyBeforeLabel(days)}
                  selected={notifyBeforeDays === days}
                  onClick={() => setNotifyBeforeDays(days)}
                />
              ))}
            </div>
          </div>
        )}

        {!isFirst && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-foreground text-sm font-medium">Cartão padrão</p>
              <p className="text-muted text-xs">O que já vem escolhido ao lançar uma compra no cartão.</p>
            </div>
            <Switch checked={isDefault} label="Cartão padrão" onChange={setIsDefault} />
          </div>
        )}

        {errors.length > 0 && (
          <ul className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">
            {errors.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-3 pt-1">
          {onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              className="border-danger text-danger min-h-[44px] rounded-lg border px-4 py-2 font-semibold"
            >
              Excluir
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

/** "A fatura de Setembro 2026 vence em 13/10 (segunda, porque caiu num sábado)." */
function previewLine(card: Pick<CreditCard, 'dueDay' | 'dueMonth'>, month: string): string {
  const nominal = nominalDueDate(card, month);
  const due = billDueDate(card, month);
  const base = `A fatura de ${formatMonthLabel(month)} vence em ${formatDayMonth(due)}`;
  return due === nominal ? `${base}.` : `${base} (o dia ${formatDayMonth(nominal)} cai no fim de semana).`;
}
