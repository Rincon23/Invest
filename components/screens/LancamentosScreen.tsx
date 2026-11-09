'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ListFilter, X } from 'lucide-react';
import { useMissions } from '@/components/missions/MissionsProvider';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { CategoriesSettings } from '@/components/settings/CategoriesSettings';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { ClosedMonthBanner } from '@/components/month/ClosedMonthBanner';
import { MONTH_ACTIONS_PADDING, MonthActions } from '@/components/month/MonthActions';
import { useMonthContext } from '@/components/month/MonthContext';
import { MonthSwipe } from '@/components/month/MonthSwipe';
import { MonthSwitcher } from '@/components/month/MonthSwitcher';
import { PageHeader } from '@/components/layout/PageHeader';
import { useSettings } from '@/components/providers/SettingsProvider';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { TagsSettings } from '@/components/tags/TagsSettings';
import { TagDot, TagPills } from '@/components/tags/TagPills';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import {
  expenseDayLabel,
  expenseListDate,
  formatBRL,
  formatMonthLabel,
  formatMonthShort,
  expenseMatches,
  incomeMatches,
  tagColor,
  tagsOfKind,
  REIMBURSABLE_EXPLANATION,
  UNCOUNTED_ADVICE,
  UNCOUNTED_EXPLANATION,
  resolveSpecialCategoryLabels,
  specialCategoryLabel,
  sum,
  type CategoryKind,
  type Expense,
  type Income,
  type Month,
  type QuickCategoryKey,
  type TopicConfig,
} from '@/lib/budget';
import { isModuleOn } from '@/lib/modules';
import { usePendingReimbursables } from '@/lib/hooks/usePendingReimbursables';
import { setReimbursed } from '@/lib/storage';

/**
 * Two tabs: every expense of the month in one list ("Gastos"), and the income ("Renda"). Which
 * categories the list shows is a filter, not a tab — the person sees everything first and narrows
 * it down to "só Metas" (or "só Custos Fixos e Imprevistos") when they want to. Tags filter both
 * tabs the same way ("Mercado" shows what went to the supermarket, and the total line says how
 * much); categories and tags together means both ("Prazeres e Confortos" with "Restaurante").
 */
type TabKey = 'expenses' | 'income';

/** A category of the filter: `topic:<id>` or a special kind (the same keys as the expense form). */
export type LancamentosFilter = QuickCategoryKey;

function topicName(topics: { id: string; name: string }[], topicId?: string): string {
  return topics.find((t) => t.id === topicId)?.name ?? '—';
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function LancamentosScreen({
  initialFilter,
  initialTags,
}: {
  initialFilter?: LancamentosFilter;
  /** Tags already chosen (`?tags=`): the filter goes along when the month changes. */
  initialTags?: string[];
}) {
  return (
    <ModuleGate module="expenses">
      <Lancamentos initialFilter={initialFilter} initialTags={initialTags} />
    </ModuleGate>
  );
}

function Lancamentos({
  initialFilter,
  initialTags,
}: {
  initialFilter?: LancamentosFilter;
  initialTags?: string[];
}) {
  const backHref = useHomeHref();
  const { month, monthData, loading, error, openExpenseForm, openIncomeForm, deleteMonth, refresh } =
    useMonthContext();
  const router = useRouter();
  const { settings } = useSettings();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [tab, setTab] = useState<TabKey>('expenses');
  const [filter, setFilter] = useState<LancamentosFilter[]>(initialFilter ? [initialFilter] : []);
  /** Tag ids of either kind: the tab on screen uses the ones of its own kind. */
  const [tagFilter, setTagFilter] = useState<string[]>(initialTags ?? []);
  const [filtering, setFiltering] = useState(false);
  const [search, setSearch] = useState('');
  const [configuring, setConfiguring] = useState(false);
  useModuleIntro('expenses', { ready: !loading && !!monthData && !!settings });

  // "Conhecer A receber", of the Missões: done by opening the list filtered to it (below).
  const { visit } = useMissions();

  // A link to "?aba=…" while the screen is already open (the "A receber" tour) sets the filter.
  useEffect(() => {
    if (!initialFilter) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab('expenses');
    setFilter([initialFilter]);
  }, [initialFilter]);

  const labels = resolveSpecialCategoryLabels(settings?.specialCategories);
  // The "A receber" tab shows while the module is on, and also when the month still has such
  // expenses from before it was turned off — so they never become unreachable.
  const showReimbursable =
    isModuleOn(settings, 'reimbursable') ||
    (monthData?.expenses.some((e) => e.categoryKind === 'reimbursable') ?? false);
  // "Fora do orçamento" is never advertised: the tab only shows up once the month has one.
  const showUncounted = monthData?.expenses.some((e) => e.categoryKind === 'uncounted') ?? false;

  /** Every topic this month can mention: today's ones and the ones it was recorded with. */
  const allTopics: TopicConfig[] = [
    ...(settings?.topics ?? []),
    ...(monthData?.topicsSnapshot ?? []).filter(
      (t) => !settings?.topics.some((current) => current.id === t.id),
    ),
  ];

  /** What the filter offers: the active categories (and any other this month used), then the special ones. */
  const filterOptions: { key: LancamentosFilter; label: string }[] = [
    ...allTopics
      .filter(
        (topic) =>
          !topic.archived ||
          (monthData?.expenses.some((e) => e.categoryKind === 'topic' && e.topicId === topic.id) ?? false),
      )
      .sort((a, b) => a.order - b.order)
      .map((topic) => ({ key: `topic:${topic.id}` as const, label: topic.name })),
    { key: 'fixedCost', label: labels.fixedCost },
    { key: 'unforeseen', label: labels.unforeseen },
    ...(showReimbursable ? [{ key: 'reimbursable' as const, label: labels.reimbursable }] : []),
    ...(showUncounted ? [{ key: 'uncounted' as const, label: labels.uncounted }] : []),
  ];
  const filterLabel = (key: LancamentosFilter) =>
    filterOptions.find((option) => option.key === key)?.label ?? '—';
  const expenseTags = useMemo(() => tagsOfKind(settings?.tags, 'expense'), [settings?.tags]);
  const incomeTags = useMemo(() => tagsOfKind(settings?.tags, 'income'), [settings?.tags]);
  const tabTags = tab === 'income' ? incomeTags : expenseTags;
  const expenseTagFilter = useMemo(
    () => tagFilter.filter((id) => expenseTags.some((tag) => tag.id === id)),
    [tagFilter, expenseTags],
  );
  const incomeTagFilter = useMemo(
    () => tagFilter.filter((id) => incomeTags.some((tag) => tag.id === id)),
    [tagFilter, incomeTags],
  );
  const tabTagFilter = tab === 'income' ? incomeTagFilter : expenseTagFilter;
  const onlyReimbursable = filter.length === 1 && filter[0] === 'reimbursable';
  useEffect(() => {
    if (onlyReimbursable) visit('meet-reimbursable');
  }, [onlyReimbursable, visit]);
  // "A receber" is not only this month's: what someone still owes from before comes along.
  const owed = usePendingReimbursables(month, onlyReimbursable, monthData);
  // Earlier months' entries marked as paid here: they stay in "Já me pagaram" (to undo) for now.
  const [paidHere, setPaidHere] = useState<{ month: Month; expense: Expense; seenIn: Month }[]>([]);
  const onlyUncounted = filter.length === 1 && filter[0] === 'uncounted';

  // Newest first, also within a day: the month keeps entries in the order they were made, so
  // reversed before the (stable) sort by day, the last one made tops its day.
  const filteredExpenses = useMemo(() => {
    if (!monthData) return [];
    const by = { categories: filter, tagIds: expenseTagFilter, search, tags: settings?.tags };
    return [...monthData.expenses]
      .reverse()
      .filter((e) => expenseMatches(e, by))
      .sort((a, b) => expenseListDate(b).localeCompare(expenseListDate(a)));
  }, [monthData, filter, expenseTagFilter, search, settings?.tags]);

  const filteredIncomes = useMemo(() => {
    if (!monthData) return [];
    const by = { tagIds: incomeTagFilter, search, tags: settings?.tags };
    return [...monthData.incomes]
      .reverse()
      .filter((i) => incomeMatches(i, by))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [monthData, incomeTagFilter, search, settings?.tags]);

  const header = (
    <PageHeader
      title="Lançamentos"
      subtitle={formatMonthLabel(month)}
      backHref={backHref}
      action={
        <>
          <ModuleHelpButton module="expenses" />
          <ModuleSettingsButton
            module="expenses"
            tourAnchor="lancamentos-config"
            onClick={() => setConfiguring(true)}
          />
        </>
      }
    />
  );
  const switcher = (
    <div data-tour="lancamentos-mes">
      <MonthSwitcher month={month} path="/lancamentos" />
    </div>
  );
  /** Swiping sideways (or the ‹ ›) goes to the same list of the other month, with the same tags. */
  const changeMonth = (next: Month) =>
    router.replace(
      `/mes/${next}/lancamentos${tagFilter.length > 0 ? `?tags=${tagFilter.map(encodeURIComponent).join(',')}` : ''}`,
    );

  if (loading || !monthData || !settings) {
    return (
      <div className={`flex flex-1 flex-col gap-3 ${MONTH_ACTIONS_PADDING}`}>
        {header}
        <MonthSwipe month={month} onMonth={changeMonth} className="flex flex-col gap-3">
          <div className="px-4">{switcher}</div>
          <p className="text-muted py-16 text-center">Carregando…</p>
        </MonthSwipe>
      </div>
    );
  }

  async function handleDeleteMonth() {
    const confirmed = await confirm({
      title: `Apagar ${formatMonthLabel(month)}`,
      message: `Apaga os lançamentos de ${formatMonthLabel(month)}. Não dá para desfazer.`,
      confirmLabel: 'Apagar',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    try {
      await deleteMonth();
      showToast('Lançamentos apagados.');
    } catch {
      showToast('Não foi possível concluir esta operação. Tente de novo.', 'error');
    }
  }

  function handleEditExpense(expense: Expense) {
    openExpenseForm(expense);
  }

  /**
   * "Já me pagou". It changes no number in the budget — an "A receber" purchase never consumed a
   * category — it only takes the entry out of what other people still owe.
   */
  async function toggleReimbursed(entryMonth: Month, expense: Expense) {
    const settled = Boolean(expense.reimbursedAt);
    try {
      const reimbursedAt = settled ? null : new Date().toISOString();
      await setReimbursed(entryMonth, expense.id, reimbursedAt);
      if (entryMonth !== month) {
        setPaidHere((current) => [
          ...current.filter((entry) => entry.expense.id !== expense.id),
          ...(reimbursedAt
            ? [{ month: entryMonth, expense: { ...expense, reimbursedAt }, seenIn: month }]
            : []),
        ]);
      }
      await Promise.all([refresh(), owed.reload()]);
      showToast(settled ? 'Marcado como ainda a receber.' : 'Marcado como recebido.');
    } catch {
      showToast('Não foi possível salvar. Tente de novo.', 'error');
    }
  }

  /** The list of "A receber": owed from any month up to this one, and what this month got back. */
  const matches = (expense: Expense) =>
    expenseMatches(expense, { tagIds: expenseTagFilter, search, tags: settings.tags });
  const owedEntries = (owed.pending ?? []).filter((entry) => matches(entry.expense));
  const paidEntries = [
    ...filteredExpenses.filter((expense) => expense.reimbursedAt).map((expense) => ({ month, expense })),
    ...paidHere
      .filter((entry) => entry.seenIn === month && matches(entry.expense))
      .map(({ month: entryMonth, expense }) => ({ month: entryMonth, expense })),
  ];
  // What the filter's button promises: with "A receber" alone, what earlier months still owe counts too.
  const filterCount =
    tab === 'income'
      ? filteredIncomes.length
      : onlyReimbursable
        ? owedEntries.length + paidEntries.length
        : filteredExpenses.length;
  /** How many filters the tab on screen has on: its categories (Gastos only) and its tags. */
  const activeFilters = (tab === 'expenses' ? filter.length : 0) + tabTagFilter.length;
  const tagName = (id: string) => tabTags.find((tag) => tag.id === id)?.name ?? '—';

  function handleEditIncome(income: Income) {
    openIncomeForm(income);
  }

  function toggleFilter(key: LancamentosFilter) {
    setFilter((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function toggleTag(id: string) {
    setTagFilter((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  /** "Ver todos": every filter of the tab on screen goes. */
  function clearFilters() {
    if (tab === 'expenses') setFilter([]);
    setTagFilter((current) => current.filter((id) => !tabTags.some((tag) => tag.id === id)));
  }

  function expenseCategory(expense: Expense): string {
    return expense.categoryKind === 'topic'
      ? topicName(allTopics, expense.topicId)
      : specialCategoryLabel(expense.categoryKind, labels);
  }

  const shownCount = tab === 'income' ? filteredIncomes.length : filteredExpenses.length;
  const shownTotal = sum(
    tab === 'income' ? filteredIncomes.map((i) => i.amount) : filteredExpenses.map((e) => e.amount),
  );
  const single = filter.length === 1 ? filter[0] : undefined;
  const defaultKind: CategoryKind | undefined =
    tab === 'income' || !single
      ? undefined
      : single.startsWith('topic:')
        ? 'topic'
        : (single as CategoryKind);

  return (
    <div className={`flex flex-1 flex-col gap-3 ${MONTH_ACTIONS_PADDING}`}>
      {header}

      <MonthSwipe month={month} onMonth={changeMonth} className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 px-4">
          {switcher}
          {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}
          <ClosedMonthBanner />
        </div>

        <div className="px-4" data-tour="lancamentos-abas">
          <div role="tablist" className="bg-card border-border grid grid-cols-2 gap-1 rounded-xl border p-1">
            {(
              [
                ['expenses', 'Gastos'],
                ['income', 'Renda'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  tab === key ? 'bg-primary text-primary-foreground' : 'text-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 px-4" data-tour="lancamentos-busca">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'income' ? 'Buscar pela fonte ou tag...' : 'Buscar pela descrição ou tag...'}
            className="border-border bg-card text-foreground focus:ring-primary min-h-[44px] min-w-0 flex-1 rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
          <button
            type="button"
            onClick={() => setFiltering(true)}
            aria-label={
              tab === 'income'
                ? activeFilters > 0
                  ? `Filtrar por tag (${activeFilters} escolhidas)`
                  : 'Filtrar por tag'
                : activeFilters > 0
                  ? `Filtrar por categoria ou tag (${activeFilters} escolhidas)`
                  : 'Filtrar por categoria ou tag'
            }
            data-tour="lancamentos-filtro"
            className={`relative flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
              activeFilters > 0
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-foreground'
            }`}
          >
            <ListFilter aria-hidden className="h-5 w-5" />
            Filtrar
            {activeFilters > 0 && (
              <span className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {activeFilters > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4" data-no-swipe-nav>
            {(tab === 'expenses' ? filter : []).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                aria-label={`Tirar ${filterLabel(key)} do filtro`}
                data-tour={key === 'reimbursable' ? 'aba-a-receber' : undefined}
                className="bg-primary text-primary-foreground flex min-h-[32px] items-center gap-1 rounded-full pr-2 pl-3 text-sm font-medium"
              >
                {filterLabel(key)}
                <X aria-hidden className="h-4 w-4" />
              </button>
            ))}
            {tabTagFilter.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleTag(id)}
                aria-label={`Tirar a tag ${tagName(id)} do filtro`}
                className="border-primary text-primary bg-primary/10 flex min-h-[32px] items-center gap-1.5 rounded-full border pr-2 pl-3 text-sm font-medium"
              >
                <TagDot tag={tabTags.find((tag) => tag.id === id) ?? { order: 0 }} />
                {tagName(id)}
                <X aria-hidden className="h-4 w-4" />
              </button>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="text-muted hover:text-foreground min-h-[32px] px-1 text-sm font-medium underline underline-offset-2"
            >
              Ver todos
            </button>
          </div>
        )}

        {tab === 'expenses' && onlyReimbursable && (
          <div className="bg-card border-border mx-4 flex flex-col gap-1 rounded-xl border px-4 py-3">
            <p className="text-muted text-sm">{REIMBURSABLE_EXPLANATION}</p>
            <div>
              <ModuleHelpButton module="reimbursable" variant="link" label="Como funciona A receber?" />
            </div>
          </div>
        )}

        {tab === 'expenses' && onlyUncounted && (
          <div className="bg-warning-bg mx-4 flex flex-col gap-1 rounded-xl px-4 py-3">
            <p className="text-warning text-sm font-semibold">{UNCOUNTED_ADVICE}</p>
            <p className="text-muted text-sm">{UNCOUNTED_EXPLANATION}</p>
          </div>
        )}

        {shownCount > 0 && !(tab === 'expenses' && onlyReimbursable) && (
          <p className="text-muted flex items-baseline justify-between px-4 text-sm">
            <span>
              {shownCount}{' '}
              {tab === 'income'
                ? shownCount === 1
                  ? 'renda'
                  : 'rendas'
                : shownCount === 1
                  ? 'gasto'
                  : 'gastos'}
            </span>
            <span className="text-foreground font-semibold tabular-nums">{formatBRL(shownTotal)}</span>
          </p>
        )}

        {tab === 'expenses' && onlyReimbursable && owed.error && (
          <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{owed.error}</p>
        )}

        {tab === 'expenses' && onlyReimbursable && owedEntries.length + paidEntries.length > 0 ? (
          <ReimbursableList
            month={month}
            owed={owedEntries}
            paid={paidEntries}
            onEdit={(entry) =>
              entry.month === month
                ? handleEditExpense(entry.expense)
                : router.push(`/mes/${entry.month}/lancamentos?aba=a-receber`)
            }
            onToggle={(entry) => void toggleReimbursed(entry.month, entry.expense)}
          />
        ) : (
          <ul className="flex flex-col gap-2 px-4">
            {tab === 'income'
              ? filteredIncomes.map((income) => (
                  <li key={income.id}>
                    <button
                      type="button"
                      onClick={() => handleEditIncome(income)}
                      className="border-border bg-card flex min-h-[56px] w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left shadow-sm"
                    >
                      <span className="min-w-0">
                        <span className="text-foreground block truncate font-medium">{income.source}</span>
                        {(income.date || income.topicId || (income.tagIds?.length ?? 0) > 0) && (
                          <span className="text-muted flex flex-wrap items-center gap-x-1 text-xs">
                            <span>
                              {[
                                income.date && formatDate(income.date),
                                income.topicId && `Só ${topicName(settings.topics, income.topicId)}`,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            <TagPills tagIds={income.tagIds} tags={incomeTags} />
                          </span>
                        )}
                      </span>
                      <span className="text-success font-semibold">{formatBRL(income.amount)}</span>
                    </button>
                  </li>
                ))
              : filteredExpenses.map((expense) => (
                  <li key={expense.id}>
                    <button
                      type="button"
                      onClick={() => handleEditExpense(expense)}
                      className="border-border bg-card flex min-h-[56px] w-full items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left shadow-sm"
                    >
                      <span className="min-w-0">
                        <span className="text-foreground block truncate font-medium">
                          {expense.description}
                        </span>
                        <span className="text-muted flex flex-wrap items-center gap-x-1 text-xs">
                          <span className="min-w-0">
                            {expenseDayLabel(expense)} · {expenseCategory(expense)}
                          </span>
                          <TagPills tagIds={expense.tagIds} tags={expenseTags} />
                        </span>
                      </span>
                      <span className="text-foreground font-semibold">{formatBRL(expense.amount)}</span>
                    </button>
                  </li>
                ))}

            {(tab === 'income' ? filteredIncomes.length : filteredExpenses.length) === 0 && (
              <p className="text-muted py-10 text-center text-sm">Nenhum lançamento encontrado.</p>
            )}
          </ul>
        )}

        {(monthData.expenses.length > 0 || monthData.incomes.length > 0) && (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={() => void handleDeleteMonth()}
              className="border-danger text-danger min-h-[44px] w-full rounded-lg border px-4 text-sm font-semibold"
            >
              Apagar dados de {formatMonthLabel(month)}
            </button>
          </div>
        )}
      </MonthSwipe>

      <MonthActions defaultCategoryKind={defaultKind} />

      {filtering && (
        <BottomSheet
          open
          title={tab === 'income' ? 'Filtrar rendas' : 'Filtrar gastos'}
          onClose={() => setFiltering(false)}
        >
          <div className="flex flex-col gap-4">
            {tab === 'expenses' && (
              <>
                <p className="text-muted text-sm">Categorias:</p>
                <div className="flex flex-wrap gap-2">
                  {filterOptions.map((option) => (
                    <Chip
                      key={option.key}
                      label={option.label}
                      selected={filter.includes(option.key)}
                      onClick={() => toggleFilter(option.key)}
                    />
                  ))}
                </div>
              </>
            )}
            <p className="text-muted text-sm">Tags:</p>
            {tabTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tabTags.map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    dotColor={tagColor(tag)}
                    selected={tagFilter.includes(tag.id)}
                    onClick={() => toggleTag(tag.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted text-xs">
                Nenhuma tag {tab === 'income' ? 'de renda' : 'de gasto'} ainda. Crie no formulário ou na
                engrenagem.
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={clearFilters}
                disabled={activeFilters === 0}
                className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
              >
                Ver todos
              </button>
              <button
                type="button"
                onClick={() => setFiltering(false)}
                className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 text-sm font-semibold"
              >
                Mostrar {filterCount}{' '}
                {tab === 'income'
                  ? filterCount === 1
                    ? 'renda'
                    : 'rendas'
                  : filterCount === 1
                    ? 'gasto'
                    : 'gastos'}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {configuring && (
        <ModuleSettingsSheet module="expenses" onClose={() => setConfiguring(false)}>
          <CategoriesSettings withTargets={false} onSaved={() => setConfiguring(false)} />
          <TagsSettings />
        </ModuleSettingsSheet>
      )}
    </div>
  );
}

interface ReimbursableEntry {
  month: Month;
  expense: Expense;
}

/**
 * "A receber", split by who already paid. The tick is the whole point of the list: the money is
 * on the card bill either way, so the only thing the person is tracking here is who still owes
 * them — and that has to be one tap, not a trip through the expense form. What is still owed from
 * earlier months stays here, marked with its month, until someone pays it back.
 */
function ReimbursableList({
  month,
  owed,
  paid,
  onEdit,
  onToggle,
}: {
  month: Month;
  owed: ReimbursableEntry[];
  paid: ReimbursableEntry[];
  onEdit: (entry: ReimbursableEntry) => void;
  onToggle: (entry: ReimbursableEntry) => void;
}) {
  const total = (list: ReimbursableEntry[]) => list.reduce((sum, entry) => sum + entry.expense.amount, 0);

  function group(title: string, list: ReimbursableEntry[], done: boolean) {
    if (list.length === 0) return null;
    return (
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-muted text-sm font-semibold">{title}</h2>
          <span className={`text-sm font-semibold ${done ? 'text-success' : 'text-foreground'}`}>
            {formatBRL(total(list))}
          </span>
        </div>
        <ul className="flex flex-col gap-2">
          {list.map((entry) => {
            const { expense } = entry;
            const earlier = entry.month !== month;
            return (
              <li
                key={expense.id}
                className="border-border bg-card flex items-center gap-2 rounded-xl border pr-4 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onToggle(entry)}
                  aria-pressed={done}
                  aria-label={
                    done ? `Desmarcar ${expense.description}` : `${expense.description}: já me pagou`
                  }
                  className="flex h-14 w-14 shrink-0 items-center justify-center"
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      done
                        ? 'border-success bg-success text-primary-foreground'
                        : 'border-border text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                </button>
                <button type="button" onClick={() => onEdit(entry)} className="min-w-0 flex-1 py-3 text-left">
                  <span className={`block truncate font-medium ${done ? 'text-muted' : 'text-foreground'}`}>
                    {expense.description}
                  </span>
                  <span className="text-muted block text-xs">
                    {formatDate(expense.date)}
                    {earlier && (
                      <span className="bg-warning-bg text-warning ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold">
                        de {formatMonthShort(entry.month)}
                      </span>
                    )}
                    {expense.reimbursedAt &&
                      ` · recebido em ${formatDate(expense.reimbursedAt.slice(0, 10))}`}
                  </span>
                </button>
                <span className={`shrink-0 font-semibold ${done ? 'text-muted' : 'text-foreground'}`}>
                  {formatBRL(expense.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      {group('Ainda devem', owed, false)}
      {group('Já me pagaram', paid, true)}
    </div>
  );
}
