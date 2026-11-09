import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  bankCategoryMemory,
  bankConnections,
  bankKeys,
  bankSettings,
  budgetSettings,
  cardBillPayments,
  cards,
  cardSettings,
  cashSettings,
  diagramAssets,
  diagramContributions,
  diagramFixedIncome,
  diagramQuestions,
  diagramSettings,
  gmailAccounts,
  gmailAlerts,
  gmailKeywords,
  installments,
  investmentBuckets,
  investmentReserves,
  months,
  notifications,
  recurringExpenses,
  recurringSettings,
  reminders,
  reminderSettings,
  reserveContributions,
  reservePlans,
  xpEvents,
} from './db/schema';
import type { Database } from './db/types';
import { PostgresBanksRepository } from './banks/repository';
import { disconnectAll, forgetPluggyKey } from './banks/service';

/**
 * "Apagar todos os dados": everything the account stored, in every module — months and their
 * entries, settings, cards and bills, recurring and instalment purchases, reserves, the Diagrama,
 * reminders, what the retired Monitor de Gmail left (the connection and its token), the Open
 * Finance key and banks, the XP of the Missões and the notification history. The account itself
 * stays, and so do the devices that receive notifications; "Excluir minha conta" removes those too.
 * Rows that hang from others (entries, deliveries, completions) go with them by cascade.
 */
export async function clearAccountData(db: Database, userId: string): Promise<void> {
  // The banks leave the person's Pluggy application too, while the key to reach it still exists.
  await disconnectAll(new PostgresBanksRepository(db, userId), userId).catch(() => undefined);
  await db.transaction(async (tx) => {
    // The same lock every budget write takes: nothing of this account is half-written meanwhile.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    await tx.delete(months).where(eq(months.userId, userId));
    await tx.delete(budgetSettings).where(eq(budgetSettings.userId, userId));
    // The XP of the Missões starts over too.
    await tx.delete(xpEvents).where(eq(xpEvents.userId, userId));
    await tx.delete(cardBillPayments).where(eq(cardBillPayments.userId, userId));
    await tx.delete(cards).where(eq(cards.userId, userId));
    await tx.delete(cardSettings).where(eq(cardSettings.userId, userId));
    await tx.delete(recurringExpenses).where(eq(recurringExpenses.userId, userId));
    await tx.delete(recurringSettings).where(eq(recurringSettings.userId, userId));
    await tx.delete(installments).where(eq(installments.userId, userId));
    await tx.delete(reserveContributions).where(eq(reserveContributions.userId, userId));
    await tx.delete(reservePlans).where(eq(reservePlans.userId, userId));
    await tx.delete(investmentBuckets).where(eq(investmentBuckets.userId, userId));
    await tx.delete(investmentReserves).where(eq(investmentReserves.userId, userId));
    await tx.delete(cashSettings).where(eq(cashSettings.userId, userId));
    // The Diagrama's answers go with its assets and questions.
    await tx.delete(diagramContributions).where(eq(diagramContributions.userId, userId));
    await tx.delete(diagramAssets).where(eq(diagramAssets.userId, userId));
    await tx.delete(diagramQuestions).where(eq(diagramQuestions.userId, userId));
    await tx.delete(diagramFixedIncome).where(eq(diagramFixedIncome.userId, userId));
    await tx.delete(diagramSettings).where(eq(diagramSettings.userId, userId));
    await tx.delete(reminders).where(eq(reminders.userId, userId));
    await tx.delete(reminderSettings).where(eq(reminderSettings.userId, userId));
    // Left by the retired Monitor de Gmail: the tables stay until that data is dropped.
    await tx.delete(gmailAlerts).where(eq(gmailAlerts.userId, userId));
    await tx.delete(gmailKeywords).where(eq(gmailKeywords.userId, userId));
    await tx.delete(gmailAccounts).where(eq(gmailAccounts.userId, userId));
    await tx.delete(bankConnections).where(eq(bankConnections.userId, userId));
    await tx.delete(bankKeys).where(eq(bankKeys.userId, userId));
    await tx.delete(bankSettings).where(eq(bankSettings.userId, userId));
    await tx.delete(bankCategoryMemory).where(eq(bankCategoryMemory.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
  });
  forgetPluggyKey(userId);
}
