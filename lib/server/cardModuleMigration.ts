import { and, eq, isNull, sql } from 'drizzle-orm';
import { UNASSIGNED_CARD_ID } from '../budget/cards';
import { currentMonthKey, nextMonth } from '../budget/date';
import type { Month } from '../budget/types';
import { migrateCardModule } from '../modules/migration';
import { budgetSettings, cardBillPayments, expenses, installments, jobRuns } from './db/schema';
import type { Database } from './db/types';

/**
 * Brings every existing account over to the single "Cartão" module. It runs once, on the first
 * start after the update (a row in `job_runs` is the marker), and does three things nobody
 * should have to do by hand:
 *
 * 1. **The modules.** Whoever had "Cartões" or "Parcelados" on now has "Cartão" on, and the old
 *    keys leave the bottom bar and the Início order, turned into `card` in the same position.
 * 2. **The old "Não informado" bills.** Until now the purchases with no card left the debt on
 *    their own, on the 1st of the next month. From now on no bill leaves on its own, so without
 *    care every old purchase would come back as an open debt. The competences before the
 *    current one are therefore archived as paid, dated exactly when they used to clear — the
 *    current competence stays open, for the person to mark when they pay it.
 * 3. **The "à vista" plans.** Their single expense is now recognised by `installment_number = 0`
 *    (that is what keeps it out of the bill while its instalments are on it). The expense each
 *    one created is linked back to its plan, but only where the match is unambiguous; anything
 *    else is left exactly as it is, because inventing a link is worse than not having one.
 */

export const CARD_MODULE_MIGRATION_JOB = 'card-module-migration';

export interface CardModuleMigrationResult {
  /** Already done on an earlier start: nothing was touched. */
  skipped: boolean;
  accounts: number;
  archivedBills: number;
  linkedUpfront: number;
}

export async function runCardModuleMigration(
  db: Database,
  now: Date = new Date(),
): Promise<CardModuleMigrationResult> {
  const marked = await db
    .insert(jobRuns)
    .values({ name: CARD_MODULE_MIGRATION_JOB, lastRunAt: now })
    .onConflictDoNothing()
    .returning({ name: jobRuns.name });
  if (marked.length === 0) {
    return { skipped: true, accounts: 0, archivedBills: 0, linkedUpfront: 0 };
  }

  const month = currentMonthKey(now);
  const accounts = await migrateModuleFlags(db);
  const archivedBills = await archiveUnassignedBills(db, month);
  const linkedUpfront = await linkUpfrontExpenses(db);

  console.info(
    `[cartão] migração do módulo único: ${accounts} conta(s) ajustada(s), ` +
      `${archivedBills} fatura(s) "Não informado" arquivada(s), ` +
      `${linkedUpfront} gasto(s) de compra à vista ligado(s) ao parcelamento.`,
  );
  return { skipped: false, accounts, archivedBills, linkedUpfront };
}

/** Step 1: `cards`/`installments` become `card`, in the flags, the bottom bar and Início. */
async function migrateModuleFlags(db: Database): Promise<number> {
  const rows = await db
    .select({
      userId: budgetSettings.userId,
      modules: budgetSettings.modules,
      nav: budgetSettings.nav,
      homeOrder: budgetSettings.homeOrder,
    })
    .from(budgetSettings);

  let changed = 0;
  for (const row of rows) {
    const next = migrateCardModule({ modules: row.modules, nav: row.nav, homeOrder: row.homeOrder });
    if (!next.changed) continue;
    await db
      .update(budgetSettings)
      .set({ modules: next.modules, nav: next.nav, homeOrder: next.homeOrder })
      .where(eq(budgetSettings.userId, row.userId));
    changed += 1;
  }
  return changed;
}

/**
 * Step 2: archives the "Não informado" bills of the competences before the current one, dated
 * the 1st of the following month — the very day they used to clear by themselves.
 */
async function archiveUnassignedBills(db: Database, month: Month): Promise<number> {
  const rows = await db
    .select({
      userId: expenses.userId,
      month: expenses.month,
      total: sql<string>`sum(${expenses.amount})`,
    })
    .from(expenses)
    .leftJoin(
      installments,
      and(eq(installments.userId, expenses.userId), eq(installments.id, expenses.installmentId)),
    )
    .where(
      and(
        eq(expenses.card, true),
        isNull(expenses.cardId),
        isNull(installments.cardId),
        sql`${expenses.month} < ${month}`,
        sql`(${expenses.installmentId} is null or ${expenses.installmentNumber} >= 1)`,
      ),
    )
    .groupBy(expenses.userId, expenses.month);

  let archived = 0;
  for (const row of rows) {
    const total = Number(row.total);
    if (!(total > 0)) continue;
    const inserted = await db
      .insert(cardBillPayments)
      .values({
        userId: row.userId,
        cardId: UNASSIGNED_CARD_ID,
        month: row.month,
        amount: total,
        paidAt: new Date(`${nextMonth(row.month)}-01T12:00:00.000Z`),
      })
      .onConflictDoNothing()
      .returning({ month: cardBillPayments.month });
    archived += inserted.length;
  }
  return archived;
}

/** Step 3: links each "à vista" plan to the single expense it created, when there is just one. */
async function linkUpfrontExpenses(db: Database): Promise<number> {
  const plans = await db.select().from(installments).where(eq(installments.accounting, 'upfront'));

  let linked = 0;
  for (const plan of plans) {
    const candidates = await db
      .select({ id: expenses.id, month: expenses.month, date: expenses.date })
      .from(expenses)
      .where(
        and(
          eq(expenses.userId, plan.userId),
          eq(expenses.source, 'installment'),
          isNull(expenses.installmentId),
          eq(expenses.description, plan.name),
          sql`${expenses.amount} = ${plan.totalAmount}`,
        ),
      );
    // Two expenses that look alike is not a match anybody can be sure of: leave them be.
    if (candidates.length !== 1) continue;
    const [expense] = candidates;

    await db
      .update(expenses)
      .set({ installmentId: plan.id, installmentNumber: 0 })
      .where(and(eq(expenses.userId, plan.userId), eq(expenses.id, expense.id)));
    // The plan remembers the day of the purchase, so editing it later rebuilds the expense
    // where the person put it, not on the day of the first charge.
    await db
      .update(installments)
      .set({ purchaseDate: expense.date })
      .where(and(eq(installments.userId, plan.userId), eq(installments.id, plan.id)));
    linked += 1;
  }
  return linked;
}
