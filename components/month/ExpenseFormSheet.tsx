'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CreditCard } from 'lucide-react';
import {
  amountToInputValue,
  currentMonthKey,
  formatMonthName,
  monthsTouchedBy,
  nextChargeDate,
  parseAmountInput,
  resolveQuickCategories,
  resolveSpecialCategoryLabels,
  specialCategoryLabel,
  todayISO,
  validateExpense,
  type CategoryKind,
  type Expense,
  type ExpenseSource,
  type InstallmentAccounting,
  type InstallmentPlan,
  type LateExpenseDestination,
  type Month,
  type SpecialCategoryLabels,
  type TopicConfig,
} from '@/lib/budget';
import { useCards } from '@/components/cards/CardsProvider';
import { useOptionalSettings } from '@/components/providers/SettingsProvider';
import { ClosedMonthsNotice, closedMonthsOf } from '@/components/card/ClosedMonthsNotice';
import { InstallmentOptions, MAX_INSTALLMENTS } from '@/components/card/InstallmentOptions';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CardPicker } from '@/components/ui/CardPicker';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { Chip } from '@/components/ui/Chip';
import { TagPicker } from '@/components/tags/TagPicker';

/** What happens to a new expense dated in an earlier month, said before it is saved. */
function lateExpenseNotice(destination: LateExpenseDestination, from: Month): string {
  const there = formatMonthName(destination.month);
  const here = formatMonthName(from).toLowerCase();
  if (!destination.closed) {
    return `Esse gasto vai para ${there.toLowerCase()}, o mês da data, e sai das categorias de lá.`;
  }
  const closed = `${there} já está fechado, mas o gasto entra nele assim mesmo e sai das categorias de lá.`;
  return destination.reachesFrom
    ? `${closed} Como o que restou veio para ${here}, ${here} diminui junto.`
    : `${closed} O que restou de ${there.toLowerCase()} não veio para ${here}, então ${here} não muda.`;
}

function defaultDateForMonth(month: Month): string {
  const today = new Date();
  if (currentMonthKey(today) === month) return todayISO(today);
  return `${month}-01`;
}

interface ExpenseFormSheetProps {
  month: Month;
  topics: TopicConfig[];
  specialCategories: SpecialCategoryLabels;
  /** Whether the "A receber" module is on for this user. */
  reimbursableEnabled?: boolean;
  /** Whether the card module is on: without it the card question is not asked. */
  cardEnabled?: boolean;
  initial?: Expense;
  /** A new expense filled in ahead (from the bank review or a bill of Contas do mês), still to be checked. */
  draft?: Partial<Expense>;
  /** Overrides the sheet's title, e.g. when the form is confirming a recurring expense. */
  title?: string;
  /** A line above the fields, e.g. the warning shown while editing a single instalment. */
  note?: ReactNode;
  defaultCategoryKind?: CategoryKind;
  /** False when the form is opened only to be shown (a tour step): no keyboard over it. */
  autoFocusAmount?: boolean;
  /**
   * Saves a purchase split into instalments. Without it the form never offers to split one.
   */
  onSaveInstallment?: (plan: InstallmentPlan) => Promise<void>;
  /**
   * Whether "À vista / Parcelado" may be offered at all. The default is "only a purchase that
   * does not exist yet": editing a line of a month must not turn it into a series that rewrites
   * months it never touched. A recurring expense being launched *is* a new purchase, so it says
   * so explicitly and gets the choice like any other.
   */
  allowSplit?: boolean;
  /**
   * A split already decided elsewhere, which the form opens with instead of "À vista": a
   * recurring template that says it is paid in N times brings its own number and mode, so
   * launching it is a confirmation, not a form to fill again.
   */
  installmentDraft?: { count: number; accounting: InstallmentAccounting };
  /** Competences already closed: a purchase whose charges land in one is refused here too. */
  closedMonths?: Month[];
  /**
   * Where a new expense dated in an earlier month goes (see `lateExpenseDestination`), so the form
   * says it before saving. Without it, a date outside `month` is only a warning.
   */
  lateDestinationOf?: (date: string) => Promise<LateExpenseDestination | null>;
  /**
   * The expense is in a closed month: only its tags may change (they change no number), saved
   * with `onSaveTags`; every other field is shown but locked.
   */
  tagsOnly?: boolean;
  onSaveTags?: (tagIds: string[]) => Promise<void>;
  onClose: () => void;
  onSave: (expense: Expense) => Promise<void>;
  onDelete?: (expenseId: string) => Promise<void>;
}

export function ExpenseFormSheet({
  month,
  topics,
  specialCategories,
  reimbursableEnabled = false,
  cardEnabled = true,
  initial,
  draft,
  title,
  note,
  defaultCategoryKind,
  autoFocusAmount = true,
  onSaveInstallment,
  allowSplit,
  installmentDraft,
  closedMonths = [],
  lateDestinationOf,
  tagsOnly = false,
  onSaveTags,
  onClose,
  onSave,
  onDelete,
}: ExpenseFormSheetProps) {
  const activeTopics = useMemo(
    () => topics.filter((t) => !t.archived).sort((a, b) => a.order - b.order),
    [topics],
  );
  const labels = resolveSpecialCategoryLabels(specialCategories);
  // Which categories show straight away (the rest wait behind "Outras"): the person's own choice.
  const settingsContext = useOptionalSettings();
  const currentSettings = settingsContext?.settings;
  const quick = currentSettings
    ? resolveQuickCategories(currentSettings.quickCategories, activeTopics)
    : undefined;
  // Turning the module off never hides an expense that is already "A receber": it stays
  // editable (and the user can move it to another category) instead of becoming unreachable.
  const showReimbursable = reimbursableEnabled || initial?.categoryKind === 'reimbursable';

  const prefill: Partial<Expense> | undefined = initial ?? draft;
  const source: ExpenseSource | undefined = initial ? initial.source : draft?.source;
  const [amount, setAmount] = useState(
    prefill?.amount !== undefined ? amountToInputValue(prefill.amount) : '',
  );
  const [categoryKind, setCategoryKind] = useState<CategoryKind>(
    prefill?.categoryKind ?? defaultCategoryKind ?? 'topic',
  );
  // A draft without a category leaves the choice to the user instead of picking the first one.
  const [topicId, setTopicId] = useState<string | undefined>(
    initial?.topicId ?? (draft ? draft.topicId : activeTopics[0]?.id),
  );
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [date, setDate] = useState(prefill?.date ?? defaultDateForMonth(month));
  const [singleInstallmentCard, setSingleInstallmentCard] = useState(prefill?.singleInstallmentCard ?? false);
  const { cards, defaultCard } = useCards();
  // A new card purchase starts on the default card; one that already exists keeps its own
  // (and keeps having none, when the person chose not to say which card it was).
  const [cardId, setCardId] = useState<string | undefined>(
    prefill ? prefill.cardId : (defaultCard?.id ?? undefined),
  );
  const [splitting, setSplitting] = useState(Boolean(installmentDraft));
  const [installment, setInstallment] = useState(() => {
    // The first charge follows the card the form opened on, which is not always the default one.
    const chosen = cards.find((card) => card.id === cardId) ?? defaultCard;
    return {
      count: String(installmentDraft?.count ?? 10),
      firstDebitDate: chosen ? nextChargeDate(chosen) : todayISO(),
      accounting: (installmentDraft?.accounting ?? 'upfront') as InstallmentAccounting,
    };
  });
  const [tagIds, setTagIds] = useState<string[]>(prefill?.tagIds ?? []);
  const [errors, setErrors] = useState<string[]>([]);
  const [closed, setClosed] = useState<Month[] | null>(null);
  const [late, setLate] = useState<{ date: string; destination: LateExpenseDestination | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const needsTopic = categoryKind === 'topic';
  const onCard = cardEnabled && singleInstallmentCard;
  // Splitting is offered on a new card purchase only: an expense that already exists is one
  // line of a month, and turning it into a series would rewrite months it never touched.
  const canSplit = Boolean(onSaveInstallment) && onCard && (allowSplit ?? (!initial && !draft));
  const parsedAmount = parseAmountInput(amount);
  // A date of an earlier month may send the expense there: asked as soon as the date says so.
  const earlierDate =
    Boolean(lateDestinationOf) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 7) < month;
  useEffect(() => {
    if (!earlierDate || !lateDestinationOf) return;
    let current = true;
    lateDestinationOf(date)
      .then((destination) => {
        if (current) setLate({ date, destination });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [earlierDate, lateDestinationOf, date]);
  const destination = earlierDate && late?.date === date ? late.destination : null;
  const categoryLabel =
    categoryKind === 'topic'
      ? (activeTopics.find((t) => t.id === topicId)?.name ?? 'a categoria')
      : specialCategoryLabel(categoryKind, labels);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setClosed(null);
    if (tagsOnly) {
      if (!onSaveTags) return;
      setSaving(true);
      try {
        await onSaveTags(tagIds);
        onClose();
      } catch (err) {
        setErrors([err instanceof Error ? err.message : 'Não foi possível salvar. Tente novamente.']);
      } finally {
        setSaving(false);
      }
      return;
    }
    const result = validateExpense({ categoryKind, topicId, amount: parsedAmount, date });
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    const count = Number.parseInt(installment.count, 10);
    // "1 vez" is not a plan: it is an ordinary purchase on the card.
    const asPlan = canSplit && splitting && count >= 2;
    if (canSplit && splitting && !(count >= 2 && count <= MAX_INSTALLMENTS)) {
      setErrors([`O número de parcelas vai de 2 a ${MAX_INSTALLMENTS}. Uma vez só: À vista.`]);
      return;
    }

    // Without a description the entry is named after its category, never left blank.
    const name = description.trim() || categoryLabel;
    const plan: InstallmentPlan | null = asPlan
      ? {
          id: crypto.randomUUID(),
          name,
          categoryKind,
          ...(needsTopic && topicId ? { topicId } : {}),
          firstDebitDate: installment.firstDebitDate,
          purchaseDate: date,
          count,
          totalAmount: parsedAmount,
          accounting: installment.accounting,
          ...(cardId ? { cardId } : {}),
          // Launched from a bill of "Contas do mês": that bill counts as launched this month.
          ...(prefill?.recurringId ? { recurringId: prefill.recurringId } : {}),
          tagIds,
        }
      : null;

    if (plan) {
      const blocked = monthsTouchedBy(plan).filter((m) => closedMonths.includes(m));
      if (blocked.length > 0) {
        setErrors([]);
        setClosed(blocked);
        return;
      }
    }

    setSaving(true);
    try {
      if (plan && onSaveInstallment) {
        await onSaveInstallment(plan);
      } else {
        await onSave({
          id: initial?.id ?? crypto.randomUUID(),
          categoryKind,
          topicId: needsTopic ? topicId : undefined,
          description: name,
          amount: parsedAmount,
          date,
          // With the card module off, an expense keeps whatever it already had.
          singleInstallmentCard: cardEnabled
            ? singleInstallmentCard
            : (prefill?.singleInstallmentCard ?? false),
          ...(cardId ? { cardId } : {}),
          source,
          // An instalment being edited on its own keeps its link to the plan.
          ...(initial?.installmentId ? { installmentId: initial.installmentId } : {}),
          ...(initial?.installmentNumber !== undefined
            ? { installmentNumber: initial.installmentNumber }
            : {}),
          // The bill of "Contas do mês" it came from, kept through any edit.
          ...(prefill?.recurringId ? { recurringId: prefill.recurringId } : {}),
          tagIds,
        });
      }
      onClose();
    } catch (err) {
      const blocked = closedMonthsOf(err);
      if (blocked) setClosed(blocked);
      else setErrors([err instanceof Error ? err.message : 'Não foi possível salvar. Tente novamente.']);
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
    <BottomSheet
      open
      onClose={onClose}
      title={title ?? (initial ? 'Editar gasto' : draft ? 'Conferir gasto' : 'Lançar gasto')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {note && <div className="bg-background text-muted rounded-xl px-3 py-2 text-xs">{note}</div>}
        {tagsOnly && (
          <div className="bg-background text-muted rounded-xl px-3 py-2 text-xs">
            Mês fechado: só as tags podem mudar.
          </div>
        )}

        {/* In a closed month every field but the tags is locked. */}
        <fieldset disabled={tagsOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
          <AmountInput
            value={amount}
            onChange={setAmount}
            autoFocus={autoFocusAmount && !prefill}
            trailing={
              cardEnabled ? (
                // "A compra foi no cartão?" as a small card that lights up green, right by the amount.
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={singleInstallmentCard}
                  aria-label="A compra foi no cartão?"
                  title={singleInstallmentCard ? 'Foi no cartão' : 'Foi no cartão? Toque para marcar'}
                  onClick={() => setSingleInstallmentCard((current) => !current)}
                  data-tour="cartao-pergunta"
                  className={`flex shrink-0 flex-col items-center gap-0.5 rounded-xl border px-2 py-1 transition-colors ${
                    singleInstallmentCard
                      ? 'border-success bg-success-bg text-success'
                      : 'border-border text-foreground hover:border-primary/50'
                  }`}
                >
                  <CreditCard aria-hidden className="h-6 w-6" />
                  <span className="text-[10px] leading-none font-semibold">Cartão</span>
                </button>
              ) : undefined
            }
          />

          <CategoryPicker
            topics={topics}
            specialCategories={labels}
            value={{ categoryKind, topicId }}
            onChange={(next) => {
              setCategoryKind(next.categoryKind);
              setTopicId(next.topicId);
            }}
            showReimbursable={showReimbursable}
            quick={quick}
            onQuickChange={
              settingsContext && currentSettings
                ? (next) => settingsContext.saveSettings({ ...currentSettings, quickCategories: next })
                : undefined
            }
          />

          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Descrição
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Almoço, gasolina..."
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
            />
          </label>

          <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
            Data
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
            />
            {!date.startsWith(month) && (
              <span className="text-warning text-xs">
                {destination && !(canSplit && splitting)
                  ? lateExpenseNotice(destination, month)
                  : `Essa data está fora de ${month}. Tudo bem, é só um aviso.`}
              </span>
            )}
          </label>

          {onCard && (
            <CardPicker
              cards={cards}
              value={cardId}
              onChange={(id) => {
                setCardId(id);
                const chosen = cards.find((card) => card.id === id);
                setInstallment((current) => ({
                  ...current,
                  firstDebitDate: chosen ? nextChargeDate(chosen) : todayISO(),
                }));
              }}
              tourAnchor="cartao-qual"
            />
          )}

          {canSplit && (
            <div data-tour="cartao-parcelar">
              <p className="text-muted mb-2 text-sm font-medium">Como você pagou?</p>
              <div className="flex flex-wrap gap-2">
                <Chip label="À vista" selected={!splitting} onClick={() => setSplitting(false)} />
                <Chip label="Parcelado" selected={splitting} onClick={() => setSplitting(true)} />
              </div>
            </div>
          )}

          {canSplit && splitting && (
            <InstallmentOptions
              value={installment}
              onChange={setInstallment}
              totalAmount={parsedAmount}
              categoryLabel={categoryLabel}
              purchaseMonth={date.slice(0, 7)}
            />
          )}
        </fieldset>

        <TagPicker kind="expense" value={tagIds} onChange={setTagIds} />

        {closed && <ClosedMonthsNotice months={closed} onNavigate={onClose} />}

        {errors.length > 0 && (
          <ul className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

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
