import { formatMonthLabel } from './date';
import { round2 } from './money';
import type { Expense, InstallmentPlan, Month } from './types';

/**
 * Instalment plans, computed — never stored. In the spreadsheet the end date and the number of
 * instalments left were written as plain numbers, so a plan that had already finished stayed on
 * the list forever (correction 15 of the bot spec). Here every one of those numbers comes from
 * the first charge, the count and today's date.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `date` shifted by `months`, clamped to the last day of the target month: 31/01 + 1 month is
 * 28/02, not 03/03. Works on "YYYY-MM-DD" strings, so no time zone is ever involved.
 */
export function addMonthsClamped(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDayOfTarget))}`;
}

/** Every charge date of the plan, oldest first: `addMonths(firstDebitDate, k)` for k = 0..count-1. */
export function installmentDueDates(plan: Pick<InstallmentPlan, 'firstDebitDate' | 'count'>): string[] {
  return Array.from({ length: Math.max(0, plan.count) }, (_, k) =>
    addMonthsClamped(plan.firstDebitDate, k),
  );
}

/**
 * The charges of a plan that still belong to it, as a 1-based inclusive range. A purchase that
 * started before it was registered here leaves its first `paidCount` charges out, and "adiantar
 * parcelas" leaves the last `advancedCount` out. Everything else in this file — the bill, the
 * budget, the debt, the months a purchase touches — works on this range, so a charge that is not
 * in it simply does not exist for the app.
 */
export function activeChargeRange(plan: PlanShape): { first: number; last: number } {
  const first = Math.min(Math.max(0, plan.paidCount ?? 0) + 1, plan.count + 1);
  const last = Math.max(plan.count - Math.max(0, plan.advancedCount ?? 0), first - 1);
  return { first, last };
}

/** Whether charge `number` (1-based) is still the plan's to pay. */
export function isActiveCharge(plan: PlanShape, number: number): boolean {
  const { first, last } = activeChargeRange(plan);
  return number >= first && number <= last;
}

/** How many charges the plan still owns (the ones neither already paid nor brought forward). */
export function activeInstallmentCount(plan: PlanShape): number {
  const { first, last } = activeChargeRange(plan);
  return Math.max(0, last - first + 1);
}

/** The due dates of the charges that still belong to the plan, oldest first. */
export function activeDueDates(plan: PlanShape): string[] {
  return installmentDueDates(plan).filter((_, index) => isActiveCharge(plan, index + 1));
}

/** Everything the charge maths needs: the schedule plus what was taken out of it. */
type PlanShape = Pick<InstallmentPlan, 'firstDebitDate' | 'count'> &
  Partial<Pick<InstallmentPlan, 'paidCount' | 'advancedCount'>>;

/**
 * The value of one instalment, `totalAmount / count`, deliberately **not** rounded: the card debt
 * is the sum of many of them (872,36 in 10× is 87,236 each), and rounding here would drift by
 * cents on every plan. Round only when the instalment becomes an expense or is displayed.
 */
export function installmentAmount(plan: Pick<InstallmentPlan, 'totalAmount' | 'count'>): number {
  if (plan.count <= 0) return 0;
  return plan.totalAmount / plan.count;
}

/** The last charge date the plan still owns ("fim"). */
export function installmentEndDate(plan: PlanShape): string {
  const dates = activeDueDates(plan);
  return dates[dates.length - 1] ?? installmentDueDates(plan).at(-1) ?? plan.firstDebitDate;
}

/** The charges still to come: every due date the plan still owns **after** today (correction 8). */
export function remainingDueDates(plan: PlanShape, todayIso: string): string[] {
  return activeDueDates(plan).filter((due) => due > todayIso);
}

export function remainingInstallments(plan: PlanShape, todayIso: string): number {
  return remainingDueDates(plan, todayIso).length;
}

/** A plan with no charges left. It is not deleted — it moves to the "Encerrados" section. */
export function isInstallmentFinished(plan: PlanShape, todayIso: string): boolean {
  return remainingInstallments(plan, todayIso) === 0;
}

/** Plans ordered the way the bot listed them: fewest instalments left first, then by name. */
export function sortInstallments<T extends InstallmentPlan>(plans: T[], todayIso: string): T[] {
  return [...plans].sort((a, b) => {
    const diff = remainingInstallments(a, todayIso) - remainingInstallments(b, todayIso);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'pt-BR');
  });
}

/** The id the expense of instalment `number` always gets, so launching it twice is impossible. */
export function installmentExpenseId(planId: string, number: number): string {
  return `${planId}:${number}`;
}

/** The competences the charges of `plan` fall in, oldest first and without repeats. */
export function installmentMonths(plan: PlanShape): Month[] {
  const months = new Set(activeDueDates(plan).map((date) => date.slice(0, 7)));
  return [...months].sort();
}

/**
 * Every competence a purchase touches: where its charges fall and, for an "à vista" plan, the
 * month the whole amount lands in the budget. A closed month among them stops the whole
 * operation (see `closedMonthsMessage`).
 */
export function monthsTouchedBy(
  plan: PlanShape & Pick<InstallmentPlan, 'accounting' | 'purchaseDate'>,
): Month[] {
  const months = new Set(installmentMonths(plan));
  if (plan.accounting === 'upfront') months.add(upfrontDate(plan).slice(0, 7));
  return [...months].sort();
}

/**
 * Why a purchase with a charge in a closed month cannot be created, edited or deleted. A closed
 * month is the month's own record: the way through is to reopen it, not to leave the purchase
 * half done, so the app refuses the whole operation and says which months are in the way.
 */
export function closedMonthsMessage(closed: Month[]): string {
  const names = closed.map(formatMonthLabel);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
  const what = closed.length === 1 ? 'um mês fechado' : 'meses fechados';
  return `Esta compra tem parcelas em ${what} (${list}). Reabra o mês para editar.`;
}

/** The instalments of `plan` charged during competence `month` (1-based), if any. */
export function installmentsDueIn(
  plans: InstallmentPlan[],
  month: Month,
): { plan: InstallmentPlan; number: number; dueDate: string }[] {
  const due: { plan: InstallmentPlan; number: number; dueDate: string }[] = [];
  for (const plan of plans) {
    // Only "Parcelada" plans become expenses; an "À vista" plan was already paid in full.
    if (plan.accounting !== 'installment') continue;
    installmentDueDates(plan).forEach((dueDate, index) => {
      if (!isActiveCharge(plan, index + 1)) return;
      if (dueDate.startsWith(month)) due.push({ plan, number: index + 1, dueDate });
    });
  }
  return due;
}

/** The expense that represents one instalment: always a card purchase, in the charge's month. */
export function installmentExpense(plan: InstallmentPlan, number: number, dueDate: string): Expense {
  const expense: Expense = {
    id: installmentExpenseId(plan.id, number),
    categoryKind: plan.categoryKind,
    description: `${plan.name} ${number}/${plan.count}`,
    amount: round2(installmentAmount(plan)),
    date: dueDate,
    singleInstallmentCard: true,
    source: 'installment',
    installmentId: plan.id,
    installmentNumber: number,
  };
  if (plan.cardId) expense.cardId = plan.cardId;
  if (plan.topicId) expense.topicId = plan.topicId;
  if (plan.tagIds?.length) expense.tagIds = [...plan.tagIds];
  return expense;
}

/**
 * The day a list places an expense on. An instalment is dated the day the bank debits it — that
 * is what puts it in its competence — but the person remembers it by the day they bought it, so a
 * purchase made months ago sits down the list, not on the bill's day.
 */
export function expenseListDate(expense: Pick<Expense, 'date' | 'purchaseDate'>): string {
  return expense.purchaseDate ?? expense.date;
}

/** "11/10", or "compra em 15/03" for an instalment bought another day ("15/03/25" in another year). */
export function expenseDayLabel(expense: Pick<Expense, 'date' | 'purchaseDate'>): string {
  const day = (iso: string, withYear: boolean) => {
    const [year, month, date] = iso.split('-');
    return withYear ? `${date}/${month}/${year.slice(2)}` : `${date}/${month}`;
  };
  const purchase = expense.purchaseDate;
  if (!purchase || purchase === expense.date) return day(expense.date, false);
  return `compra em ${day(purchase, purchase.slice(0, 4) !== expense.date.slice(0, 4))}`;
}

/**
 * What the instalment plans still owe, as a negative number: every charge of a competence
 * **later** than the current one, whether or not it already became an expense line.
 *
 * The cut is the competence, not today's date, because everything up to the current competence
 * is already part of a card bill (`cardBills`), and the Reserva de emergência adds the two up —
 * so each real is counted once: open bills + what the instalments will still bring.
 */
export function installmentDebt(plans: InstallmentPlan[], currentMonth: Month): number {
  let total = 0;
  for (const plan of plans) {
    const amount = installmentAmount(plan);
    for (const dueDate of activeDueDates(plan)) {
      if (dueDate.slice(0, 7) > currentMonth) total += amount;
    }
  }
  return -round2(total);
}

/** The day an "à vista" plan's single expense falls on: the purchase, or the first charge. */
export function upfrontDate(plan: Pick<InstallmentPlan, 'purchaseDate' | 'firstDebitDate'>): string {
  return plan.purchaseDate ?? plan.firstDebitDate;
}

/**
 * The single expense an "à vista" plan creates: the whole purchase, in the category, in the
 * month it was bought. It carries `installmentNumber: 0`, which is what tells the bill math to
 * leave it out — it is budget, not a charge the bank makes (see `bill.ts`).
 */
export function upfrontExpense(plan: InstallmentPlan, date = upfrontDate(plan)): Expense {
  const expense: Expense = {
    id: installmentExpenseId(plan.id, 0),
    categoryKind: plan.categoryKind,
    description: plan.name,
    amount: round2(plan.totalAmount),
    date,
    singleInstallmentCard: true,
    source: 'installment',
    installmentId: plan.id,
    installmentNumber: 0,
  };
  if (plan.cardId) expense.cardId = plan.cardId;
  if (plan.topicId) expense.topicId = plan.topicId;
  if (plan.tagIds?.length) expense.tagIds = [...plan.tagIds];
  return expense;
}

// ---------------------------------------------------------------------------
// Adiantar parcelas
// ---------------------------------------------------------------------------

/** What the person tells the app when they pay some of the remaining charges ahead of time. */
export interface AdvanceInput {
  /** How many of the last charges were brought forward (1 .. `remainingInstallments`). */
  count: number;
  /** What was knocked off for paying early; 0 when there was none. */
  discount: number;
  /** The day it was paid, which decides the competence the payment lands in. */
  date: string;
}

/** What the advanced charges were worth before any discount. */
export function advanceTotal(plan: InstallmentPlan, count: number): number {
  return round2(installmentAmount(plan) * Math.max(0, count));
}

/** What was actually paid: the advanced charges minus the discount, never below zero. */
export function advancePaid(plan: InstallmentPlan, input: Pick<AdvanceInput, 'count' | 'discount'>): number {
  return round2(Math.max(0, advanceTotal(plan, input.count) - Math.max(0, input.discount)));
}

/**
 * The plan after the advance: `count` and `totalAmount` are left alone — the purchase cost what
 * it cost, and rewriting them would change the instalment of every charge — and the charges that
 * were brought forward leave through `advancedCount`.
 */
export function advancedPlanOf(plan: InstallmentPlan, count: number): InstallmentPlan {
  const room = activeInstallmentCount(plan);
  return { ...plan, advancedCount: (plan.advancedCount ?? 0) + Math.min(Math.max(0, count), room) };
}

/**
 * The single expense an advance creates: what was paid, on the plan's card, in the competence of
 * the day it was paid.
 *
 * Which category it consumes follows the plan's accounting, and that is the whole point of the
 * distinction: **em parcelas** charged each instalment to the month it fell in, so the charges
 * brought forward have to be charged now instead; **à vista** already counted the whole purchase
 * in the month it was bought, so paying earlier moves no money in the budget — the payment is
 * bill only, which is exactly what "Fora do orçamento" means.
 */
export function advanceExpense(plan: InstallmentPlan, input: AdvanceInput, id: string): Expense {
  const upfront = plan.accounting === 'upfront';
  const expense: Expense = {
    id,
    categoryKind: upfront ? 'uncounted' : plan.categoryKind,
    description: `Adiantamento · ${plan.name}`,
    amount: advancePaid(plan, input),
    date: input.date,
    singleInstallmentCard: true,
    source: 'installment',
  };
  if (plan.cardId) expense.cardId = plan.cardId;
  if (!upfront && plan.topicId) expense.topicId = plan.topicId;
  if (plan.tagIds?.length) expense.tagIds = [...plan.tagIds];
  return expense;
}

/**
 * Why an advance cannot be made, or null when it can. Only charges that have not fallen due yet
 * can be brought forward — the ones already on a bill were charged, discount or not.
 */
export function advanceProblem(
  plan: InstallmentPlan,
  input: Pick<AdvanceInput, 'count' | 'discount'>,
  todayIso: string,
): string | null {
  const available = remainingInstallments(plan, todayIso);
  if (available === 0) return 'Esta compra não tem parcelas a vencer para adiantar.';
  if (!Number.isInteger(input.count) || input.count < 1) return 'Escolha quantas parcelas você adiantou.';
  if (input.count > available) {
    return available === 1
      ? 'Só falta uma parcela a vencer nesta compra.'
      : `Faltam ${available} parcelas a vencer nesta compra.`;
  }
  if (input.discount < 0) return 'O desconto não pode ser negativo.';
  if (input.discount > advanceTotal(plan, input.count)) {
    return 'O desconto não pode passar das parcelas adiantadas.';
  }
  return null;
}
