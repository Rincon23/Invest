import { UNASSIGNED_CARD_ID, type CardBillTotal } from './cards';
import { installmentAmount, installmentDueDates, isActiveCharge } from './installments';
import { round2, sum } from './money';
import type { Expense, InstallmentPlan, Month } from './types';

/**
 * What a bill is worth — which is **not** the same thing as what was spent.
 *
 * - **Fatura**: what the bank charges in a competence. It is always the instalment, whatever the
 *   plan does to the budget; a purchase in 1× is simply the case of a single instalment.
 * - **Orçamento**: what eats into a category, which is the expense line (see `calculations.ts`).
 *
 * ```
 * fatura(cartão, competência) =
 *     Σ expense lines of that competence on that card that did not come from a plan
 *   + Σ expense lines that are one instalment (the line's amount, so a hand-edited month counts
 *       as the person left it)
 *   + Σ charges of that competence that have no line yet (a month nobody opened, or an
 *       "à vista" plan, which never creates instalment lines)
 *   − the single expense of an "à vista" plan (that one is budget, never bill)
 * ```
 *
 * The last two terms are why an "à vista" purchase shows the whole amount in the category of the
 * month it was bought and still arrives on the bill one instalment at a time.
 */

/** The key of one charge of a plan: what says whether it already has an expense line. */
export function chargeKey(planId: string, number: number): string {
  return `${planId}:${number}`;
}

/** The charge an expense line stands for, or null when it is not an instalment line. */
export function chargeKeyOf(expense: Pick<Expense, 'installmentId' | 'installmentNumber'>): string | null {
  if (!expense.installmentId || expense.installmentNumber === undefined) return null;
  return chargeKey(expense.installmentId, expense.installmentNumber);
}

/**
 * The single expense an "à vista" plan creates (instalment number 0): the whole purchase, in the
 * category, in the month it was bought. It is budget, so it is the one card expense that never
 * lands on a bill.
 */
export function isUpfrontExpense(expense: Pick<Expense, 'installmentId' | 'installmentNumber'>): boolean {
  return Boolean(expense.installmentId) && expense.installmentNumber === 0;
}

/** Whether this expense line is part of a card bill. */
export function isBillExpense(
  expense: Pick<Expense, 'singleInstallmentCard' | 'installmentId' | 'installmentNumber'>,
): boolean {
  return expense.singleInstallmentCard === true && !isUpfrontExpense(expense);
}

/**
 * Which bill an expense belongs to. An instalment line with no card of its own inherits the
 * plan's — that is what takes old instalments out of "Não informado" without touching them.
 */
export function billCardIdOf(expense: Expense, plans: Map<string, InstallmentPlan>): string {
  if (expense.cardId) return expense.cardId;
  const plan = expense.installmentId ? plans.get(expense.installmentId) : undefined;
  return plan?.cardId ?? UNASSIGNED_CARD_ID;
}

export function plansById(plans: InstallmentPlan[]): Map<string, InstallmentPlan> {
  return new Map(plans.map((plan) => [plan.id, plan]));
}

/** The charges that already have an expense line, by `chargeKey`. */
export function launchedCharges(expenses: Pick<Expense, 'installmentId' | 'installmentNumber'>[]): Set<string> {
  const keys = new Set<string>();
  for (const expense of expenses) {
    const key = chargeKeyOf(expense);
    if (key) keys.add(key);
  }
  return keys;
}

/** One charge of a plan: the bank will ask for it whether or not the app wrote a line for it. */
export interface PlannedCharge {
  plan: InstallmentPlan;
  /** 1-based position in the plan. */
  number: number;
  dueDate: string;
  month: Month;
  cardId: string;
  amount: number;
}

/**
 * Every charge of every plan that the bank will still ask for, oldest first. Charges paid before
 * the purchase was registered here, and charges brought forward by "adiantar parcelas", are not
 * among them: they are not on any bill (see `activeChargeRange`).
 */
export function plannedCharges(plans: InstallmentPlan[]): PlannedCharge[] {
  const charges: PlannedCharge[] = [];
  for (const plan of plans) {
    const amount = installmentAmount(plan);
    installmentDueDates(plan).forEach((dueDate, index) => {
      if (!isActiveCharge(plan, index + 1)) return;
      charges.push({
        plan,
        number: index + 1,
        dueDate,
        month: dueDate.slice(0, 7),
        cardId: plan.cardId ?? UNASSIGNED_CARD_ID,
        amount,
      });
    });
  }
  return charges.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** The charges with no expense line behind them: they are on the bill all the same. */
export function pendingCharges(plans: InstallmentPlan[], launched: ReadonlySet<string>): PlannedCharge[] {
  return plannedCharges(plans).filter((charge) => !launched.has(chargeKey(charge.plan.id, charge.number)));
}

/** One line of a bill, as the screen lists it. */
export interface BillLine {
  /** The expense's id, or the charge's own id when there is no line yet. */
  id: string;
  description: string;
  date: string;
  amount: number;
  cardId: string;
  /** Set when the line is one instalment of a plan. */
  installmentId?: string;
  installmentNumber?: number;
  installmentCount?: number;
  /** No expense row exists for this charge (a month nobody opened, or an "à vista" plan). */
  virtual: boolean;
  /** The expense behind the line, for editing it; absent when `virtual`. */
  expense?: Expense;
}

/**
 * Everything the bill of `month` is made of: the card expenses of that competence (the single
 * expense of an "à vista" plan aside) plus the charges of that competence that have no line.
 */
export function billLines({
  expenses,
  plans,
  month,
  launched,
}: {
  expenses: Expense[];
  plans: InstallmentPlan[];
  month: Month;
  /** Charges that already have a line anywhere; defaults to the ones among `expenses`. */
  launched?: ReadonlySet<string>;
}): BillLine[] {
  const byId = plansById(plans);
  const already = launched ?? launchedCharges(expenses);

  const lines: BillLine[] = expenses.filter(isBillExpense).map((expense) => ({
    id: expense.id,
    description: expense.description,
    date: expense.date,
    amount: expense.amount,
    cardId: billCardIdOf(expense, byId),
    ...(expense.installmentId ? { installmentId: expense.installmentId } : {}),
    ...(expense.installmentNumber !== undefined ? { installmentNumber: expense.installmentNumber } : {}),
    ...(expense.installmentId && byId.get(expense.installmentId)
      ? { installmentCount: byId.get(expense.installmentId)!.count }
      : {}),
    virtual: false,
    expense,
  }));

  for (const charge of pendingCharges(plans, already)) {
    if (charge.month !== month) continue;
    lines.push({
      id: chargeKey(charge.plan.id, charge.number),
      description: `${charge.plan.name} ${charge.number}/${charge.plan.count}`,
      date: charge.dueDate,
      amount: round2(charge.amount),
      cardId: charge.cardId,
      installmentId: charge.plan.id,
      installmentNumber: charge.number,
      installmentCount: charge.plan.count,
      virtual: true,
    });
  }

  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description, 'pt-BR'));
}

export function billLinesTotal(lines: BillLine[]): number {
  return round2(sum(lines.map((line) => line.amount)));
}

/** "R$ 430 em compras · R$ 100 em parcelas": what the bill is made of. */
export function billComposition(lines: BillLine[]): { purchases: number; installments: number } {
  return {
    purchases: round2(sum(lines.filter((line) => !line.installmentId).map((line) => line.amount))),
    installments: round2(sum(lines.filter((line) => line.installmentId).map((line) => line.amount))),
  };
}

/**
 * What every bill is worth, from the expense lines already grouped by (competence, card) and the
 * charges that have no line. This is the server's half of the same math the screens do line by
 * line with `billLines`.
 */
export function billTotals(lineTotals: CardBillTotal[], charges: PlannedCharge[]): CardBillTotal[] {
  const byKey = new Map<string, CardBillTotal>();
  const add = (month: Month, cardId: string, amount: number) => {
    const key = `${cardId}:${month}`;
    const found = byKey.get(key);
    if (found) found.total = round2(found.total + amount);
    else byKey.set(key, { month, cardId, total: round2(amount) });
  };
  for (const row of lineTotals) add(row.month, row.cardId, row.total);
  for (const charge of charges) add(charge.month, charge.cardId, charge.amount);
  return [...byKey.values()];
}

/**
 * What a card's instalments will still bring after the current competence — the part of the
 * limit that is already spoken for but has not reached a bill yet.
 */
export function futureInstallmentTotal(
  plans: InstallmentPlan[],
  currentMonth: Month,
  cardId?: string,
): number {
  return round2(
    sum(
      plannedCharges(plans)
        .filter((charge) => charge.month > currentMonth)
        .filter((charge) => cardId === undefined || charge.cardId === cardId)
        .map((charge) => charge.amount),
    ),
  );
}
