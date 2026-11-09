'use client';

import { useMemo, useState } from 'react';
import {
  INCOME_ONE_TOPIC_ADVICE,
  INCOME_ONE_TOPIC_EXPLANATION,
  amountToInputValue,
  currentMonthKey,
  parseAmountInput,
  todayISO,
  validatePositiveAmount,
  type Income,
  type Month,
  type TopicConfig,
} from '@/lib/budget';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { TagPicker } from '@/components/tags/TagPicker';

function defaultDateForMonth(month: Month): string {
  const today = new Date();
  if (currentMonthKey(today) === month) return todayISO(today);
  return `${month}-01`;
}

interface IncomeFormSheetProps {
  month: Month;
  initial?: Income;
  /**
   * The month's categories, when the budget is on: then the income can go to one category only
   * ("Não recomendado") instead of being split by %. Absent hides the choice.
   */
  topics?: TopicConfig[];
  /** Overrides the sheet's title, e.g. when confirming an income that came from a bank. */
  title?: string;
  /** The income is in a closed month: only its tags may change, saved with `onSaveTags`. */
  tagsOnly?: boolean;
  onSaveTags?: (tagIds: string[]) => Promise<void>;
  onClose: () => void;
  onSave: (income: Income) => Promise<void>;
  onDelete?: (incomeId: string) => Promise<void>;
}

export function IncomeFormSheet({
  month,
  initial,
  topics,
  title,
  tagsOnly = false,
  onSaveTags,
  onClose,
  onSave,
  onDelete,
}: IncomeFormSheetProps) {
  const [amount, setAmount] = useState(initial ? amountToInputValue(initial.amount) : '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [date, setDate] = useState(initial?.date ?? defaultDateForMonth(month));
  const [oneTopic, setOneTopic] = useState(Boolean(initial?.topicId));
  const [topicId, setTopicId] = useState(initial?.topicId);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const activeTopics = useMemo(
    () => (topics ?? []).filter((t) => !t.archived).sort((a, b) => a.order - b.order),
    [topics],
  );
  const offerTopics = activeTopics.length > 0;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (tagsOnly) {
      if (!onSaveTags) return;
      setSaving(true);
      try {
        await onSaveTags(tagIds);
        onClose();
      } catch {
        setError('Não foi possível salvar. Tente novamente.');
      } finally {
        setSaving(false);
      }
      return;
    }
    const parsedAmount = parseAmountInput(amount);
    if (!validatePositiveAmount(parsedAmount)) {
      setError('O valor deve ser maior que zero.');
      return;
    }
    if (!source.trim()) {
      setError('Informe a fonte da renda.');
      return;
    }
    // Without the choice on screen, an income keeps the category it had.
    const target = offerTopics ? (oneTopic ? topicId : undefined) : initial?.topicId;
    if (offerTopics && oneTopic && !activeTopics.some((t) => t.id === topicId)) {
      setError('Escolha a categoria que recebe esta renda.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? crypto.randomUUID(),
        source: source.trim(),
        amount: parsedAmount,
        date,
        ...(target ? { topicId: target } : {}),
        tagIds,
      });
      onClose();
    } catch {
      setError('Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(initial.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={title ?? (initial ? 'Editar renda' : 'Nova renda')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {tagsOnly && (
          <div className="bg-background text-muted rounded-xl px-3 py-2 text-xs">
            Mês fechado: só as tags podem mudar.
          </div>
        )}

        {/* In a closed month every field but the tags is locked. */}
        <fieldset disabled={tagsOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <AmountInput value={amount} onChange={setAmount} autoFocus={!initial} />

          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Fonte
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Ex.: Salário, Freela..."
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
            />
          </label>

          {offerTopics && (
            <div>
              <p className="text-muted mb-2 text-sm font-medium">Para quais categorias</p>
              <div className="flex flex-wrap gap-2">
                <Chip
                  label="Todas, pelas %"
                  badge="Recomendado"
                  badgeTone="success"
                  selected={!oneTopic}
                  onClick={() => setOneTopic(false)}
                />
                <Chip
                  label="Uma categoria só"
                  badge="Não recomendado"
                  selected={oneTopic}
                  onClick={() => setOneTopic(true)}
                />
              </div>
              {oneTopic && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeTopics.map((topic) => (
                      <Chip
                        key={topic.id}
                        label={topic.name}
                        selected={topicId === topic.id}
                        onClick={() => setTopicId(topic.id)}
                      />
                    ))}
                  </div>
                  <div className="bg-warning-bg mt-2 flex flex-col gap-1 rounded-lg px-3 py-2">
                    <p className="text-warning text-xs font-semibold">{INCOME_ONE_TOPIC_ADVICE}</p>
                    <p className="text-muted text-xs">{INCOME_ONE_TOPIC_EXPLANATION}</p>
                  </div>
                </>
              )}
            </div>
          )}

          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
            />
          </label>
        </fieldset>

        <TagPicker kind="income" value={tagIds} onChange={setTagIds} />

        {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          {initial && onDelete && !tagsOnly && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="border-danger text-danger min-h-[44px] rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
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
