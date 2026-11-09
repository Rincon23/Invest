import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  notInArray,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { computeMonthSummary } from '../budget/calculations';
import { DEFAULT_SPECIAL_CATEGORY_LABELS } from '../budget/categories';
import { DEFAULT_SPECIAL_CATEGORY_COLORS } from '../budget/colors';
import { nextMonth } from '../budget/date';
import { installmentExpense, installmentsDueIn } from '../budget/installments';
import {
  carrySource,
  cascadeCarryIn,
  createMonthData,
  lateExpenseDestination,
  type LateExpenseDestination,
  type MonthStatus,
} from '../budget/rollover';
import { createDefaultSettings } from '../budget/seed';
import { TAG_LIMITS, cleanTagIds, sanitizeTags, tagIdSet, tagNameProblem, type TagRefs } from '../budget/tags';
import {
  consolidateBudgetData,
  consolidateMonthTopics,
  consolidateTopics,
  enforceFixedTopics,
} from '../budget/topics';
import type {
  BudgetSettings,
  Expense,
  Income,
  InstallmentPlan,
  Month,
  MonthData,
  PendingReimbursable,
  Tag,
  TagKind,
} from '../budget/types';
import {
  BACKUP_VERSION,
  MonthClosedError,
  MonthNotFoundError,
  type BackupPayload,
  type BudgetRepository,
} from '../storage/repository';
import {
  bankCategoryMemory,
  budgetSettings,
  expenses,
  incomes,
  installments,
  investmentBuckets,
  months,
  recurringExpenses,
} from './db/schema';
import type { Database, Transaction } from './db/types';
import { homeTemplate } from './homeTemplate';
import { HttpError } from './httpError';
import { checkQuota, QUOTAS } from './quotas';

/**
 * What a sibling repository gets while writing inside the budget's transaction. The wallet uses
 * it to change its own tables and the month's expenses atomically — allocating to a bucket and
 * charging the category, launching a recurring expense, creating the charges of a plan.
 */
export interface MonthWriteContext {
  tx: Transaction;
  /** Adds (or replaces) an expense in `month`, creating the month if needed. Refuses closed months. */
  addExpense(month: Month, expense: Expense): Promise<void>;
  /** Months that already exist and are still open, oldest first. */
  openMonths(): Promise<Month[]>;
  /** Marks `month` as changed, so carryIn cascades from it when the transaction ends. */
  touch(month: Month): void;
}

/** The database or an open transaction: both run the same queries. */
type Executor = Database | Transaction;

type MonthRow = typeof months.$inferSelect;
type IncomeRow = typeof incomes.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;

/** Rows per INSERT when writing many entries at once (keeps well under Postgres' parameter limit). */
const INSERT_CHUNK = 500;

/** How long "Desfazer" can still take back an expense that went into an earlier (maybe closed) month. */
const LATE_EXPENSE_UNDO_MS = 10 * 60_000;

function toIncome(row: IncomeRow): Income {
  const income: Income = { id: row.id, source: row.source, amount: row.amount };
  if (row.date) income.date = row.date;
  if (row.topicId) income.topicId = row.topicId;
  if (row.tagIds.length > 0) income.tagIds = row.tagIds;
  return income;
}

/** A JSON list with one id, for `@>` ("has this tag") and `||` (adding it). */
const TAG_PER_ENTRY = TAG_LIMITS.perEntry;
const oneTag = (id: string) => sql`${JSON.stringify([id])}::jsonb`;

function toExpense(row: ExpenseRow): Expense {
  const expense: Expense = {
    id: row.id,
    categoryKind: row.categoryKind,
    description: row.description,
    amount: row.amount,
    date: row.date,
    singleInstallmentCard: row.card,
  };
  if (row.cardId) expense.cardId = row.cardId;
  if (row.topicId) expense.topicId = row.topicId;
  if (row.source) expense.source = row.source;
  if (row.installmentId) expense.installmentId = row.installmentId;
  if (row.installmentNumber !== null) expense.installmentNumber = row.installmentNumber;
  if (row.reimbursedAt) expense.reimbursedAt = row.reimbursedAt.toISOString();
  if (row.recurringId) expense.recurringId = row.recurringId;
  if (row.tagIds.length > 0) expense.tagIds = row.tagIds;
  return expense;
}

/**
 * The columns of an expense, without the keys that identify the row. `tagIds` are the ones it may
 * keep (see `cleanTagIds`); undefined leaves the tags of an expense that already exists alone —
 * what an older client, which does not know about tags, sends.
 */
function expenseValues(month: Month, expense: Expense, tagIds?: string[]) {
  return {
    ...(tagIds !== undefined ? { tagIds } : {}),
    month,
    categoryKind: expense.categoryKind,
    topicId: expense.topicId ?? null,
    description: expense.description,
    amount: expense.amount,
    date: expense.date,
    card: expense.singleInstallmentCard === true,
    cardId: expense.singleInstallmentCard === true ? (expense.cardId ?? null) : null,
    source: expense.source ?? null,
    installmentId: expense.installmentId ?? null,
    installmentNumber: expense.installmentNumber ?? null,
    // Only an "A receber" purchase can be settled, so moving it to another category clears it.
    reimbursedAt:
      expense.categoryKind === 'reimbursable' && expense.reimbursedAt ? new Date(expense.reimbursedAt) : null,
    recurringId: expense.recurringId ?? null,
  };
}

function groupByMonth<T extends { month: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.month);
    if (list) list.push(row);
    else grouped.set(row.month, [row]);
  }
  return grouped;
}

function chunks<T>(list: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
  return result;
}

/**
 * BudgetRepository on Postgres, scoped to one user: every write to a month re-cascades
 * carryIn for the later months (which only a closed month feeds, see `carrySource`), writes
 * to a closed month are rejected, and the default
 * categories are seeded on first read. Each month is stored as a `months` row plus its `incomes` and
 * `expenses` rows, and read back as the exact `MonthData` shape.
 *
 * Every write runs in a transaction holding a per-user advisory lock, so concurrent writes
 * (two devices, later the worker and voice entries) apply one after the other and the
 * carryIn cascade always works on the latest data.
 */
export class PostgresBudgetRepository implements BudgetRepository {
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSettings(): Promise<BudgetSettings> {
    return this.settingsIn(this.db);
  }

  async saveSettings(settings: BudgetSettings): Promise<void> {
    await this.write(async (tx) => {
      // Always the four categories: only their % and colour come from what was sent.
      const previous = await this.readSettings(tx);
      const topics = enforceFixedTopics(previous?.topics ?? settings.topics, settings.topics);
      await this.upsertSettings(tx, { ...settings, topics }, false);
    });
  }

  /** Marks this account as having finished (or skipped) the new-user wizard/tour, for good. */
  async completeOnboarding(): Promise<void> {
    await this.db
      .update(budgetSettings)
      .set({ onboardingCompleted: true })
      .where(eq(budgetSettings.userId, this.userId));
  }

  // -------------------------------------------------------------------------
  // Months (reads)
  // -------------------------------------------------------------------------

  async listMonths(): Promise<Month[]> {
    const rows = await this.db
      .select({ month: months.month })
      .from(months)
      .where(eq(months.userId, this.userId))
      .orderBy(asc(months.month));
    return rows.map((row) => row.month);
  }

  async getMonth(month: Month): Promise<MonthData | undefined> {
    const [data] = await this.loadMonths(this.db, eq(months.month, month));
    return data && this.withPurchaseDates(data);
  }

  async peekMonth(month: Month): Promise<MonthData> {
    return (await this.getMonth(month)) ?? this.withPurchaseDates(await this.buildMonth(this.db, month));
  }

  async ensureMonth(month: Month): Promise<MonthData> {
    return (await this.getMonth(month)) ?? this.write((tx) => this.ensureMonthIn(tx, month));
  }

  /**
   * The months before `month`, from the first one still open: what the turn of the month offers to
   * close, with the closed ones in between that the leftovers would go through. Empty with none open.
   */
  async monthsToClose(month: Month): Promise<MonthData[]> {
    const [first] = await this.db
      .select({ month: months.month })
      .from(months)
      .where(and(eq(months.userId, this.userId), eq(months.closed, false), lt(months.month, month)))
      .orderBy(asc(months.month))
      .limit(1);
    if (!first) return [];
    return this.loadMonths(this.db, and(gte(months.month, first.month), lt(months.month, month)));
  }

  // -------------------------------------------------------------------------
  // Entries
  // -------------------------------------------------------------------------

  async saveIncome(month: Month, income: Income): Promise<void> {
    await this.write(async (tx) => {
      await this.ensureOpenMonthIn(tx, month);
      const tagIds = await this.cleanTagIdsIn(tx, 'income', income.tagIds);
      const values = {
        month,
        source: income.source,
        amount: income.amount,
        date: income.date || null,
        topicId: income.topicId || null,
        ...(tagIds !== undefined ? { tagIds } : {}),
      };
      const [last] = await tx
        .select({
          position: max(incomes.position),
          others: sql<number>`count(*) filter (where ${incomes.id} <> ${income.id})`.mapWith(Number),
        })
        .from(incomes)
        .where(and(eq(incomes.userId, this.userId), eq(incomes.month, month)));
      checkQuota(
        last?.others ?? 0,
        QUOTAS.incomesPerMonth,
        `Dá para ter até ${QUOTAS.incomesPerMonth} rendas em um mês.`,
      );
      await tx
        .insert(incomes)
        .values({ userId: this.userId, id: income.id, position: (last?.position ?? -1) + 1, ...values })
        .onConflictDoUpdate({ target: [incomes.userId, incomes.id], set: values });
      await this.recascade(tx, month);
    });
  }

  async deleteIncome(month: Month, incomeId: string): Promise<void> {
    await this.write(async (tx) => {
      await this.requireOpenMonthIn(tx, month);
      await tx
        .delete(incomes)
        .where(and(eq(incomes.userId, this.userId), eq(incomes.month, month), eq(incomes.id, incomeId)));
      await this.recascade(tx, month);
    });
  }

  async saveExpense(month: Month, expense: Expense): Promise<void> {
    await this.write(async (tx) => {
      await this.ensureOpenMonthIn(tx, month);
      await this.insertExpenseIn(tx, month, expense);
      await this.recascade(tx, month);
    });
  }

  async deleteExpense(month: Month, expenseId: string): Promise<void> {
    await this.write(async (tx) => {
      await this.requireOpenMonthIn(tx, month);
      await tx
        .delete(expenses)
        .where(and(eq(expenses.userId, this.userId), eq(expenses.month, month), eq(expenses.id, expenseId)));
      await this.recascade(tx, month);
    });
  }

  /**
   * A new expense of "Lançar gasto", entered while in `month`. Dated in an earlier month already in
   * use, it goes there, even if that month is closed (see `lateExpenseDestination`); otherwise it is
   * an ordinary expense of `month`. Returns where it went when that was not `month`.
   */
  async saveNewExpense(month: Month, expense: Expense): Promise<LateExpenseDestination | null> {
    return this.write(async (tx) => {
      const destination = expense.installmentId
        ? null
        : lateExpenseDestination(month, expense.date, await this.monthStatuses(tx));
      if (!destination) await this.ensureOpenMonthIn(tx, month);
      const target = destination?.month ?? month;
      await this.insertExpenseIn(tx, target, expense);
      await this.recascade(tx, target);
      return destination;
    });
  }

  /** Where a new expense with this date would go from `month` (see `saveNewExpense`), shown before saving. */
  async lateExpenseDestination(month: Month, date: string): Promise<LateExpenseDestination | null> {
    return lateExpenseDestination(month, date, await this.monthStatuses(this.db));
  }

  /**
   * "Desfazer" right after `saveNewExpense` put an expense in an earlier month. That month may be
   * closed, so only an expense that has just been created there can be taken back this way.
   */
  async undoLateExpense(month: Month, expenseId: string): Promise<void> {
    await this.write(async (tx) => {
      const deleted = await tx
        .delete(expenses)
        .where(
          and(
            eq(expenses.userId, this.userId),
            eq(expenses.month, month),
            eq(expenses.id, expenseId),
            gte(expenses.createdAt, new Date(Date.now() - LATE_EXPENSE_UNDO_MS)),
          ),
        )
        .returning({ id: expenses.id });
      if (deleted.length === 0) {
        throw new HttpError(
          409,
          'UNDO_EXPIRED',
          'Esse gasto não dá mais para desfazer. Reabra o mês para excluir.',
        );
      }
      await this.recascade(tx, month);
    });
  }

  /**
   * Every "A receber" nobody paid back yet, from `until` and every month before it — the money
   * someone still owes does not go away when the month turns. Most recent first.
   */
  async pendingReimbursables(until: Month): Promise<PendingReimbursable[]> {
    const rows = await this.db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, this.userId),
          eq(expenses.categoryKind, 'reimbursable'),
          isNull(expenses.reimbursedAt),
          lte(expenses.month, until),
        ),
      )
      // Newest first, and within a day the last one made first (like the Lançamentos list).
      .orderBy(desc(expenses.date), desc(expenses.position));
    return rows.map((row) => ({ month: row.month, expense: toExpense(row) }));
  }

  /**
   * The "A receber" already marked as received since `since` (an ISO day): a Pix the bank brings
   * later may be what paid one of them back.
   */
  async receivedReimbursables(since: string): Promise<PendingReimbursable[]> {
    const rows = await this.db
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, this.userId),
          eq(expenses.categoryKind, 'reimbursable'),
          gte(expenses.reimbursedAt, new Date(`${since}T00:00:00Z`)),
        ),
      )
      .orderBy(desc(expenses.date), desc(expenses.position));
    return rows.map((row) => ({ month: row.month, expense: toExpense(row) }));
  }

  /**
   * "Já me pagou" (or undoing it). Allowed in a closed month too: it changes no number of the
   * budget — an "A receber" never consumed a category —, it only says who still owes.
   */
  async setReimbursed(month: Month, expenseId: string, reimbursedAt: string | null): Promise<void> {
    const updated = await this.db
      .update(expenses)
      .set({ reimbursedAt: reimbursedAt ? new Date(reimbursedAt) : null })
      .where(
        and(
          eq(expenses.userId, this.userId),
          eq(expenses.month, month),
          eq(expenses.id, expenseId),
          eq(expenses.categoryKind, 'reimbursable'),
        ),
      )
      .returning({ id: expenses.id });
    if (updated.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Esse gasto a receber não existe mais.');
  }

  // -------------------------------------------------------------------------
  // Tags: labels that change no number (lib/budget/tags.ts)
  // -------------------------------------------------------------------------

  /**
   * Puts or takes tags off an expense or an income. Allowed in a closed month too, like "Já me
   * pagou": a tag changes no number of the budget, so nothing is recomputed either.
   */
  async setEntryTags(month: Month, kind: TagKind, entryId: string, tagIds: string[]): Promise<void> {
    await this.write(async (tx) => {
      const clean = (await this.cleanTagIdsIn(tx, kind, tagIds)) ?? [];
      const table = kind === 'expense' ? expenses : incomes;
      const updated = await tx
        .update(table)
        .set({ tagIds: clean })
        .where(and(eq(table.userId, this.userId), eq(table.month, month), eq(table.id, entryId)))
        .returning({ id: table.id });
      if (updated.length === 0) {
        throw new HttpError(404, 'NOT_FOUND', kind === 'expense' ? 'Esse gasto não existe mais.' : 'Essa renda não existe mais.');
      }
    });
  }

  /**
   * Creates a tag or changes one (its name, its colour, its place). The kind of a tag never
   * changes. A name already taken in the same kind, or the name of a category, is refused.
   * Returns every tag of the account.
   */
  async saveTag(tag: Tag): Promise<Tag[]> {
    return this.write(async (tx) => {
      const settings = await this.settingsIn(tx);
      const tags = settings.tags ?? [];
      const existing = tags.find((item) => item.id === tag.id);
      const kind = existing?.kind ?? tag.kind;
      const problem = tagNameProblem(tag.name, kind, tags, settings.topics, existing?.id);
      if (problem) throw new HttpError(400, 'INVALID_INPUT', problem);
      const saved: Tag = {
        id: tag.id,
        name: tag.name.replace(/\s+/g, ' ').trim(),
        kind,
        order: tag.order,
        ...(tag.color ? { color: tag.color } : {}),
      };
      const next = existing ? tags.map((item) => (item.id === tag.id ? saved : item)) : [...tags, saved];
      await this.writeTags(tx, next);
      return next;
    });
  }

  /**
   * Deletes a tag and takes it off every expense, income, recurring template and instalment plan,
   * in one transaction. The numbers do not change. Returns the tags left and where this one was,
   * which is what "Desfazer" (`restoreTag`) needs.
   */
  async deleteTag(id: string): Promise<{ tags: Tag[]; refs: TagRefs }> {
    return this.write(async (tx) => {
      const tags = (await this.settingsIn(tx)).tags ?? [];
      const refs: TagRefs = { expenses: [], incomes: [], recurring: [], installments: [] };
      if (!tags.some((tag) => tag.id === id)) return { tags, refs };

      const without = (column: AnyColumn) => sql`${column} - ${id}::text`;
      refs.expenses = await tx
        .update(expenses)
        .set({ tagIds: without(expenses.tagIds) })
        .where(and(eq(expenses.userId, this.userId), sql`${expenses.tagIds} @> ${oneTag(id)}`))
        .returning({ month: expenses.month, id: expenses.id });
      refs.incomes = await tx
        .update(incomes)
        .set({ tagIds: without(incomes.tagIds) })
        .where(and(eq(incomes.userId, this.userId), sql`${incomes.tagIds} @> ${oneTag(id)}`))
        .returning({ month: incomes.month, id: incomes.id });
      refs.recurring = (
        await tx
          .update(recurringExpenses)
          .set({ tagIds: without(recurringExpenses.tagIds) })
          .where(and(eq(recurringExpenses.userId, this.userId), sql`${recurringExpenses.tagIds} @> ${oneTag(id)}`))
          .returning({ id: recurringExpenses.id })
      ).map((row) => row.id);
      refs.installments = (
        await tx
          .update(installments)
          .set({ tagIds: without(installments.tagIds) })
          .where(and(eq(installments.userId, this.userId), sql`${installments.tagIds} @> ${oneTag(id)}`))
          .returning({ id: installments.id })
      ).map((row) => row.id);

      const next = tags.filter((tag) => tag.id !== id);
      await this.writeTags(tx, next);
      return { tags: next, refs };
    });
  }

  /**
   * "Desfazer" after `deleteTag`: the tag comes back and goes back on the entries, templates and
   * plans it was on (those that still exist and still have room for it). Returns every tag.
   */
  async restoreTag(tag: Tag, refs: TagRefs): Promise<Tag[]> {
    return this.write(async (tx) => {
      const settings = await this.settingsIn(tx);
      const tags = settings.tags ?? [];
      let next = tags;
      if (!tags.some((item) => item.id === tag.id)) {
        const problem = tagNameProblem(tag.name, tag.kind, tags, settings.topics);
        if (problem) throw new HttpError(409, 'CONFLICT', problem);
        next = [...tags, tag];
        await this.writeTags(tx, next);
      }

      const withTag = (column: AnyColumn) => sql`${column} || ${oneTag(tag.id)}`;
      const room = (column: AnyColumn) =>
        sql`not (${column} @> ${oneTag(tag.id)}) and jsonb_array_length(${column}) < ${TAG_PER_ENTRY}`;
      const kindIs = (kind: TagKind) => tag.kind === kind;
      if (kindIs('expense') && refs.expenses.length > 0) {
        await tx
          .update(expenses)
          .set({ tagIds: withTag(expenses.tagIds) })
          .where(
            and(
              eq(expenses.userId, this.userId),
              inArray(
                expenses.id,
                refs.expenses.map((ref) => ref.id),
              ),
              room(expenses.tagIds),
            ),
          );
      }
      if (kindIs('income') && refs.incomes.length > 0) {
        await tx
          .update(incomes)
          .set({ tagIds: withTag(incomes.tagIds) })
          .where(
            and(
              eq(incomes.userId, this.userId),
              inArray(
                incomes.id,
                refs.incomes.map((ref) => ref.id),
              ),
              room(incomes.tagIds),
            ),
          );
      }
      if (kindIs('expense') && refs.recurring.length > 0) {
        await tx
          .update(recurringExpenses)
          .set({ tagIds: withTag(recurringExpenses.tagIds) })
          .where(
            and(
              eq(recurringExpenses.userId, this.userId),
              inArray(recurringExpenses.id, refs.recurring),
              room(recurringExpenses.tagIds),
            ),
          );
      }
      if (kindIs('expense') && refs.installments.length > 0) {
        await tx
          .update(installments)
          .set({ tagIds: withTag(installments.tagIds) })
          .where(
            and(
              eq(installments.userId, this.userId),
              inArray(installments.id, refs.installments),
              room(installments.tagIds),
            ),
          );
      }
      return next;
    });
  }

  /** How many expenses and incomes carry each tag, by tag id (a tag on nothing is absent). */
  async tagUsage(): Promise<Record<string, number>> {
    const usage: Record<string, number> = {};
    for (const table of [expenses, incomes] as const) {
      const rows = await this.db
        .select({
          tag: sql<string>`jsonb_array_elements_text(${table.tagIds})`,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(table)
        .where(eq(table.userId, this.userId))
        .groupBy(sql`1`);
      for (const row of rows) usage[row.tag] = (usage[row.tag] ?? 0) + row.count;
    }
    return usage;
  }

  /** The ids an entry of `kind` may keep (see `cleanTagIds`); undefined stays undefined. */
  async cleanTagIdsIn(ex: Executor, kind: TagKind, tagIds: string[] | undefined): Promise<string[] | undefined> {
    if (tagIds === undefined) return undefined;
    if (tagIds.length === 0) return [];
    return cleanTagIds(tagIds, tagIdSet(await this.readSettings(ex), kind));
  }

  private async writeTags(tx: Transaction, tags: Tag[]): Promise<void> {
    await tx.update(budgetSettings).set({ tags }).where(eq(budgetSettings.userId, this.userId));
  }

  // -------------------------------------------------------------------------
  // Month lifecycle
  // -------------------------------------------------------------------------

  async closeMonth(month: Month, openNext = false, dropLeftovers = false): Promise<void> {
    await this.write(async (tx) => {
      await this.ensureMonthIn(tx, month);
      await tx
        .update(months)
        .set({ closed: true, closedAt: new Date(), leftoversDropped: dropLeftovers })
        .where(this.monthKey(month));
      // "Fechar mês" closes and opens in one go: the next month is created inside this same
      // transaction, already carrying each category's leftover from the month just closed.
      if (openNext) await this.ensureMonthIn(tx, nextMonth(month));
      // The months after it may already be in use: the answer about the leftovers reaches them too.
      await this.recascade(tx, month);
    });
  }

  /**
   * "Fechar todos os meses anteriores": every month before `month` still open, at once. Each one
   * passes its leftovers on to the next; the answer is about what reaches `month`, so it goes on the
   * last month before it, even if that one was already closed.
   */
  async closeMonthsBefore(month: Month, dropLeftovers = false): Promise<void> {
    await this.write(async (tx) => {
      const before = and(eq(months.userId, this.userId), lt(months.month, month));
      const rows = await tx
        .select({ month: months.month, closed: months.closed })
        .from(months)
        .where(before)
        .orderBy(asc(months.month));
      const first = rows.find((row) => !row.closed);
      const last = rows.at(-1);
      if (!first || !last) return;

      await tx
        .update(months)
        .set({ closed: true, closedAt: new Date() })
        .where(and(before, eq(months.closed, false)));
      await tx.update(months).set({ leftoversDropped: dropLeftovers }).where(this.monthKey(last.month));
      await this.recascade(tx, first.month);
    });
  }

  /** The leftovers go back to the month reopened: the months after it lose them until it closes again. */
  async reopenMonth(month: Month): Promise<void> {
    await this.write(async (tx) => {
      if (!(await this.monthRow(tx, month))) throw new MonthNotFoundError(month);
      await tx
        .update(months)
        .set({ closed: false, closedAt: null, leftoversDropped: false })
        .where(this.monthKey(month));
      await this.recascade(tx, month);
    });
  }

  async deleteMonth(month: Month): Promise<void> {
    await this.write(async (tx) => {
      const deleted = await tx.delete(months).where(this.monthKey(month)).returning({ month: months.month });
      if (deleted.length === 0) return;

      // A month before the deleted one feeds the months after it: cascade from there.
      const [previous] = await tx
        .select({ month: months.month })
        .from(months)
        .where(and(eq(months.userId, this.userId), lt(months.month, month)))
        .orderBy(desc(months.month))
        .limit(1);
      if (previous) {
        await this.recascade(tx, previous.month);
        return;
      }

      // The deleted month was the earliest: the new earliest has nothing before it, so its
      // carryIn drops to zero before cascading forward.
      const [earliest] = await tx
        .select()
        .from(months)
        .where(eq(months.userId, this.userId))
        .orderBy(asc(months.month))
        .limit(1);
      if (!earliest) return;
      const zeroCarryIn = Object.fromEntries(earliest.topicsSnapshot.map((t) => [t.id, 0]));
      await tx.update(months).set({ carryIn: zeroCarryIn }).where(this.monthKey(earliest.month));
      await this.recascade(tx, earliest.month);
    });
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  async exportData(): Promise<BackupPayload> {
    const settings = await this.getSettings();
    const allMonths = await this.loadMonths(this.db);
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      months: allMonths,
    };
  }

  /** Replaces all of this account's data with the backup (settings, including the onboarding flag, and every month). */
  async importData(payload: BackupPayload): Promise<void> {
    // A backup from before the four fixed categories may have others: they fold into Prazeres e
    // Confortos, with their entries and leftovers (`consolidateBudgetData`).
    const consolidated = consolidateBudgetData(payload.settings, payload.months);
    const settings = { ...consolidated.settings, tags: sanitizeTags(consolidated.settings.tags, consolidated.settings.topics) };
    const monthList = consolidated.months;
    await this.write(async (tx) => {
      await tx.delete(months).where(eq(months.userId, this.userId));
      await this.upsertSettings(tx, settings, true);
      await this.insertMonths(tx, monthList, settings);
      // A backup from before leftovers needed a closed month still has them on open months.
      const [earliest] = monthList.map((data) => data.month).sort();
      if (earliest) await this.recascade(tx, earliest);
    });
  }

  /**
   * The four fixed categories, applied to what this account already has (the one-off migration,
   * lib/server/fixedTopicsMigration.ts): the four get their fixed name and description — in the
   * settings and in every month's own copy — and any other category goes away. What pointed at
   * one (expenses, incomes sent to it, recurring templates, instalment plans, reserve buckets,
   * the bank's category memory, the quick categories) moves to Prazeres e Confortos, and so do
   * its % and its leftovers, so the numbers add up to what they did. Running it again changes
   * nothing. Returns how many categories went away and how many entries moved.
   */
  async applyFixedTopics(): Promise<{ topics: number; entries: number }> {
    return this.write(async (tx) => {
      const settings = await this.readSettings(tx);
      if (!settings) return { topics: 0, entries: 0 };

      const { topics, moved } = consolidateTopics(settings.topics);
      const { settings: fixedSettings } = consolidateBudgetData(settings, []);
      await tx
        .update(budgetSettings)
        .set({ topics, quickCategories: fixedSettings.quickCategories ?? null })
        .where(eq(budgetSettings.userId, this.userId));

      const fixedIds = topics.map((topic) => topic.id);
      const main = fixedIds[0];
      let entries = 0;
      for (const table of [
        expenses,
        incomes,
        recurringExpenses,
        installments,
        investmentBuckets,
        bankCategoryMemory,
      ] as const) {
        const changed = await tx
          .update(table)
          .set({ topicId: main })
          .where(
            and(eq(table.userId, this.userId), isNotNull(table.topicId), notInArray(table.topicId, fixedIds)),
          )
          .returning({ userId: table.userId });
        entries += changed.length;
      }

      const rows = await tx
        .select({ month: months.month, carryIn: months.carryIn, topicsSnapshot: months.topicsSnapshot })
        .from(months)
        .where(eq(months.userId, this.userId))
        .orderBy(asc(months.month));
      for (const row of rows) {
        const next = consolidateMonthTopics(row.topicsSnapshot, row.carryIn, topics);
        if (
          JSON.stringify(next.topicsSnapshot) === JSON.stringify(row.topicsSnapshot) &&
          JSON.stringify(next.carryIn) === JSON.stringify(row.carryIn)
        ) {
          continue;
        }
        await tx.update(months).set(next).where(this.monthKey(row.month));
      }

      const removed = Object.keys(moved).length;
      if ((removed > 0 || entries > 0) && rows[0]) await this.recascade(tx, rows[0].month);
      return { topics: removed, entries };
    });
  }

  /** Recomputes the carryIn of every month of this account, from the first one on. */
  async recascadeAll(): Promise<void> {
    await this.write(async (tx) => {
      const [earliest] = await tx
        .select({ month: months.month })
        .from(months)
        .where(eq(months.userId, this.userId))
        .orderBy(asc(months.month))
        .limit(1);
      if (earliest) await this.recascade(tx, earliest.month);
    });
  }

  async clearAll(): Promise<void> {
    await this.write(async (tx) => {
      await tx.delete(months).where(eq(months.userId, this.userId));
      await tx.delete(budgetSettings).where(eq(budgetSettings.userId, this.userId));
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Runs `fn` in a transaction holding this user's advisory lock (released at commit/rollback). */
  private write<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${this.userId}, 0))`);
      return fn(tx);
    });
  }

  /**
   * Runs `fn` inside this user's write transaction (see `MonthWriteContext`) and, at the end,
   * re-cascades carryIn from the earliest month it touched. Everything `fn` does commits or
   * rolls back together with the expenses it created.
   */
  writeWith<T>(fn: (ctx: MonthWriteContext) => Promise<T>): Promise<T> {
    return this.write(async (tx) => {
      let earliest: Month | undefined;
      const touch = (month: Month) => {
        if (!earliest || month < earliest) earliest = month;
      };

      const result = await fn({
        tx,
        touch,
        addExpense: async (month, expense) => {
          await this.ensureOpenMonthIn(tx, month);
          await this.insertExpenseIn(tx, month, expense);
          touch(month);
        },
        openMonths: async () => {
          const rows = await tx
            .select({ month: months.month })
            .from(months)
            .where(and(eq(months.userId, this.userId), eq(months.closed, false)))
            .orderBy(asc(months.month));
          return rows.map((row) => row.month);
        },
      });

      if (earliest) await this.recascade(tx, earliest);
      return result;
    });
  }

  /** Writes one expense, keeping its place in the month's list (a new one goes last). */
  private async insertExpenseIn(tx: Transaction, month: Month, expense: Expense): Promise<void> {
    const values = expenseValues(month, expense, await this.cleanTagIdsIn(tx, 'expense', expense.tagIds));
    const [last] = await tx
      .select({
        position: max(expenses.position),
        others: sql<number>`count(*) filter (where ${expenses.id} <> ${expense.id})`.mapWith(Number),
      })
      .from(expenses)
      .where(and(eq(expenses.userId, this.userId), eq(expenses.month, month)));
    checkQuota(
      last?.others ?? 0,
      QUOTAS.expensesPerMonth,
      `Dá para ter até ${QUOTAS.expensesPerMonth} gastos em um mês.`,
    );
    await tx
      .insert(expenses)
      .values({ userId: this.userId, id: expense.id, position: (last?.position ?? -1) + 1, ...values })
      .onConflictDoUpdate({ target: [expenses.userId, expenses.id], set: values });
  }

  /**
   * This user's instalment plans, for the charges that belong to a month. `paidCount` and
   * `advancedCount` come along on purpose: opening a month must not resurrect a charge that was
   * paid before the purchase was registered, or one that was brought forward.
   */
  private async loadInstallmentPlans(ex: Executor): Promise<InstallmentPlan[]> {
    const rows = await ex
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

  /**
   * Gives every instalment of `data` the day its purchase was made (`Expense.purchaseDate`), so
   * the lists place it there and not on the day the bank debits it. Only for reading: the stored
   * expense keeps its charge date alone.
   */
  private async withPurchaseDates(data: MonthData): Promise<MonthData> {
    const ids = [...new Set(data.expenses.flatMap((e) => (e.installmentId ? [e.installmentId] : [])))];
    if (ids.length === 0) return data;
    const rows = await this.db
      .select({
        id: installments.id,
        purchaseDate: installments.purchaseDate,
        firstDebitDate: installments.firstDebitDate,
      })
      .from(installments)
      .where(and(eq(installments.userId, this.userId), inArray(installments.id, ids)));
    const purchased = new Map(rows.map((row) => [row.id, row.purchaseDate ?? row.firstDebitDate]));
    return {
      ...data,
      expenses: data.expenses.map((expense) => {
        const purchaseDate = expense.installmentId && purchased.get(expense.installmentId);
        return purchaseDate ? { ...expense, purchaseDate } : expense;
      }),
    };
  }

  /** The instalments charged during `month`, as expenses (correction 9 of the bot spec). */
  private async installmentExpensesFor(ex: Executor, month: Month): Promise<Expense[]> {
    const plans = await this.loadInstallmentPlans(ex);
    return installmentsDueIn(plans, month).map(({ plan, number, dueDate }) =>
      installmentExpense(plan, number, dueDate),
    );
  }

  private monthKey(month: Month): SQL {
    return and(eq(months.userId, this.userId), eq(months.month, month)) as SQL;
  }

  private async monthRow(ex: Executor, month: Month): Promise<MonthRow | undefined> {
    const [row] = await ex.select().from(months).where(this.monthKey(month));
    return row;
  }

  /** Every month in use, oldest first, with whether (and how) it was closed. */
  private async monthStatuses(ex: Executor): Promise<MonthStatus[]> {
    const rows = await ex
      .select({ month: months.month, closed: months.closed, leftoversDropped: months.leftoversDropped })
      .from(months)
      .where(eq(months.userId, this.userId))
      .orderBy(asc(months.month));
    return rows;
  }

  private async requireOpenMonthIn(tx: Transaction, month: Month): Promise<void> {
    const row = await this.monthRow(tx, month);
    if (!row) throw new MonthNotFoundError(month);
    if (row.closed) throw new MonthClosedError(month);
  }

  /** Like `requireOpenMonthIn`, but creates and persists the month first if it doesn't exist yet. */
  private async ensureOpenMonthIn(tx: Transaction, month: Month): Promise<void> {
    const row = await this.monthRow(tx, month);
    if (row?.closed) throw new MonthClosedError(month);
    if (!row) await this.ensureMonthIn(tx, month);
  }

  private async ensureMonthIn(tx: Transaction, month: Month): Promise<MonthData> {
    const [existing] = await this.loadMonths(tx, eq(months.month, month));
    if (existing) return existing;

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(months)
      .where(eq(months.userId, this.userId));
    checkQuota(total, QUOTAS.months, `Dá para ter até ${QUOTAS.months} meses na conta.`);

    const created = await this.buildMonth(tx, month);
    await tx
      .insert(months)
      .values({
        userId: this.userId,
        month,
        carryIn: created.carryIn,
        topicsSnapshot: created.topicsSnapshot,
      })
      .onConflictDoNothing();
    // The instalments charged this month become real expenses as soon as the month exists;
    // `buildMonth` already put them in `created`, so the preview and the month agree.
    for (const expense of created.expenses) await this.insertExpenseIn(tx, month, expense);
    return created;
  }

  /** Computes a fresh month (rollover carryIn from the latest prior month) without persisting it. */
  private async buildMonth(ex: Executor, month: Month): Promise<MonthData> {
    const settings = await this.settingsIn(ex);
    const [prior] = await ex
      .select({ month: months.month })
      .from(months)
      .where(and(eq(months.userId, this.userId), lt(months.month, month)))
      .orderBy(desc(months.month))
      .limit(1);
    const [previous] = prior ? await this.loadMonths(ex, eq(months.month, prior.month)) : [];
    const created = createMonthData(month, settings.topics, carrySource(previous, computeMonthSummary));
    // A month that does not exist yet still shows the instalments it will be charged, so the
    // preview never changes the moment something is written to it.
    return { ...created, expenses: await this.installmentExpensesFor(ex, month) };
  }

  /** This user's months matching `filter` (all of them without one), oldest first, with their entries. */
  private async loadMonths(ex: Executor, filter?: SQL): Promise<MonthData[]> {
    const rows = await ex
      .select()
      .from(months)
      .where(and(eq(months.userId, this.userId), filter))
      .orderBy(asc(months.month));
    if (rows.length === 0) return [];

    const keys = rows.map((row) => row.month);
    const incomeRows = await ex
      .select()
      .from(incomes)
      .where(and(eq(incomes.userId, this.userId), inArray(incomes.month, keys)))
      .orderBy(asc(incomes.position));
    const expenseRows = await ex
      .select()
      .from(expenses)
      .where(and(eq(expenses.userId, this.userId), inArray(expenses.month, keys)))
      .orderBy(asc(expenses.position));

    const incomesByMonth = groupByMonth(incomeRows);
    const expensesByMonth = groupByMonth(expenseRows);
    return rows.map((row) => ({
      month: row.month,
      incomes: (incomesByMonth.get(row.month) ?? []).map(toIncome),
      expenses: (expensesByMonth.get(row.month) ?? []).map(toExpense),
      carryIn: row.carryIn,
      topicsSnapshot: row.topicsSnapshot,
      closed: row.closed,
      ...(row.leftoversDropped ? { leftoversDropped: true } : {}),
    }));
  }

  /** Recomputes carryIn for `fromMonth` onward in cascade and persists what changed. */
  private async recascade(tx: Transaction, fromMonth: Month): Promise<void> {
    const chain = await this.loadMonths(tx, gte(months.month, fromMonth));
    if (chain.length === 0) return;

    const updated = cascadeCarryIn(chain, computeMonthSummary);
    for (let i = 0; i < updated.length; i++) {
      if (JSON.stringify(updated[i].carryIn) === JSON.stringify(chain[i].carryIn)) continue;
      await tx.update(months).set({ carryIn: updated[i].carryIn }).where(this.monthKey(updated[i].month));
    }
  }

  private async settingsIn(ex: Executor): Promise<BudgetSettings> {
    const existing = await this.readSettings(ex);
    if (existing) return existing;

    // First read for this account: seed the default categories (no demo month) and the Início of
    // the template (lib/server/homeTemplate.ts). Only this first-ever row is created with the
    // onboarding still pending.
    const defaults = createDefaultSettings();
    const home = await homeTemplate(ex);
    await ex
      .insert(budgetSettings)
      .values({
        userId: this.userId,
        topics: defaults.topics,
        specialCategories: defaults.specialCategories,
        specialCategoryColors: defaults.specialCategoryColors ?? {},
        modules: defaults.modules ?? {},
        onboardingCompleted: false,
        ...(home ? { homePages: home.homePages, homeCardSizes: home.homeCardSizes } : {}),
      })
      .onConflictDoNothing();

    const seeded = await this.readSettings(ex);
    if (!seeded) throw new Error('Não foi possível inicializar as configurações.');
    return seeded;
  }

  private async readSettings(ex: Executor): Promise<BudgetSettings | undefined> {
    const [row] = await ex.select().from(budgetSettings).where(eq(budgetSettings.userId, this.userId));
    if (!row) return undefined;
    return {
      topics: row.topics,
      // Rows written before a label/color/module existed get the default for it.
      specialCategories: { ...DEFAULT_SPECIAL_CATEGORY_LABELS, ...row.specialCategories },
      specialCategoryColors: { ...DEFAULT_SPECIAL_CATEGORY_COLORS, ...row.specialCategoryColors },
      onboardingCompleted: row.onboardingCompleted,
      modules: row.modules,
      nav: row.nav,
      dismissedNotices: row.dismissedNotices,
      notificationPrefs: row.notificationPrefs,
      homeOrder: row.homeOrder,
      homePages: row.homePages,
      homeCardSizes: row.homeCardSizes,
      homeHidden: row.homeHidden,
      quickCategories: row.quickCategories,
      tags: row.tags,
    };
  }

  /**
   * Saving settings from the app never touches the onboarding flag (only `completeOnboarding`
   * does), and leaves the modules, the Início and the dismissed notices alone unless the
   * payload actually carries them — an older client (a cached bundle that predates them) must
   * not wipe them. Restoring a backup replaces all of it, along with everything else.
   */
  private async upsertSettings(
    ex: Executor,
    settings: BudgetSettings,
    restoringBackup: boolean,
  ): Promise<void> {
    const values = {
      topics: settings.topics,
      specialCategories: settings.specialCategories,
      specialCategoryColors: settings.specialCategoryColors ?? {},
      ...(restoringBackup || settings.modules !== undefined ? { modules: settings.modules ?? {} } : {}),
      ...(restoringBackup || settings.nav !== undefined ? { nav: settings.nav ?? null } : {}),
      ...(restoringBackup || settings.dismissedNotices !== undefined
        ? { dismissedNotices: settings.dismissedNotices ?? [] }
        : {}),
      ...(restoringBackup || settings.notificationPrefs !== undefined
        ? { notificationPrefs: settings.notificationPrefs ?? {} }
        : {}),
      ...(restoringBackup || settings.homeOrder !== undefined
        ? { homeOrder: settings.homeOrder ?? null }
        : {}),
      ...(restoringBackup || settings.homePages !== undefined
        ? { homePages: settings.homePages ?? null }
        : {}),
      ...(restoringBackup || settings.homeCardSizes !== undefined
        ? { homeCardSizes: settings.homeCardSizes ?? {} }
        : {}),
      ...(restoringBackup || settings.homeHidden !== undefined
        ? { homeHidden: settings.homeHidden ?? [] }
        : {}),
      ...(restoringBackup || settings.quickCategories !== undefined
        ? { quickCategories: settings.quickCategories ?? null }
        : {}),
      ...(restoringBackup && settings.onboardingCompleted !== undefined
        ? { onboardingCompleted: settings.onboardingCompleted }
        : {}),
      // The tags change only through their own operations (`saveTag`, `deleteTag`): a save built
      // from settings read a moment earlier must not bring back a deleted tag nor drop a new one.
      ...(restoringBackup ? { tags: settings.tags ?? [] } : {}),
    };
    await ex
      .insert(budgetSettings)
      .values({ userId: this.userId, ...values })
      .onConflictDoUpdate({ target: budgetSettings.userId, set: values });
  }

  /** Inserts whole months (row + entries, keeping each list's order), with the tags `settings` has. */
  private async insertMonths(tx: Transaction, list: MonthData[], settings: BudgetSettings): Promise<void> {
    if (list.length === 0) return;
    const expenseTags = tagIdSet(settings, 'expense');
    const incomeTags = tagIdSet(settings, 'income');

    await tx.insert(months).values(
      list.map((m) => ({
        userId: this.userId,
        month: m.month,
        carryIn: m.carryIn,
        topicsSnapshot: m.topicsSnapshot,
        closed: m.closed ?? false,
        closedAt: m.closed ? new Date() : null,
        leftoversDropped: m.leftoversDropped ?? false,
      })),
    );

    const incomeRows = list.flatMap((m) =>
      m.incomes.map((income, position) => ({
        userId: this.userId,
        id: income.id,
        month: m.month,
        source: income.source,
        amount: income.amount,
        date: income.date || null,
        topicId: income.topicId || null,
        tagIds: cleanTagIds(income.tagIds, incomeTags),
        position,
      })),
    );
    for (const chunk of chunks(incomeRows, INSERT_CHUNK)) await tx.insert(incomes).values(chunk);

    const expenseRows = list.flatMap((m) =>
      m.expenses.map((expense, position) => ({
        userId: this.userId,
        id: expense.id,
        position,
        ...expenseValues(m.month, expense, cleanTagIds(expense.tagIds, expenseTags)),
      })),
    );
    for (const chunk of chunks(expenseRows, INSERT_CHUNK)) await tx.insert(expenses).values(chunk);
  }
}
