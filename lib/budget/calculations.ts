import { resolveTopicColor, withCurrentTopicDisplay } from './colors';
import { currentMonthKey } from './date';
import { round2, sum } from './money';
import { topicDescription } from './topics';
import type { Expense, Income, MonthData, TopicConfig } from './types';

export interface TopicResult {
  topicId: string;
  name: string;
  /** What the category is for (see `topicDescription`). */
  description: string;
  /**
   * Archived, but kept in this month because it already has expenses in it. It gets no share of
   * the income and is gone from the next month on.
   */
  archived: boolean;
  targetPct: number;
  /** This topic's share of the incomes split by % ("Renda total × %"). */
  incomeShare: number;
  /** Incomes sent to this topic alone ("Uma categoria só"), which skip the %. */
  directIncome: number;
  /** Hex color for this category (from config, or a palette default). */
  color: string;
  /** Money spent in this topic this month ("Valor Gasto"). */
  spent: number;
  /** Rollover from the previous month ("Mês passado"). */
  carryIn: number;
  /** This topic's share of fixed costs + unforeseen expenses ("Imprevistos e custos fixos"). */
  proportionalFixed: number;
  /** How much can still be spent in this topic this month ("Posso gastar"). */
  available: number;
  /** available - spent ("Sobra"). Becomes next month's carryIn once this month is closed. */
  remaining: number;
  /** spent / available, or null when available <= 0 ("Utilizada"). */
  usedPct: number | null;
}

export interface MonthSummary {
  month: string;
  incomeTotal: number;
  fixedTotal: number;
  unforeseenTotal: number;
  /** Everything that will land on the credit-card bill: purchases flagged as card purchases. */
  cardTotal: number;
  /** Card purchases made for someone else ("A receber"): part of cardTotal, never of expenseTotal. */
  reimbursableTotal: number;
  /** The part of `reimbursableTotal` nobody has paid back yet. */
  reimbursablePendingTotal: number;
  /** Money the person chose to leave out of the budget ("Fora do orçamento"): never of expenseTotal. */
  uncountedTotal: number;
  /** Total money spent across all topics plus fixed costs and unforeseen. */
  expenseTotal: number;
  /** Sum of available(t) across all topics. */
  availableTotal: number;
  /** Sum of remaining(t) across all topics ("Saldo geral"). */
  balance: number;
  topics: TopicResult[];
}

export function computeIncomeTotal(monthData: Pick<MonthData, 'incomes'>): number {
  return sum(monthData.incomes.map((income) => income.amount));
}

/**
 * The part of the income that is split across the categories by %: every income except the ones
 * sent to a single category. An income sent to a category that is not in the month (archived
 * before it had anything in it) is split too, so no money ever vanishes from the budget.
 */
export function computeSplitIncomeTotal(
  incomes: Income[],
  topicIds: ReadonlySet<string>,
): number {
  return sum(
    incomes.filter((i) => !i.topicId || !topicIds.has(i.topicId)).map((income) => income.amount),
  );
}

/** Incomes sent to one category alone ("Uma categoria só"). */
export function computeDirectIncome(incomes: Income[], topicId: string): number {
  return sum(incomes.filter((i) => i.topicId === topicId).map((income) => income.amount));
}

export function computeFixedTotal(expenses: Expense[]): number {
  return sum(expenses.filter((e) => e.categoryKind === 'fixedCost').map((e) => e.amount));
}

export function computeUnforeseenTotal(expenses: Expense[]): number {
  return sum(expenses.filter((e) => e.categoryKind === 'unforeseen').map((e) => e.amount));
}

/**
 * Money paid for someone else who will pay it back ("A receber"). It is on the card bill,
 * but it is not money the user spent: it stays out of every category, out of the fixed-cost
 * apportionment and out of expenseTotal.
 */
export function computeReimbursableTotal(expenses: Expense[]): number {
  return sum(expenses.filter((e) => e.categoryKind === 'reimbursable').map((e) => e.amount));
}

/** What is still owed back: the "A receber" purchases nobody has settled yet. */
export function computeReimbursablePendingTotal(expenses: Expense[]): number {
  return sum(
    expenses.filter((e) => e.categoryKind === 'reimbursable' && !e.reimbursedAt).map((e) => e.amount),
  );
}

/**
 * Money the person deliberately left out of the budget ("Fora do orçamento"). Like "A receber",
 * it stays out of every category, out of the fixed-cost apportionment and out of expenseTotal —
 * the difference is that this one really was spent, which is why the app discourages it.
 */
export function computeUncountedTotal(expenses: Expense[]): number {
  return sum(expenses.filter((e) => e.categoryKind === 'uncounted').map((e) => e.amount));
}

/** Everything that will show up on the credit-card bill: any expense flagged as a card purchase. */
export function computeCardTotal(expenses: Expense[]): number {
  return sum(expenses.filter((e) => e.singleInstallmentCard === true).map((e) => e.amount));
}

/** Money spent in a topic this month. */
export function computeTopicSpent(expenses: Expense[], topicId: string): number {
  return sum(
    expenses.filter((e) => e.categoryKind === 'topic' && e.topicId === topicId).map((e) => e.amount),
  );
}

export function computeProportionalFixed(
  fixedTotal: number,
  unforeseenTotal: number,
  targetPct: number,
): number {
  return round2((fixedTotal + unforeseenTotal) * targetPct);
}

export function computeAvailable(
  incomeTotal: number,
  targetPct: number,
  proportionalFixed: number,
  carryIn: number,
  directIncome = 0,
): number {
  return round2(incomeTotal * targetPct - proportionalFixed + carryIn + directIncome);
}

export function computeRemaining(available: number, spent: number): number {
  return round2(available - spent);
}

/** null represents the spreadsheet's "—" state, shown when available(t) <= 0. */
export function computeUsedPct(spent: number, available: number): number | null {
  if (available <= 0) return null;
  return spent / available;
}

/**
 * `incomeTotal` is the income split by % (see `computeSplitIncomeTotal`); `directIncome` is what
 * was sent to this topic alone.
 */
export function computeTopicResult(
  topic: TopicConfig,
  expenses: Expense[],
  incomeTotal: number,
  fixedTotal: number,
  unforeseenTotal: number,
  carryIn: number,
  color: string,
  directIncome = 0,
): TopicResult {
  const spent = computeTopicSpent(expenses, topic.id);
  const proportionalFixed = computeProportionalFixed(fixedTotal, unforeseenTotal, topic.targetPct);
  const available = computeAvailable(
    incomeTotal,
    topic.targetPct,
    proportionalFixed,
    carryIn,
    directIncome,
  );
  const remaining = computeRemaining(available, spent);
  const usedPct = computeUsedPct(spent, available);

  return {
    topicId: topic.id,
    name: topic.name,
    description: topicDescription(topic),
    archived: topic.archived === true,
    targetPct: topic.targetPct,
    incomeShare: round2(incomeTotal * topic.targetPct),
    directIncome,
    color,
    spent,
    carryIn,
    proportionalFixed,
    available,
    remaining,
    usedPct,
  };
}

/**
 * Computes the full summary for a month from its raw data. Pure: no I/O, no React.
 *
 * `currentTopics` (the live settings) always refreshes each topic's **name and
 * color**, so renaming or recoloring a category in Settings shows everywhere
 * immediately — that's purely cosmetic. `targetPct` (the percentage that drives
 * "posso gastar") is only refreshed for the current month and future months:
 * changing a percentage in Settings updates what you can still spend this month
 * and going forward, but a month that has already passed keeps the math it had
 * — its snapshot stays frozen. Topics no longer in settings keep their
 * snapshot name/color/targetPct either way.
 *
 * Archiving a category also applies to the current and future months, with one
 * exception: a month that already has expenses (or an income sent to it alone) keeps
 * it, with a 0% target, so nothing already spent or received vanishes from the totals.
 */
export function computeMonthSummary(
  monthData: MonthData,
  currentTopics?: readonly TopicConfig[],
): MonthSummary {
  const isPastMonth = monthData.month < currentMonthKey();
  const displayTopics = withCurrentTopicDisplay(monthData.topicsSnapshot, currentTopics, !isPastMonth);
  const hasEntries = (topicId: string) =>
    monthData.expenses.some((e) => e.categoryKind === 'topic' && e.topicId === topicId) ||
    monthData.incomes.some((i) => i.topicId === topicId);
  const activeTopics = displayTopics
    .filter((t) => !t.archived || (!isPastMonth && hasEntries(t.id)))
    .map((t) => (t.archived ? { ...t, targetPct: 0 } : t));
  const incomeTotal = computeIncomeTotal(monthData);
  const splitIncomeTotal = computeSplitIncomeTotal(
    monthData.incomes,
    new Set(activeTopics.map((t) => t.id)),
  );
  const fixedTotal = computeFixedTotal(monthData.expenses);
  const unforeseenTotal = computeUnforeseenTotal(monthData.expenses);
  const cardTotal = computeCardTotal(monthData.expenses);
  const reimbursableTotal = computeReimbursableTotal(monthData.expenses);
  const reimbursablePendingTotal = computeReimbursablePendingTotal(monthData.expenses);
  const uncountedTotal = computeUncountedTotal(monthData.expenses);

  const topics = activeTopics
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((topic, index) =>
      computeTopicResult(
        topic,
        monthData.expenses,
        splitIncomeTotal,
        fixedTotal,
        unforeseenTotal,
        monthData.carryIn[topic.id] ?? 0,
        resolveTopicColor(topic, index),
        computeDirectIncome(monthData.incomes, topic.id),
      ),
    );

  const expenseTotal = round2(fixedTotal + unforeseenTotal + sum(topics.map((t) => t.spent)));
  const availableTotal = sum(topics.map((t) => t.available));
  const balance = sum(topics.map((t) => t.remaining));

  return {
    month: monthData.month,
    incomeTotal,
    fixedTotal,
    unforeseenTotal,
    cardTotal,
    reimbursableTotal,
    reimbursablePendingTotal,
    uncountedTotal,
    expenseTotal,
    availableTotal,
    balance,
    topics,
  };
}

export type ProgressState = 'ok' | 'warning' | 'danger';

/** Green < 80%, yellow 80-100%, red > 100% or available <= 0. */
export function computeProgressState(usedPct: number | null): ProgressState {
  if (usedPct === null) return 'danger';
  if (usedPct > 1) return 'danger';
  if (usedPct >= 0.8) return 'warning';
  return 'ok';
}
