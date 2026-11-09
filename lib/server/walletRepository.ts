import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { billTotals as combineBillTotals, chargeKey, pendingCharges } from '../budget/bill';
import {
  cardBills,
  DEFAULT_CARD_SETTINGS,
  openCardDebt,
  UNASSIGNED_CARD_ID,
  type CardBill,
  type CardBillTotal,
} from '../budget/cards';
import { computeCashReport, createDefaultCashSettings } from '../budget/cash';
import { currentMonthKey, todayISO } from '../budget/date';
import {
  DEFAULT_RECURRING_SETTINGS,
  launchesFromPlans,
  type RecurringLaunch,
} from '../budget/recurring';
import { createId } from '../budget/id';
import {
  advanceExpense,
  advanceProblem,
  advancedPlanOf,
  closedMonthsMessage,
  installmentDebt,
  installmentExpense,
  installmentsDueIn,
  monthsTouchedBy,
  upfrontDate,
  upfrontExpense,
} from '../budget/installments';
import { isPriceStale, quotasForAmount, summarizeInvestments } from '../budget/investments';
import {
  RESERVE_CONTRIBUTION_LABEL,
  summarizeReservePlan,
  type ReserveContribution,
  type ReservePlan,
  type ReservePlanSummary,
} from '../budget/reserve';
import { round2 } from '../budget/money';
import { isModuleOn } from '../modules';
import type {
  CardBillPayment,
  CardSettings as CardNoticeSettings,
  CashSettings,
  CreditCard,
  Expense,
  InstallmentPlan,
  InvestmentBucket,
  InvestmentReserve,
  Month,
  PriceQuote,
  RecurringExpense,
  RecurringSettings,
} from '../budget/types';
import type {
  AdvanceInstallmentInput,
  AllocateInput,
  BillRef,
  ReserveContributionInput,
  WalletRepository,
  WalletSnapshot,
} from '../storage/wallet';
import { MonthClosedError } from '../storage/repository';
import type { MonthWriteContext, PostgresBudgetRepository } from './budgetRepository';
import {
  cardBillPayments,
  cards,
  cardSettings,
  cashSettings,
  expenses,
  installments,
  investmentBuckets,
  investmentReserves,
  months,
  priceCache,
  recurringExpenses,
  recurringSettings,
  reserveContributions,
  reservePlans,
} from './db/schema';
import type { Database, Transaction } from './db/types';
import { HttpError } from './httpError';
import { checkQuota, QUOTAS } from './quotas';
import { fetchQuote } from './quotes';

/** The ticker the app starts from; every user can change it in the Reserva screen. */
export const DEFAULT_TICKER = 'AUPO11';

/** A cached price older than this is refreshed the next time the Carteira is opened. */
const AUTO_REFRESH_MINUTES = 15;
/** How long opening the Carteira waits for that refresh before showing the cached price. */
const AUTO_REFRESH_WAIT_MS = 4_000;

/**
 * The Carteira on Postgres, scoped to one user. Anything that also creates an expense (launching
 * an instalment, allocating money to a bucket) runs inside the budget repository's transaction,
 * so the category and the carryIn cascade stay consistent with the wallet's own tables.
 */
export class PostgresWalletRepository implements WalletRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly budget: PostgresBudgetRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getSnapshot(): Promise<WalletSnapshot> {
    const today = todayISO();
    const month = currentMonthKey();
    const [
      recurring,
      plans,
      reserve,
      buckets,
      settings,
      cardList,
      payments,
      noticeSettings,
      closed,
      launchedExpenses,
      billSettings,
    ] = await Promise.all([
      this.listRecurring(),
      this.listInstallments(),
      this.readReserve(),
      this.listBuckets(),
      this.readCashSettings(),
      this.listCards(),
      this.listBillPayments(),
      this.readCardSettings(),
      this.closedMonths(),
      this.listRecurringExpenseLaunches(),
      this.readRecurringSettings(),
    ]);
    const plan = await this.readReservePlan(month);

    const quote = await this.currentQuote(reserve, buckets);
    const investments = summarizeInvestments(reserve, buckets, quote);
    const bills = cardBills(cardList, await this.billTotals(plans), payments, today);

    return {
      recurring,
      recurringLaunches: [...launchedExpenses, ...launchesFromPlans(plans)],
      recurringSettings: billSettings,
      installments: plans,
      cards: cardList,
      bills,
      closedMonths: closed,
      cardSettings: noticeSettings,
      investments,
      cash: {
        settings,
        report: computeCashReport({
          settings,
          investedReserve: investments.freeValue,
          // A bill only leaves the debt when it is marked as paid — the "Não informado" one
          // included. What comes after the current competence is not a bill yet: it is what the
          // instalments will still bring, counted right below, so no real is counted twice.
          cardDebt: openCardDebt(bills),
          installmentDebt: installmentDebt(plans, month),
          cardMonth: month,
        }),
        plan,
      },
      today,
    };
  }

  /** The competences this user already closed: nothing may be written into them. */
  private async closedMonths(): Promise<Month[]> {
    const rows = await this.db
      .select({ month: months.month })
      .from(months)
      .where(and(eq(months.userId, this.userId), eq(months.closed, true)))
      .orderBy(asc(months.month));
    return rows.map((row) => row.month);
  }

  /** The charges of the plans that already have an expense line, by `chargeKey`. */
  private async launchedCharges(): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: expenses.installmentId, number: expenses.installmentNumber })
      .from(expenses)
      .where(and(eq(expenses.userId, this.userId), isNotNull(expenses.installmentId)));
    return new Set(
      rows
        .filter((row) => row.id !== null && row.number !== null)
        .map((row) => chargeKey(row.id as string, row.number as number)),
    );
  }

  private async listRecurring(): Promise<RecurringExpense[]> {
    const rows = await this.db
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.userId, this.userId))
      .orderBy(asc(recurringExpenses.position));
    return rows.map((row) => ({
      id: row.id,
      categoryKind: row.categoryKind,
      ...(row.topicId ? { topicId: row.topicId } : {}),
      description: row.description,
      amount: row.amount,
      card: row.card,
      ...(row.cardId ? { cardId: row.cardId } : {}),
      ...(row.installmentCount ? { installmentCount: row.installmentCount } : {}),
      ...(row.installmentAccounting ? { installmentAccounting: row.installmentAccounting } : {}),
      ...(row.dueDay ? { dueDay: row.dueDay } : {}),
      ...(row.tagIds.length > 0 ? { tagIds: row.tagIds } : {}),
    }));
  }

  async listInstallments(): Promise<InstallmentPlan[]> {
    const rows = await this.db
      .select()
      .from(installments)
      .where(eq(installments.userId, this.userId))
      .orderBy(asc(installments.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryKind: row.categoryKind,
      ...(row.topicId ? { topicId: row.topicId } : {}),
      firstDebitDate: row.firstDebitDate,
      ...(row.purchaseDate ? { purchaseDate: row.purchaseDate } : {}),
      count: row.count,
      totalAmount: row.totalAmount,
      accounting: row.accounting,
      ...(row.cardId ? { cardId: row.cardId } : {}),
      ...(row.paidCount ? { paidCount: row.paidCount } : {}),
      ...(row.advancedCount ? { advancedCount: row.advancedCount } : {}),
      ...(row.recurringId ? { recurringId: row.recurringId } : {}),
      ...(row.tagIds.length > 0 ? { tagIds: row.tagIds } : {}),
    }));
  }

  async listCards(): Promise<CreditCard[]> {
    const rows = await this.db
      .select()
      .from(cards)
      .where(eq(cards.userId, this.userId))
      .orderBy(asc(cards.position));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dueDay: row.dueDay,
      dueMonth: row.dueMonth,
      notifyEnabled: row.notifyEnabled,
      notifyBeforeDays: row.notifyBeforeDays,
      isDefault: row.isDefault,
      ...(row.limit === null ? {} : { limit: row.limit }),
      ...(row.color ? { color: row.color } : {}),
      order: row.position,
    }));
  }

  private async listBillPayments(): Promise<CardBillPayment[]> {
    const rows = await this.db
      .select()
      .from(cardBillPayments)
      .where(eq(cardBillPayments.userId, this.userId));
    return rows.map((row) => ({
      cardId: row.cardId,
      month: row.month,
      amount: row.amount,
      paidAt: row.paidAt.toISOString(),
    }));
  }

  /**
   * What every bill is worth, competence by competence (see `lib/budget/bill.ts`): the card
   * expenses that are not the single expense of an "à vista" plan, plus the charges that have
   * no expense line yet. An instalment line with no card of its own takes the plan's, which is
   * what keeps old instalments out of the "Não informado" bill.
   */
  private async billTotals(plans: InstallmentPlan[]): Promise<CardBillTotal[]> {
    const rows = await this.db
      .select({
        month: expenses.month,
        cardId: sql<string | null>`coalesce(${expenses.cardId}, ${installments.cardId})`,
        total: sql<string>`sum(${expenses.amount})`,
      })
      .from(expenses)
      .leftJoin(
        installments,
        and(eq(installments.userId, expenses.userId), eq(installments.id, expenses.installmentId)),
      )
      .where(
        and(
          eq(expenses.userId, this.userId),
          eq(expenses.card, true),
          sql`(${expenses.installmentId} is null or ${expenses.installmentNumber} >= 1)`,
        ),
      )
      .groupBy(expenses.month, sql`coalesce(${expenses.cardId}, ${installments.cardId})`);

    const lineTotals: CardBillTotal[] = rows.map((row) => ({
      month: row.month,
      cardId: row.cardId ?? UNASSIGNED_CARD_ID,
      total: Number(row.total),
    }));
    return combineBillTotals(lineTotals, pendingCharges(plans, await this.launchedCharges()));
  }

  /** The expenses launched from a template ("Contas do mês"), each with its competence. */
  async listRecurringExpenseLaunches(): Promise<RecurringLaunch[]> {
    const rows = await this.db
      .select({ recurringId: expenses.recurringId, month: expenses.month, date: expenses.date })
      .from(expenses)
      .where(and(eq(expenses.userId, this.userId), isNotNull(expenses.recurringId)));
    return rows.map((row) => ({ recurringId: row.recurringId as string, month: row.month, date: row.date }));
  }

  async readRecurringSettings(): Promise<RecurringSettings> {
    const [row] = await this.db
      .select()
      .from(recurringSettings)
      .where(eq(recurringSettings.userId, this.userId));
    if (!row) return DEFAULT_RECURRING_SETTINGS;
    return {
      notifyEnabled: row.notifyEnabled,
      notifyTime: row.notifyTime,
      repeatUntilLaunched: row.repeatUntilLaunched,
    };
  }

  async readCardSettings(): Promise<CardNoticeSettings> {
    const [row] = await this.db.select().from(cardSettings).where(eq(cardSettings.userId, this.userId));
    if (!row) return DEFAULT_CARD_SETTINGS;
    return { notifyTime: row.notifyTime, repeatUntilPaid: row.repeatUntilPaid };
  }

  private async readReserve(): Promise<InvestmentReserve> {
    const [row] = await this.db
      .select()
      .from(investmentReserves)
      .where(eq(investmentReserves.userId, this.userId));
    return row
      ? { ticker: row.ticker, totalQuotas: row.totalQuotas }
      : { ticker: DEFAULT_TICKER, totalQuotas: 0 };
  }

  private async listBuckets(): Promise<InvestmentBucket[]> {
    const rows = await this.db
      .select()
      .from(investmentBuckets)
      .where(eq(investmentBuckets.userId, this.userId))
      .orderBy(asc(investmentBuckets.position));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.topicId ? { topicId: row.topicId } : {}),
      quotas: row.quotas,
    }));
  }

  private async readQuote(ticker: string): Promise<PriceQuote | null> {
    const [row] = await this.db.select().from(priceCache).where(eq(priceCache.ticker, ticker));
    if (!row) return null;
    return {
      ticker: row.ticker,
      price: row.price,
      fetchedAt: row.fetchedAt.toISOString(),
      ...(row.name ? { name: row.name } : {}),
      ...(row.source === 'b3' || row.source === 'yahoo' ? { source: row.source } : {}),
    };
  }

  /**
   * The cached price, refreshed first when it is older than AUTO_REFRESH_MINUTES and this user
   * actually holds something (quotas or buckets) — the sources are free, so there is no reason
   * to make anyone press "Atualizar". A slow or failed refresh never blocks the screen: after
   * AUTO_REFRESH_WAIT_MS the cached price is shown, and the refresh still lands in the cache.
   */
  private async currentQuote(
    reserve: InvestmentReserve,
    buckets: InvestmentBucket[],
  ): Promise<PriceQuote | null> {
    const cached = await this.readQuote(reserve.ticker);
    const holdsSomething = reserve.totalQuotas > 0 || buckets.length > 0;
    if (!holdsSomething || !isPriceStale(cached?.fetchedAt, new Date(), AUTO_REFRESH_MINUTES)) {
      return cached;
    }

    const refreshed = this.storeQuote(reserve.ticker).catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), AUTO_REFRESH_WAIT_MS);
    });
    const fresh = await Promise.race([refreshed, gaveUp]);
    clearTimeout(timer);
    return fresh ?? cached;
  }

  private async readCashSettings(): Promise<CashSettings> {
    const [row] = await this.db.select().from(cashSettings).where(eq(cashSettings.userId, this.userId));
    if (!row) return createDefaultCashSettings();
    return {
      reserveAccountAmount: row.reserveAccountAmount,
      emergencyCosts: row.emergencyCosts,
      reserveMultiplier: row.reserveMultiplier,
    };
  }

  // -------------------------------------------------------------------------
  // Cards and their bills
  // -------------------------------------------------------------------------

  async saveCard(card: CreditCard): Promise<void> {
    const values = {
      name: card.name.trim(),
      dueDay: card.dueDay,
      dueMonth: card.dueMonth,
      notifyEnabled: card.notifyEnabled,
      notifyBeforeDays: card.notifyBeforeDays,
      limit: card.limit ?? null,
      color: card.color ?? null,
    };
    const existing = await this.listCards();
    const known = existing.find((item) => item.id === card.id);
    if (!known) {
      checkQuota(existing.length, QUOTAS.cards, `Dá para cadastrar até ${QUOTAS.cards} cartões.`);
    }
    // The first card is always the default one; after that, only what the person asked for.
    const isDefault = card.isDefault || existing.length === 0 || (known?.isDefault === true && existing.length === 1);
    const position = known?.order ?? existing.length;

    await this.db.transaction(async (tx) => {
      await tx
        .insert(cards)
        .values({ userId: this.userId, id: card.id, position, isDefault, ...values })
        .onConflictDoUpdate({ target: [cards.userId, cards.id], set: { ...values, isDefault } });
      if (isDefault) {
        await tx
          .update(cards)
          .set({ isDefault: false })
          .where(and(eq(cards.userId, this.userId), sql`${cards.id} <> ${card.id}`));
      }
    });
  }

  /**
   * Deletes the card. Nothing it paid for is deleted with it: the purchases, the templates and
   * the plans only lose the link, so they join the "Não informado" bill — which, like every
   * bill, only leaves the debt when it is marked as paid. Its own paid bills go with it: with no
   * foreign key to cascade any more (`card_bill_payments` also holds the "Não informado" bill),
   * this is where they are cleaned up.
   */
  async deleteCard(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const untie = { cardId: null };
      await tx
        .delete(cardBillPayments)
        .where(and(eq(cardBillPayments.userId, this.userId), eq(cardBillPayments.cardId, id)));
      await tx
        .update(expenses)
        .set(untie)
        .where(and(eq(expenses.userId, this.userId), eq(expenses.cardId, id)));
      await tx
        .update(recurringExpenses)
        .set(untie)
        .where(and(eq(recurringExpenses.userId, this.userId), eq(recurringExpenses.cardId, id)));
      await tx
        .update(installments)
        .set(untie)
        .where(and(eq(installments.userId, this.userId), eq(installments.cardId, id)));
      await tx.delete(cards).where(and(eq(cards.userId, this.userId), eq(cards.id, id)));
      const [first] = await tx
        .select({ id: cards.id, isDefault: cards.isDefault })
        .from(cards)
        .where(eq(cards.userId, this.userId))
        .orderBy(asc(cards.position))
        .limit(1);
      // Never leave the person without a default card to pre-select.
      if (first && !first.isDefault) {
        await tx.update(cards).set({ isDefault: true }).where(and(eq(cards.userId, this.userId), eq(cards.id, first.id)));
      }
    });
  }

  async payBill({ cardId, month }: BillRef): Promise<void> {
    const bill = await this.requireBill(cardId, month);
    const values = { amount: bill.total, paidAt: new Date() };
    await this.db
      .insert(cardBillPayments)
      .values({ userId: this.userId, cardId, month, ...values })
      .onConflictDoUpdate({
        target: [cardBillPayments.userId, cardBillPayments.cardId, cardBillPayments.month],
        set: values,
      });
  }

  async unpayBill({ cardId, month }: BillRef): Promise<void> {
    await this.db
      .delete(cardBillPayments)
      .where(
        and(
          eq(cardBillPayments.userId, this.userId),
          eq(cardBillPayments.cardId, cardId),
          eq(cardBillPayments.month, month),
        ),
      );
  }

  async saveCardSettings(settings: CardNoticeSettings): Promise<void> {
    const values = { notifyTime: settings.notifyTime, repeatUntilPaid: settings.repeatUntilPaid };
    await this.db
      .insert(cardSettings)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: cardSettings.userId, set: values });
  }

  /**
   * The bill as it stands right now, so "Fatura paga" records what was actually paid. The
   * "Não informado" bill is paid exactly like a card's, so it is looked up the same way.
   */
  private async requireBill(cardId: string, month: Month): Promise<CardBill> {
    if (cardId !== UNASSIGNED_CARD_ID) await this.requireCard(cardId);
    const plans = await this.listInstallments();
    const bill = cardBills(await this.listCards(), await this.billTotals(plans), [], todayISO()).find(
      (item) => item.cardId === cardId && item.month === month,
    );
    if (!bill) throw new HttpError(404, 'BILL_NOT_FOUND', 'Essa fatura não tem nada para pagar.');
    return bill;
  }

  private async requireCard(id: string): Promise<CreditCard> {
    const card = (await this.listCards()).find((item) => item.id === id);
    if (!card) throw new HttpError(404, 'CARD_NOT_FOUND', 'Esse cartão não existe mais.');
    return card;
  }

  // -------------------------------------------------------------------------
  // Recurring expenses
  // -------------------------------------------------------------------------

  async saveRecurring(item: RecurringExpense): Promise<void> {
    // Absent (an older client) keeps the tags the template already has.
    const tagIds = await this.budget.cleanTagIdsIn(this.db, 'expense', item.tagIds);
    const values = {
      ...(tagIds !== undefined ? { tagIds } : {}),
      categoryKind: item.categoryKind,
      topicId: item.topicId ?? null,
      description: item.description,
      amount: item.amount,
      card: item.card,
      cardId: item.card ? (item.cardId ?? null) : null,
      // Parcelar só existe no cartão: sem ele, o modelo volta a ser um gasto comum.
      installmentCount: item.card ? (item.installmentCount ?? null) : null,
      installmentAccounting: item.card && item.installmentCount ? (item.installmentAccounting ?? 'upfront') : null,
      dueDay: item.dueDay ?? null,
    };
    const [last] = await this.db
      .select({
        position: sql<number | null>`max(${recurringExpenses.position})`,
        others: sql<number>`count(*) filter (where ${recurringExpenses.id} <> ${item.id})`.mapWith(Number),
      })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.userId, this.userId));
    checkQuota(
      last?.others ?? 0,
      QUOTAS.recurring,
      `Dá para ter até ${QUOTAS.recurring} contas do mês.`,
    );
    await this.db
      .insert(recurringExpenses)
      .values({ userId: this.userId, id: item.id, position: (last?.position ?? -1) + 1, ...values })
      .onConflictDoUpdate({ target: [recurringExpenses.userId, recurringExpenses.id], set: values });
  }

  async deleteRecurring(id: string): Promise<void> {
    await this.db
      .delete(recurringExpenses)
      .where(and(eq(recurringExpenses.userId, this.userId), eq(recurringExpenses.id, id)));
  }

  async saveRecurringSettings(settings: RecurringSettings): Promise<void> {
    const values = {
      notifyEnabled: settings.notifyEnabled,
      notifyTime: settings.notifyTime,
      repeatUntilLaunched: settings.repeatUntilLaunched,
    };
    await this.db
      .insert(recurringSettings)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: recurringSettings.userId, set: values });
  }

  /**
   * "Lançar ✅" on the notice of a bill: the template becomes an expense of `month`, dated `date`,
   * exactly as "Lançar" in the app would make it with nothing changed. Twice is once — a bill
   * already launched in that competence is left alone — and a parcelled template is not launched
   * here: it needs the form, where the first charge is chosen.
   */
  async launchRecurring(id: string, month: Month, date: string): Promise<'launched' | 'already'> {
    const item = (await this.listRecurring()).find((template) => template.id === id);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Essa conta não existe mais.');
    if (item.card && item.installmentCount) {
      throw new HttpError(409, 'NEEDS_FORM', 'Abra o Capital + para lançar essa compra parcelada.');
    }
    const launched = (await this.listRecurringExpenseLaunches()).some(
      (launch) => launch.recurringId === id && launch.month === month,
    );
    if (launched) return 'already';

    // Without the Cartão module the expense is an ordinary one, as the form would make it.
    const onCard = item.card && isModuleOn(await this.budget.getSettings(), 'card');
    await this.budget.saveExpense(month, {
      id: createId(),
      categoryKind: item.categoryKind,
      ...(item.topicId ? { topicId: item.topicId } : {}),
      description: item.description,
      amount: item.amount,
      date,
      singleInstallmentCard: onCard,
      ...(onCard && item.cardId ? { cardId: item.cardId } : {}),
      source: 'recurring',
      recurringId: item.id,
      ...(item.tagIds ? { tagIds: item.tagIds } : {}),
    });
    return 'launched';
  }

  // -------------------------------------------------------------------------
  // Instalment plans
  // -------------------------------------------------------------------------

  /**
   * Creates or edits a plan, and rebuilds every expense line it owns so the purchase is always
   * shown the way it is saved: "em parcelas" writes one expense per charge, into each month
   * that already exists, and "à vista" writes the single expense of the whole purchase, in the
   * month it was bought. Changing the mode (or the category, or the card) therefore moves the
   * money, which is exactly what the person asked for — including undoing an adjustment made to
   * one instalment by hand, which the form warns about.
   *
   * A purchase with any charge in a closed month is refused whole, here as well as in the form:
   * a closed month is the month's own record, and reopening it is the only way through.
   */
  async saveInstallment(plan: InstallmentPlan): Promise<void> {
    await this.budget.writeWith((ctx) => this.writePlan(ctx, plan));
  }

  /**
   * "Adiantar parcelas": the last `count` charges leave the plan, and what was really paid —
   * those charges minus the discount — becomes one expense of its own in `month`. Both halves go
   * in the same transaction, so the purchase never ends up shortened with nothing paid for it.
   */
  async advanceInstallment(id: string, input: AdvanceInstallmentInput): Promise<void> {
    const plan = (await this.listInstallments()).find((item) => item.id === id);
    if (!plan) throw new HttpError(404, 'NOT_FOUND', 'Esta compra parcelada não existe mais.');

    const problem = advanceProblem(plan, input, todayISO());
    if (problem) throw new HttpError(400, 'INVALID_INPUT', problem);

    const expense = advanceExpense(plan, input, createId());
    await this.budget.writeWith(async (ctx) => {
      await this.writePlan(ctx, advancedPlanOf(plan, input.count));
      await ctx.addExpense(input.month, expense);
    });
  }

  /**
   * A purchase entered "à vista" that the bank shows split in instalments ("Trocar por parcelado"):
   * the plan takes the expense's place in one write, so it never counts twice nor goes missing. A
   * closed month — the expense's, or any the plan touches — refuses the whole thing.
   */
  async replaceExpenseWithInstallment(month: Month, expenseId: string, plan: InstallmentPlan): Promise<void> {
    await this.budget.writeWith(async (ctx) => {
      if (!(await ctx.openMonths()).includes(month)) throw new MonthClosedError(month);
      const removed = await ctx.tx
        .delete(expenses)
        .where(
          and(
            eq(expenses.userId, this.userId),
            eq(expenses.month, month),
            eq(expenses.id, expenseId),
            isNull(expenses.installmentId),
          ),
        )
        .returning({ id: expenses.id });
      if (removed.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Esse gasto não existe mais.');
      ctx.touch(month);
      await this.writePlan(ctx, plan);
    });
  }

  /** The half of `saveInstallment` that runs inside a write, shared with `advanceInstallment`. */
  private async writePlan(
    { tx, addExpense, touch, openMonths }: MonthWriteContext,
    sent: InstallmentPlan,
  ): Promise<void> {
    // Without tags in what was sent (an older client), the purchase keeps the ones it has — and so
    // do the charges rebuilt below.
    const cleaned = await this.budget.cleanTagIdsIn(tx, 'expense', sent.tagIds);
    const [stored] =
      cleaned === undefined
        ? await tx
            .select({ tagIds: installments.tagIds })
            .from(installments)
            .where(and(eq(installments.userId, this.userId), eq(installments.id, sent.id)))
        : [];
    const tagIds = cleaned ?? stored?.tagIds ?? [];
    const plan: InstallmentPlan = { ...sent, ...(tagIds.length > 0 ? { tagIds } : { tagIds: undefined }) };
    const values = {
      tagIds,
      name: plan.name,
      categoryKind: plan.categoryKind,
      topicId: plan.topicId ?? null,
      firstDebitDate: plan.firstDebitDate,
      purchaseDate: plan.purchaseDate ?? null,
      count: plan.count,
      totalAmount: plan.totalAmount,
      accounting: plan.accounting,
      cardId: plan.cardId ?? null,
      paidCount: plan.paidCount ?? 0,
      advancedCount: plan.advancedCount ?? 0,
    };

    await this.requireOpenMonthsForPlan(tx, plan);

    const [{ others }] = await tx
      .select({
        others: sql<number>`count(*) filter (where ${installments.id} <> ${plan.id})`.mapWith(Number),
      })
      .from(installments)
      .where(eq(installments.userId, this.userId));
    checkQuota(others, QUOTAS.installments, `Dá para ter até ${QUOTAS.installments} compras parceladas.`);

    // The bill of "Contas do mês" a purchase came from is set when it is created; an edit from the
    // Cartão, which does not know about it, keeps it.
    const link = plan.recurringId ? { recurringId: plan.recurringId } : {};
    await tx
      .insert(installments)
      .values({ userId: this.userId, id: plan.id, ...values, ...link })
      .onConflictDoUpdate({ target: [installments.userId, installments.id], set: { ...values, ...link } });

    // Start from a clean slate: what this plan wrote before may belong to another month, to
    // another category or to the other accounting mode altogether.
    const removed = await tx
      .delete(expenses)
      .where(and(eq(expenses.userId, this.userId), eq(expenses.installmentId, plan.id)))
      .returning({ month: expenses.month });
    for (const row of removed) touch(row.month);

    if (plan.accounting === 'installment') {
      // Charge the months that already exist and are still open; months created later get
      // their charge when they are created (see `installmentExpensesFor`).
      for (const month of await openMonths()) {
        for (const { number, dueDate } of installmentsDueIn([plan], month)) {
          await addExpense(month, installmentExpense(plan, number, dueDate));
        }
      }
    } else {
      const date = upfrontDate(plan);
      await addExpense(date.slice(0, 7), upfrontExpense(plan, date));
    }
  }

  /** Deletes the plan and every expense line it created, in every month. */
  async deleteInstallment(id: string): Promise<void> {
    await this.budget.writeWith(async ({ tx, touch }) => {
      const [plan] = await tx
        .select()
        .from(installments)
        .where(and(eq(installments.userId, this.userId), eq(installments.id, id)));
      if (!plan) return;

      await this.requireOpenMonthsForPlan(tx, {
        firstDebitDate: plan.firstDebitDate,
        purchaseDate: plan.purchaseDate ?? undefined,
        count: plan.count,
        paidCount: plan.paidCount,
        advancedCount: plan.advancedCount,
        accounting: plan.accounting,
        id,
      });

      await tx.delete(installments).where(and(eq(installments.userId, this.userId), eq(installments.id, id)));
      const removed = await tx
        .delete(expenses)
        .where(and(eq(expenses.userId, this.userId), eq(expenses.installmentId, id)))
        .returning({ month: expenses.month });
      for (const row of removed) touch(row.month);
    });
  }

  /**
   * Refuses the whole operation when any month the purchase touches is closed — the competences
   * of its charges, where it lands in the budget, and wherever its current lines already are.
   * The message names the months, so the screen can offer to reopen one of them.
   */
  private async requireOpenMonthsForPlan(
    tx: Transaction,
    plan: Pick<InstallmentPlan, 'id' | 'firstDebitDate' | 'count' | 'accounting' | 'purchaseDate'> &
      Pick<Partial<InstallmentPlan>, 'paidCount' | 'advancedCount'>,
  ): Promise<void> {
    const touched = new Set(monthsTouchedBy(plan));
    const existing = await tx
      .selectDistinct({ month: expenses.month })
      .from(expenses)
      .where(and(eq(expenses.userId, this.userId), eq(expenses.installmentId, plan.id)));
    for (const row of existing) touched.add(row.month);

    const closed = await tx
      .select({ month: months.month })
      .from(months)
      .where(
        and(
          eq(months.userId, this.userId),
          eq(months.closed, true),
          inArray(months.month, [...touched]),
        ),
      )
      .orderBy(asc(months.month));
    if (closed.length === 0) return;
    const list = closed.map((row) => row.month);
    throw new HttpError(409, 'INSTALLMENT_MONTH_CLOSED', closedMonthsMessage(list), { months: list });
  }

  // -------------------------------------------------------------------------
  // Invested reserve
  // -------------------------------------------------------------------------

  async setTicker(ticker: string): Promise<void> {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) throw new HttpError(400, 'INVALID_INPUT', 'Informe o código do ativo.');
    await this.upsertReserve({ ticker: normalized });
  }

  async tradeQuotas(delta: number): Promise<void> {
    const reserve = await this.readReserve();
    const total = reserve.totalQuotas + delta;
    if (total < 0) {
      throw new HttpError(
        400,
        'NOT_ENOUGH_QUOTAS',
        `Você tem ${reserve.totalQuotas} cotas; não dá para vender ${Math.abs(delta)}.`,
      );
    }
    await this.upsertReserve({ totalQuotas: total });
  }

  async saveBucket(bucket: InvestmentBucket): Promise<void> {
    const values = {
      name: bucket.name,
      topicId: bucket.topicId ?? null,
      quotas: bucket.quotas,
    };
    const [last] = await this.db
      .select({
        position: sql<number | null>`max(${investmentBuckets.position})`,
        others: sql<number>`count(*) filter (where ${investmentBuckets.id} <> ${bucket.id})`.mapWith(Number),
      })
      .from(investmentBuckets)
      .where(eq(investmentBuckets.userId, this.userId));
    checkQuota(last?.others ?? 0, QUOTAS.buckets, `Dá para ter até ${QUOTAS.buckets} categorias na reserva.`);
    await this.db
      .insert(investmentBuckets)
      .values({ userId: this.userId, id: bucket.id, position: (last?.position ?? -1) + 1, ...values })
      .onConflictDoUpdate({ target: [investmentBuckets.userId, investmentBuckets.id], set: values });
  }

  async deleteBucket(id: string): Promise<void> {
    await this.db
      .delete(investmentBuckets)
      .where(and(eq(investmentBuckets.userId, this.userId), eq(investmentBuckets.id, id)));
  }

  /**
   * Moves `amount` between the free reserve and a bucket. Putting money in buys quotas for the
   * bucket and charges its category, exactly as the bot did; taking money out is the same
   * operation backwards — the quotas go back to the free reserve and the category is credited,
   * as a negative expense, so the month stops showing money the person did not spend after all.
   * Both halves happen in one transaction.
   */
  async allocate(input: AllocateInput): Promise<void> {
    const reserve = await this.readReserve();
    const quote = await this.readQuote(reserve.ticker);
    if (!quote) {
      throw new HttpError(
        409,
        'NO_QUOTE',
        `Sem cotação de ${reserve.ticker}. Atualize a cotação antes de remanejar.`,
      );
    }

    const [bucket] = await this.db
      .select()
      .from(investmentBuckets)
      .where(and(eq(investmentBuckets.userId, this.userId), eq(investmentBuckets.id, input.bucketId)));
    if (!bucket) throw new HttpError(404, 'NOT_FOUND', 'Essa categoria da reserva não existe mais.');
    if (!bucket.topicId) {
      throw new HttpError(
        400,
        'BUCKET_WITHOUT_TOPIC',
        `A categoria "${bucket.name}" da reserva não está ligada a nenhuma categoria do orçamento. Edite-a antes de remanejar.`,
      );
    }

    const out = input.direction === 'out';
    const quotas = quotasForAmount(input.amount, quote.price);
    if (out && quotas > bucket.quotas) {
      throw new HttpError(
        400,
        'NOT_ENOUGH_QUOTAS',
        `A categoria "${bucket.name}" tem ${round2(bucket.quotas * quote.price)} em ${reserve.ticker}; não dá para retirar ${round2(input.amount)}.`,
      );
    }

    const expense: Expense = {
      id: createId(),
      categoryKind: 'topic',
      topicId: bucket.topicId,
      description: out ? `${reserve.ticker} (retirada)` : reserve.ticker,
      amount: out ? -round2(input.amount) : round2(input.amount),
      date: input.date,
      singleInstallmentCard: false,
      source: 'investment',
    };

    await this.budget.writeWith(async ({ tx, addExpense }) => {
      await tx
        .update(investmentBuckets)
        .set({ quotas: out ? bucket.quotas - quotas : bucket.quotas + quotas })
        .where(and(eq(investmentBuckets.userId, this.userId), eq(investmentBuckets.id, bucket.id)));
      await addExpense(input.month, expense);
    });
  }

  /** Fetches a fresh price (B3, then Yahoo Finance — no token) and caches it for every account. */
  async refreshPrice(): Promise<void> {
    const { ticker } = await this.readReserve();
    await this.storeQuote(ticker);
  }

  private async storeQuote(ticker: string): Promise<PriceQuote> {
    const quote = await fetchQuote(ticker);
    const fetchedAt = new Date();
    const values = {
      price: quote.price,
      name: quote.name ?? null,
      source: quote.source,
      fetchedAt,
    };
    await this.db
      .insert(priceCache)
      .values({ ticker, ...values })
      .onConflictDoUpdate({ target: priceCache.ticker, set: values });
    return {
      ticker,
      price: quote.price,
      fetchedAt: fetchedAt.toISOString(),
      ...(quote.name ? { name: quote.name } : {}),
      source: quote.source,
    };
  }

  // -------------------------------------------------------------------------
  // Cash
  // -------------------------------------------------------------------------

  async saveCashSettings(settings: CashSettings): Promise<void> {
    const values = {
      reserveAccountAmount: settings.reserveAccountAmount,
      emergencyCosts: settings.emergencyCosts,
      reserveMultiplier: settings.reserveMultiplier,
    };
    await this.db
      .insert(cashSettings)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: cashSettings.userId, set: values });
  }

  // -------------------------------------------------------------------------
  // Plano da reserva
  // -------------------------------------------------------------------------

  /** O plano desta conta com o progresso já calculado, ou null quando não existe um. */
  private async readReservePlan(month: Month): Promise<ReservePlanSummary | null> {
    const [row] = await this.db
      .select()
      .from(reservePlans)
      .where(eq(reservePlans.userId, this.userId));
    if (!row) return null;

    const plan: ReservePlan = {
      targetAmount: row.targetAmount,
      months: row.months,
      startMonth: row.startMonth,
      ...(row.reason ? { reason: row.reason } : {}),
    };
    return summarizeReservePlan(plan, await this.listReserveContributions(), month);
  }

  private async listReserveContributions(): Promise<ReserveContribution[]> {
    const rows = await this.db
      .select()
      .from(reserveContributions)
      .where(eq(reserveContributions.userId, this.userId))
      .orderBy(asc(reserveContributions.createdAt));
    return rows.map((row) => ({
      id: row.id,
      month: row.month,
      amount: row.amount,
      date: row.date,
    }));
  }

  async saveReservePlan(plan: ReservePlan): Promise<void> {
    const values = {
      targetAmount: plan.targetAmount,
      months: plan.months,
      startMonth: plan.startMonth,
      reason: plan.reason ?? null,
    };
    await this.db
      .insert(reservePlans)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: reservePlans.userId, set: values });
  }

  /**
   * Desistir do plano. As parcelas já lançadas ficam onde estão: o dinheiro voltou mesmo para a
   * reserva, e apagar os gastos dos meses passados seria reescrever meses que já aconteceram.
   */
  async deleteReservePlan(): Promise<void> {
    await this.db.delete(reservePlans).where(eq(reservePlans.userId, this.userId));
    await this.db.delete(reserveContributions).where(eq(reserveContributions.userId, this.userId));
  }

  /**
   * Uma parcela do plano: o gasto entra no mês (imprevisto, por padrão) e passa a contar no que já
   * foi devolvido. O saldo da reserva **não** é mexido aqui de propósito — onde o dinheiro fica,
   * na conta ou em cotas, é decisão da pessoa e continua vindo de onde sempre veio; o plano
   * acompanha o compromisso, não o cofre.
   */
  async contributeToReserve(input: ReserveContributionInput): Promise<void> {
    const [plan] = await this.db
      .select()
      .from(reservePlans)
      .where(eq(reservePlans.userId, this.userId));
    if (!plan) {
      throw new HttpError(409, 'NO_RESERVE_PLAN', 'Monte um plano antes de lançar uma parcela dele.');
    }

    const amount = round2(input.amount);
    const expense: Expense = {
      id: createId(),
      categoryKind: input.categoryKind,
      ...(input.categoryKind === 'topic' && input.topicId ? { topicId: input.topicId } : {}),
      description: RESERVE_CONTRIBUTION_LABEL,
      amount,
      date: input.date,
      singleInstallmentCard: false,
      source: 'reserve',
    };

    await this.budget.writeWith(async ({ tx, addExpense }) => {
      await addExpense(input.month, expense);
      await tx.insert(reserveContributions).values({
        userId: this.userId,
        id: createId(),
        month: input.month,
        amount,
        date: input.date,
        expenseId: expense.id,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async upsertReserve(patch: Partial<InvestmentReserve>): Promise<void> {
    const current = await this.readReserve();
    const values = {
      ticker: patch.ticker ?? current.ticker,
      totalQuotas: patch.totalQuotas ?? current.totalQuotas,
    };
    await this.db
      .insert(investmentReserves)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: investmentReserves.userId, set: values });
  }
}
