import { eq } from 'drizzle-orm';
import { PostgresBudgetRepository } from './budgetRepository';
import { budgetSettings, jobRuns } from './db/schema';
import type { Database } from './db/types';

/**
 * The categories stopped being created, archived and renamed: every account has the same four
 * (lib/budget/topics.ts), and "Diversos" became "Prazeres e Confortos". This brings the accounts
 * that already exist there once, on the first start after the update: the new name and the fixed
 * descriptions, a default that was archived back, and any category the person created folded into
 * Prazeres e Confortos with everything that pointed at it (`applyFixedTopics`).
 *
 * The row in `job_runs` is written last: applying it again changes nothing, so a start that fails
 * halfway simply does it all again.
 */

export const FIXED_TOPICS_JOB = 'four-fixed-topics';

export async function runFixedTopicsMigration(
  db: Database,
  now: Date = new Date(),
): Promise<{ skipped: boolean; accounts: number; topics: number; entries: number }> {
  const [done] = await db.select().from(jobRuns).where(eq(jobRuns.name, FIXED_TOPICS_JOB));
  if (done) return { skipped: true, accounts: 0, topics: 0, entries: 0 };

  const accounts = await db.select({ userId: budgetSettings.userId }).from(budgetSettings);
  let topics = 0;
  let entries = 0;
  for (const { userId } of accounts) {
    const result = await new PostgresBudgetRepository(db, userId).applyFixedTopics();
    topics += result.topics;
    entries += result.entries;
  }

  await db.insert(jobRuns).values({ name: FIXED_TOPICS_JOB, lastRunAt: now }).onConflictDoNothing();
  console.info(
    `[categorias] as quatro fixas em ${accounts.length} conta(s): ${topics} categoria(s) criada(s) ` +
      `pela pessoa juntada(s) a Prazeres e Confortos, ${entries} lançamento(s) movido(s).`,
  );
  return { skipped: false, accounts: accounts.length, topics, entries };
}
