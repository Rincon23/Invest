'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  MAX_DUE_DAY,
  amountToInputValue,
  createId,
  currentMonthKey,
  formatBRL,
  formatDayMonth,
  formatMonthLabel,
  nextMonth,
  parseAmountInput,
  previousMonth,
  recurringChecklist,
  recurringDueLabel,
  resolveSpecialCategoryLabels,
  specialCategoryLabel,
  todayISO,
  type Expense,
  type InstallmentAccounting,
  type Month,
  type RecurringExpense,
  type RecurringSettings,
  type RecurringStatus,
  type TopicConfig,
} from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { budgetRepository, walletRepository } from '@/lib/storage';
import { useCards } from '@/components/cards/CardsProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExpenseFormSheet } from '@/components/month/ExpenseFormSheet';
import { MonthSwipe, useMonthSwipe } from '@/components/month/MonthSwipe';
import { MonthSwipeHint } from '@/components/month/MonthSwipeHint';
import { useSettings } from '@/components/providers/SettingsProvider';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { AmountInput } from '@/components/ui/AmountInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { InstallmentOptions, MAX_INSTALLMENTS } from '@/components/card/InstallmentOptions';
import { CardPicker } from '@/components/ui/CardPicker';
import { Chip } from '@/components/ui/Chip';
import { TagPicker } from '@/components/tags/TagPicker';
import { CategoryPicker, type CategoryValue } from '@/components/ui/CategoryPicker';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { useWallet } from '@/components/wallet/WalletProvider';

const INPUT =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2';

export function RecorrentesScreen() {
  return (
    <ModuleGate module="recurring">
      <Recorrentes />
    </ModuleGate>
  );
}

/** The name of a template's category, regular or special. */
function categoryLabel(
  item: RecurringExpense,
  topics: TopicConfig[],
  labels: Parameters<typeof specialCategoryLabel>[1],
): string {
  if (item.categoryKind === 'topic') {
    return topics.find((topic) => topic.id === item.topicId)?.name ?? '—';
  }
  return specialCategoryLabel(item.categoryKind, labels);
}

/**
 * "Contas do mês": the bills that repeat every month, as a checklist of the month on screen — what
 * is still to launch (the next to fall due first, with the day) and what was already launched. A
 * bill is launched with the ordinary expense form, already filled, into that month; the month
 * changes by swiping, like the bill of the Cartão.
 */
function Recorrentes() {
  const backHref = useHomeHref();
  const { settings } = useSettings();
  const { snapshot, loading, error, month: walletMonth, run } = useWallet();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [month, setMonth] = useState<Month>(currentMonthKey);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  /** The pending bill whose options are open (Lançar, Já lancei, Editar). */
  const [acting, setActing] = useState<RecurringStatus | null>(null);
  /** The bill being tied to an expense that was launched without it ("Já lancei"). */
  const [linking, setLinking] = useState<RecurringExpense | null>(null);
  /** The expense a "Lançar" is about to create, shown in the normal expense form. */
  const [launching, setLaunching] = useState<{
    draft: Partial<Expense>;
    /** The split the template already decided, when it is a parcelled one. */
    installment?: { count: number; accounting: InstallmentAccounting };
  } | null>(null);
  useModuleIntro('recurring', { ready: !!snapshot });

  // The month the Carteira writes to (the last one seen) is where the list starts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(walletMonth);
  }, [walletMonth]);

  if (loading && !snapshot) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }

  const labels = resolveSpecialCategoryLabels(settings?.specialCategories);
  const topics = settings?.topics ?? [];
  const items = snapshot?.recurring ?? [];
  const checklist = recurringChecklist(
    items,
    snapshot?.recurringLaunches ?? [],
    month,
    snapshot?.today ?? todayISO(),
  );
  const cardOn = isModuleOn(settings, 'card');

  async function handleSave(item: RecurringExpense) {
    try {
      await run(() => walletRepository.saveRecurring(item));
      showToast('Conta salva.');
      setEditing(null);
      setCreating(false);
    } catch {
      showToast('Não foi possível salvar. Tente de novo.', 'error');
    }
  }

  async function handleDelete(item: RecurringExpense) {
    const confirmed = await confirm({
      title: 'Excluir conta',
      message: `"${item.description}" sai da lista; os gastos já lançados continuam.`,
      confirmLabel: 'Excluir',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) return;
    await run(() => walletRepository.deleteRecurring(item.id));
    setEditing(null);
    showToast('Conta excluída.');
  }

  /**
   * Opens the ordinary expense form, filled from the template, with today's date and into the
   * month on screen. It goes in as a draft, so the form is the same one as everywhere else —
   * including "À vista / Parcelado" when the template is paid on the card — and the expense it
   * saves points at the template, which is what marks the bill as launched.
   */
  function startLaunch(item: RecurringExpense) {
    const onCard = item.card && cardOn;
    setActing(null);
    setLaunching({
      draft: {
        categoryKind: item.categoryKind,
        ...(item.topicId ? { topicId: item.topicId } : {}),
        description: item.description,
        amount: item.amount,
        date: todayISO(),
        singleInstallmentCard: onCard,
        ...(onCard && item.cardId ? { cardId: item.cardId } : {}),
        source: 'recurring',
        recurringId: item.id,
        ...(item.tagIds ? { tagIds: item.tagIds } : {}),
      },
      // Um modelo parcelado abre o formulário já em "Parcelado", com o número de vezes e a
      // forma de contabilizar que ele guarda: lançar é confirmar, não preencher de novo.
      ...(onCard && item.installmentCount
        ? {
            installment: {
              count: item.installmentCount,
              accounting: item.installmentAccounting ?? 'upfront',
            },
          }
        : {}),
    });
  }

  /** "vence dia 10 · Custos Fixos · cartão" — what a row says under the name. */
  function details(item: RecurringExpense, extra?: string | null): string {
    return [
      extra,
      categoryLabel(item, topics, labels),
      item.card && cardOn ? 'cartão' : null,
      item.card && cardOn && item.installmentCount
        ? `${item.installmentCount}× de ${formatBRL(item.amount / item.installmentCount)}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const doneCount = checklist.done.length;
  const progress = items.length > 0 ? doneCount / items.length : 0;
  const actingDue = acting ? recurringDueLabel(acting) : null;

  return (
    <div className="flex flex-1 flex-col gap-3 pb-10">
      <PageHeader
        title="Contas do mês"
        backHref={backHref}
        action={
          <>
            <ModuleHelpButton module="recurring" />
            <ModuleSettingsButton
              module="recurring"
              tourAnchor="recorrentes-config"
              onClick={() => setConfiguring(true)}
            />
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="Nova conta"
              data-tour="recorrentes-novo"
              className="bg-primary text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              +
            </button>
          </>
        }
      />

      {error && <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>}

      <MonthSwipe month={month} onMonth={setMonth}>
        <div className="flex flex-col gap-3">
          <MonthHeader month={month} onMonth={setMonth} />

          {items.length > 0 && (
            <section
              data-tour="recorrentes-resumo"
              className="border-border bg-card mx-4 flex flex-col gap-2 rounded-2xl border p-4 shadow-sm"
            >
              {checklist.pending.length === 0 ? (
                <>
                  <p className="text-muted text-sm">Contas de {formatMonthLabel(month)}</p>
                  <p className="text-success text-2xl font-bold">Tudo lançado ✓</p>
                  <p className="text-muted text-sm">
                    {items.length} {items.length === 1 ? 'conta' : 'contas'} · {formatBRL(checklist.total)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-muted text-sm">Falta lançar</p>
                  <p className="text-foreground text-2xl font-bold tabular-nums">
                    {formatBRL(checklist.pendingTotal)}
                  </p>
                  <div className="bg-border h-2.5 overflow-hidden rounded-full" aria-hidden>
                    <div className="bg-primary h-full rounded-full" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="text-muted text-sm">
                    {doneCount} de {items.length} {items.length === 1 ? 'conta lançada' : 'contas lançadas'}
                  </p>
                </>
              )}
            </section>
          )}

          <div data-tour="recorrentes-lista" className="flex flex-col gap-3">
            {checklist.pending.length > 0 && (
              <ul className="flex flex-col gap-2 px-4">
                {checklist.pending.map((status) => {
                  const tone =
                    status.daysUntilDue !== null && status.daysUntilDue < 0
                      ? 'text-danger'
                      : status.daysUntilDue === 0
                        ? 'text-warning'
                        : 'text-muted';
                  return (
                    <li
                      key={status.item.id}
                      className="border-border bg-card flex items-center gap-2 rounded-xl border px-4 py-3 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setActing(status)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="text-foreground block truncate font-medium">
                          {status.item.description}
                        </span>
                        <span className={`block text-xs ${tone}`}>
                          {details(status.item, recurringDueLabel(status))}
                        </span>
                      </button>
                      <span className="text-foreground shrink-0 font-semibold">
                        {formatBRL(status.item.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => startLaunch(status.item)}
                        className="border-border text-foreground min-h-[36px] shrink-0 rounded-lg border px-3 text-sm font-medium"
                      >
                        Lançar
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {checklist.done.length > 0 && (
              <section className="flex flex-col gap-2 px-4">
                <h2 className="text-muted text-sm font-semibold">Já lançadas</h2>
                <ul className="flex flex-col gap-2">
                  {checklist.done.map((status) => (
                    <li key={status.item.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(status.item)}
                        className="border-border bg-card flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-sm"
                      >
                        <Check aria-hidden className="text-success h-5 w-5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground block truncate font-medium">
                            {status.item.description}
                          </span>
                          <span className="text-muted block text-xs">
                            lançada em {formatDayMonth(status.launchedOn as string)}
                          </span>
                        </span>
                        <span className="text-muted shrink-0 font-semibold">
                          {formatBRL(status.item.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {items.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-muted text-sm">Nenhuma conta ainda: aluguel, luz, internet, faculdade…</p>
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold"
                >
                  Cadastrar a primeira
                </button>
              </div>
            )}
          </div>
        </div>
      </MonthSwipe>

      {acting && (
        <BottomSheet
          open
          title={acting.item.description}
          onClose={() => setActing(null)}
          confirmDiscard={false}
        >
          <div className="flex flex-col gap-3">
            <p className="text-muted text-sm">
              {formatBRL(acting.item.amount)}
              {actingDue ? ` · ${actingDue}` : ''} · {formatMonthLabel(month)}
            </p>
            <button
              type="button"
              onClick={() => startLaunch(acting.item)}
              className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 font-semibold"
            >
              Lançar
            </button>
            <button
              type="button"
              onClick={() => {
                setLinking(acting.item);
                setActing(null);
              }}
              className="border-border text-foreground min-h-[44px] rounded-lg border px-4 font-medium"
            >
              Já lancei este mês
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(acting.item);
                setActing(null);
              }}
              className="text-primary min-h-[44px] rounded-lg px-4 text-sm font-medium"
            >
              Editar conta
            </button>
          </div>
        </BottomSheet>
      )}

      {linking && (
        <LinkExpenseSheet
          item={linking}
          month={month}
          onClose={() => setLinking(null)}
          onLink={async (expense) => {
            try {
              await run(() => budgetRepository.saveExpense(month, { ...expense, recurringId: linking.id }));
              setLinking(null);
              showToast(`"${linking.description}" marcada como lançada.`);
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
            }
          }}
        />
      )}

      {configuring && snapshot && (
        <ModuleSettingsSheet module="recurring" onClose={() => setConfiguring(false)}>
          <RecurringSettingsSection
            settings={snapshot.recurringSettings}
            onSave={async (next) => {
              try {
                await run(() => walletRepository.saveRecurringSettings(next));
                showToast('Configuração salva.');
              } catch {
                showToast('Não foi possível salvar. Tente de novo.', 'error');
              }
            }}
          />
          <NotificationsSection />
        </ModuleSettingsSheet>
      )}

      {(creating || editing) && settings && (
        <RecurringFormSheet
          topics={topics}
          specialCategories={settings.specialCategories}
          showReimbursable={isModuleOn(settings, 'reimbursable')}
          cardEnabled={cardOn}
          initial={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
          onDelete={editing ? () => handleDelete(editing) : undefined}
        />
      )}

      {launching && settings && (
        <ExpenseFormSheet
          month={month}
          topics={topics}
          specialCategories={settings.specialCategories}
          reimbursableEnabled={isModuleOn(settings, 'reimbursable')}
          cardEnabled={cardOn}
          draft={launching.draft}
          allowSplit
          installmentDraft={launching.installment}
          closedMonths={snapshot?.closedMonths ?? []}
          title="Lançar conta"
          onClose={() => setLaunching(null)}
          onSave={async (expense) => {
            // Through `run`, so the list (and the reserva's card debt) reflect it right away.
            await run(() => budgetRepository.saveExpense(month, expense));
            setLaunching(null);
            showToast('Conta lançada.');
          }}
          onSaveInstallment={
            cardOn
              ? async (plan) => {
                  await run(() => walletRepository.saveInstallment(plan));
                  setLaunching(null);
                  showToast('Compra parcelada criada a partir da conta.');
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** ‹ Outubro 2026 › — inside the MonthSwipe, the arrows slide the month like a swipe does. */
function MonthHeader({ month, onMonth }: { month: Month; onMonth: (month: Month) => void }) {
  const slide = useMonthSwipe();
  return (
    <div className="flex items-center justify-between gap-2 px-4" data-tour="recorrentes-mes">
      <button
        type="button"
        onClick={() => (slide ? slide(-1) : onMonth(previousMonth(month)))}
        aria-label="Mês anterior"
        className="text-foreground hover:bg-card flex h-11 w-11 items-center justify-center rounded-full text-xl"
      >
        ‹
      </button>
      <span className="flex flex-col items-center">
        <span className="text-foreground text-lg font-semibold">{formatMonthLabel(month)}</span>
        <MonthSwipeHint month={month} />
      </span>
      <button
        type="button"
        onClick={() => (slide ? slide(1) : onMonth(nextMonth(month)))}
        aria-label="Próximo mês"
        className="text-foreground hover:bg-card flex h-11 w-11 items-center justify-center rounded-full text-xl"
      >
        ›
      </button>
    </div>
  );
}

/**
 * "Já lancei este mês": a bill paid but launched by the ordinary form (or before "Contas do mês"
 * existed) is tied to that expense, which is what marks it as launched. The expenses of the same
 * category come first.
 */
function LinkExpenseSheet({
  item,
  month,
  onClose,
  onLink,
}: {
  item: RecurringExpense;
  month: Month;
  onClose: () => void;
  onLink: (expense: Expense) => Promise<void>;
}) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await budgetRepository.peekMonth(month);
      setExpenses(data.expenses);
    } catch {
      setFailed(true);
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sameCategory = (expense: Expense) =>
    expense.categoryKind === item.categoryKind && (expense.topicId ?? null) === (item.topicId ?? null);
  const candidates = (expenses ?? [])
    .filter((expense) => !expense.recurringId && !expense.installmentId && expense.amount > 0)
    .sort((a, b) => Number(sameCategory(b)) - Number(sameCategory(a)) || (a.date < b.date ? 1 : -1));

  return (
    <BottomSheet open title="Qual gasto foi essa conta?" onClose={onClose} confirmDiscard={false}>
      <div className="flex flex-col gap-3">
        <p className="text-muted text-sm">
          {item.description} · {formatMonthLabel(month)}
        </p>
        {failed ? (
          <p className="text-danger text-sm">Não foi possível carregar os gastos do mês.</p>
        ) : expenses === null ? (
          <p className="text-muted py-4 text-center text-sm">Carregando…</p>
        ) : candidates.length === 0 ? (
          <p className="text-muted py-4 text-center text-sm">
            Nenhum gasto lançado em {formatMonthLabel(month)} ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {candidates.map((expense) => (
              <li key={expense.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onLink(expense);
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="border-border bg-card flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate font-medium">{expense.description}</span>
                    <span className="text-muted block text-xs">{formatDayMonth(expense.date)}</span>
                  </span>
                  <span className="text-foreground shrink-0 font-semibold">{formatBRL(expense.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

/** The notice of the bills: on or off, the time and whether it keeps reminding until launched. */
function RecurringSettingsSection({
  settings,
  onSave,
}: {
  settings: RecurringSettings;
  onSave: (settings: RecurringSettings) => Promise<void>;
}) {
  const [notifyTime, setNotifyTime] = useState(settings.notifyTime);

  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-muted text-sm font-semibold">Aviso no dia do vencimento</h2>
      <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-foreground text-sm font-medium">Avisar no dia</p>
          <Switch
            checked={settings.notifyEnabled}
            label="Avisar no dia do vencimento"
            onChange={(checked) => void onSave({ ...settings, notifyEnabled: checked })}
          />
        </div>
        {settings.notifyEnabled && (
          <>
            <label className="text-muted flex items-center justify-between gap-3 text-sm font-medium">
              Horário do aviso
              <input
                type="time"
                value={notifyTime}
                onChange={(event) => {
                  setNotifyTime(event.target.value);
                  if (/^\d{2}:\d{2}$/.test(event.target.value)) {
                    void onSave({ ...settings, notifyTime: event.target.value });
                  }
                }}
                className={`${INPUT} w-32`}
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">Lembrar de novo até lançar</p>
                <p className="text-muted text-xs">Um aviso por dia, por até 3 dias depois do vencimento.</p>
              </div>
              <Switch
                checked={settings.repeatUntilLaunched}
                label="Lembrar de novo até lançar"
                onChange={(checked) => void onSave({ ...settings, repeatUntilLaunched: checked })}
              />
            </div>
          </>
        )}
        <p className="text-muted text-xs">Só avisa das contas que têm dia do vencimento.</p>
      </div>
    </section>
  );
}

function RecurringFormSheet({
  topics,
  specialCategories,
  showReimbursable,
  cardEnabled,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  topics: TopicConfig[];
  specialCategories: Parameters<typeof resolveSpecialCategoryLabels>[0];
  showReimbursable: boolean;
  /** Without the card module the template keeps its card flag but does not ask about it. */
  cardEnabled: boolean;
  initial?: RecurringExpense;
  onClose: () => void;
  onSave: (item: RecurringExpense) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const labels = resolveSpecialCategoryLabels(specialCategories);
  const activeTopics = topics.filter((t) => !t.archived).sort((a, b) => a.order - b.order);
  const [amount, setAmount] = useState(initial ? amountToInputValue(initial.amount) : '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<CategoryValue>({
    categoryKind: initial?.categoryKind ?? 'fixedCost',
    topicId: initial?.topicId ?? activeTopics[0]?.id,
  });
  const [card, setCard] = useState(initial?.card ?? false);
  const { cards, defaultCard } = useCards();
  const [cardId, setCardId] = useState<string | undefined>(
    initial ? initial.cardId : (defaultCard?.id ?? undefined),
  );
  const [dueDay, setDueDay] = useState(initial?.dueDay ? String(initial.dueDay) : '');
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [splitting, setSplitting] = useState(Boolean(initial?.installmentCount));
  const [installment, setInstallment] = useState({
    count: String(initial?.installmentCount ?? 10),
    // The template has no date: the first charge is only known when it is launched.
    firstDebitDate: todayISO(),
    accounting: (initial?.installmentAccounting ?? 'upfront') as InstallmentAccounting,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const parsedAmount = parseAmountInput(amount);
  const count = Number.parseInt(installment.count, 10);
  // Parcelar é coisa de cartão: sem ele, o modelo é um gasto comum.
  const canSplit = cardEnabled && card;
  const splitCount = canSplit && splitting ? count : undefined;
  const categoryName =
    category.categoryKind === 'topic'
      ? (activeTopics.find((t) => t.id === category.topicId)?.name ?? 'a categoria')
      : labels[category.categoryKind];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problems: string[] = [];
    if (!(parsedAmount > 0)) problems.push('O valor deve ser maior que zero.');
    if (!description.trim()) problems.push('Escreva uma descrição.');
    if (category.categoryKind === 'topic' && !category.topicId) problems.push('Selecione uma categoria.');
    if (splitCount !== undefined && !(splitCount >= 2 && splitCount <= MAX_INSTALLMENTS)) {
      problems.push(`O número de parcelas vai de 2 a ${MAX_INSTALLMENTS}. Uma vez só: À vista.`);
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? createId(),
        categoryKind: category.categoryKind,
        ...(category.categoryKind === 'topic' ? { topicId: category.topicId } : {}),
        description: description.trim(),
        amount: parsedAmount,
        card,
        ...(card && cardId ? { cardId } : {}),
        ...(splitCount !== undefined
          ? { installmentCount: splitCount, installmentAccounting: installment.accounting }
          : {}),
        ...(dueDay ? { dueDay: Number(dueDay) } : {}),
        tagIds,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open title={initial ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <AmountInput value={amount} onChange={setAmount} autoFocus={!initial} />

        <CategoryPicker
          topics={topics}
          specialCategories={labels}
          value={category}
          onChange={setCategory}
          showReimbursable={showReimbursable}
        />

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Descrição
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex.: Aluguel, internet, faculdade..."
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>

        <label className="text-muted flex flex-col gap-1.5 text-sm font-medium">
          Dia do vencimento
          <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={INPUT}>
            <option value="">Não informar</option>
            {Array.from({ length: MAX_DUE_DAY }, (_, index) => index + 1).map((day) => (
              <option key={day} value={String(day)}>
                Todo dia {day}
              </option>
            ))}
          </select>
        </label>

        {cardEnabled && (
          <label className="text-foreground flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={card}
              onChange={(e) => setCard(e.target.checked)}
              className="border-border h-5 w-5 rounded"
            />
            Esse gasto é pago no cartão?
          </label>
        )}

        {cardEnabled && card && <CardPicker cards={cards} value={cardId} onChange={setCardId} />}

        {canSplit && (
          <div>
            <p className="text-muted mb-2 text-sm font-medium">Como você paga?</p>
            <div className="flex flex-wrap gap-2">
              <Chip label="À vista" selected={!splitting} onClick={() => setSplitting(false)} />
              <Chip label="Parcelado" selected={splitting} onClick={() => setSplitting(true)} />
            </div>
            <p className="text-muted mt-2 text-xs">Ao lançar, já abre parcelado, com o número de vezes.</p>
          </div>
        )}

        {canSplit && splitting && (
          <InstallmentOptions
            value={installment}
            onChange={setInstallment}
            totalAmount={parsedAmount}
            categoryLabel={categoryName}
            purchaseMonth={todayISO().slice(0, 7)}
            withoutFirstDebit
          />
        )}

        <TagPicker kind="expense" value={tagIds} onChange={setTagIds} />

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
